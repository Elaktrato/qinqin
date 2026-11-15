package ai

import (
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"syscall"
	"time"
)

// ErrEndpointBlocked means the outbound-HTTP policy refused a URL or an
// address. The error text carries a reason word and at most an IP, never the
// URL's query, userinfo or any header.
var ErrEndpointBlocked = errors.New("ai: endpoint blocked")

// MaxResponseBytes caps every provider response body.
const MaxResponseBytes = 8 << 20

const (
	dialTimeout           = 10 * time.Second
	tlsHandshakeTimeout   = 10 * time.Second
	responseHeaderTimeout = 150 * time.Second
)

// GuardPolicy is the SSRF policy for a client. AllowPrivate admits loopback,
// RFC 1918, CGNAT and unique-local targets (never link-local, metadata,
// unspecified or multicast).
type GuardPolicy struct{ AllowPrivate bool }

func blocked(reason string) error { return fmt.Errorf("%w: %s", ErrEndpointBlocked, reason) }

var (
	cgnat       = netip.MustParsePrefix("100.64.0.0/10")
	thisNetwork = netip.MustParsePrefix("0.0.0.0/8")
	alwaysBlock = []netip.Addr{
		netip.MustParseAddr("255.255.255.255"),
		netip.MustParseAddr("100.100.100.200"), // Alibaba metadata
		netip.MustParseAddr("fd00:ec2::254"),   // AWS IPv6 metadata
	}
)

func alwaysBlocked(a netip.Addr) bool {
	if !a.IsValid() || a.IsUnspecified() || a.IsLinkLocalUnicast() || a.IsLinkLocalMulticast() || a.IsMulticast() || thisNetwork.Contains(a) {
		return true
	}
	for _, b := range alwaysBlock {
		if a == b {
			return true
		}
	}
	return false
}

func privateClass(a netip.Addr) bool { return a.IsLoopback() || a.IsPrivate() || cgnat.Contains(a) }

// allowedAddr reports whether a connection to a may be made under p.
func allowedAddr(a netip.Addr, p GuardPolicy) bool {
	a = a.Unmap()
	if alwaysBlocked(a) {
		return false
	}
	if privateClass(a) {
		return p.AllowPrivate
	}
	return true
}

func localName(host string) bool { return host == "localhost" || strings.HasSuffix(host, ".localhost") }

// numericHost reports whether the last label looks like a number, which
// resolvers read as an IPv4 form (decimal, octal, hex, short) that netip does
// not parse.
func numericHost(host string) bool {
	i := strings.LastIndexByte(host, '.')
	last := host[i+1:]
	if last == "" {
		return false
	}
	if strings.HasPrefix(strings.ToLower(last), "0x") {
		return true
	}
	for _, r := range last {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// CheckEndpointURL validates and normalises a custom endpoint's base URL.
func CheckEndpointURL(raw string, p GuardPolicy) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Opaque != "" {
		return nil, blocked("scheme")
	}
	if u.User != nil {
		return nil, blocked("userinfo")
	}
	if u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || strings.Contains(raw, "#") {
		return nil, blocked("query")
	}
	host := strings.ToLower(strings.TrimSuffix(u.Hostname(), "."))
	if host == "" {
		return nil, blocked("host")
	}
	var addr netip.Addr
	isIP := false
	if strings.Contains(host, ":") || numericHost(host) {
		a, err := netip.ParseAddr(host)
		if err != nil {
			return nil, blocked("host")
		}
		if a.Zone() != "" {
			return nil, blocked("address")
		}
		addr, isIP = a.Unmap(), true
	}
	if isIP && alwaysBlocked(addr) {
		return nil, blocked("address")
	}
	if u.Scheme == "http" {
		local := localName(host) || (isIP && privateClass(addr))
		if !p.AllowPrivate || !local {
			return nil, blocked("scheme")
		}
	} else if isIP && !allowedAddr(addr, p) || localName(host) && !p.AllowPrivate {
		return nil, blocked("address")
	}
	u.Host = strings.ToLower(u.Host)
	u.Path = strings.TrimRight(u.Path, "/")
	u.RawPath = ""
	return u, nil
}

func guardedDialer(p GuardPolicy, resolver *net.Resolver) *net.Dialer {
	return &net.Dialer{
		Timeout:  dialTimeout,
		Resolver: resolver,
		// Control sees the address actually being dialled, after DNS: a
		// rebinding answer or a poisoned record cannot slip past a check made
		// on the name.
		Control: func(_, address string, _ syscall.RawConn) error {
			ap, err := netip.ParseAddrPort(address)
			if err != nil {
				return blocked("address")
			}
			if !allowedAddr(ap.Addr(), p) {
				return blocked("address " + ap.Addr().Unmap().String())
			}
			return nil
		},
	}
}

func noRedirect(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }

func newClient(proxy func(*http.Request) (*url.URL, error), p GuardPolicy, resolver *net.Resolver) *http.Client {
	return &http.Client{
		Transport: &http.Transport{
			Proxy:                 proxy,
			DialContext:           guardedDialer(p, resolver).DialContext,
			TLSHandshakeTimeout:   tlsHandshakeTimeout,
			ResponseHeaderTimeout: responseHeaderTimeout,
			ForceAttemptHTTP2:     true,
		},
		CheckRedirect: noRedirect,
	}
}

// NewBuiltinClient is for the providers whose hosts are fixed in code. It
// honours HTTPS_PROXY (so an egress proxy keeps working, even a private one),
// follows no redirects, and refuses only the always-blocked addresses.
func NewBuiltinClient(resolver *net.Resolver) *http.Client {
	return newClient(http.ProxyFromEnvironment, GuardPolicy{AllowPrivate: true}, resolver)
}

// NewGuardedClient is for admin-registered endpoints: no proxy (through one
// the dialled IP would be the proxy's and the check blind), no redirects, and
// the dialled IP checked against p.
func NewGuardedClient(p GuardPolicy, resolver *net.Resolver) *http.Client {
	return newClient(nil, p, resolver)
}

// readCapped reads at most n bytes; a longer body is ErrBadReply.
func readCapped(r io.Reader, n int64) ([]byte, error) {
	b, err := io.ReadAll(io.LimitReader(r, n+1))
	if err != nil {
		return nil, err
	}
	if int64(len(b)) > n {
		return nil, fmt.Errorf("%w: response larger than %d bytes", ErrBadReply, n)
	}
	return b, nil
}
