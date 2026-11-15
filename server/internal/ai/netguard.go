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
	cgnat = netip.MustParsePrefix("100.64.0.0/10")
	// Never connectable, whatever the policy: "this network", IETF protocol
	// assignments (192.0.0.0/24, which holds Oracle's metadata address),
	// benchmarking (198.18.0.0/15), reserved and broadcast (240.0.0.0/4),
	// deprecated site-local IPv6 and the local-use NAT64 prefix (whose embedded
	// address position varies).
	alwaysBlockPrefixes = []netip.Prefix{
		netip.MustParsePrefix("0.0.0.0/8"),
		netip.MustParsePrefix("192.0.0.0/24"),
		netip.MustParsePrefix("198.18.0.0/15"),
		netip.MustParsePrefix("240.0.0.0/4"),
		netip.MustParsePrefix("fec0::/10"),
		netip.MustParsePrefix("64:ff9b:1::/48"),
	}
	alwaysBlock = []netip.Addr{
		netip.MustParseAddr("100.100.100.200"), // Alibaba metadata
		netip.MustParseAddr("fd00:ec2::254"),   // AWS IPv6 metadata
	}
	nat64     = netip.MustParsePrefix("64:ff9b::/96")
	sixToFour = netip.MustParsePrefix("2002::/16")
	teredo    = netip.MustParsePrefix("2001::/32")
	v4Compat  = netip.MustParsePrefix("::/96")
)

// effective returns the addresses a connection to a really goes to: a itself
// and, for IPv4-mapped, IPv4-compatible, NAT64, 6to4 and Teredo addresses,
// the IPv4 address(es) inside, so the IPv4 policy applies to them too.
func effective(a netip.Addr) []netip.Addr {
	a = a.Unmap()
	out := []netip.Addr{a}
	if !a.Is6() {
		return out
	}
	b := a.As16()
	v4 := func(x []byte) netip.Addr { return netip.AddrFrom4([4]byte{x[0], x[1], x[2], x[3]}) }
	switch {
	case nat64.Contains(a), v4Compat.Contains(a) && !a.IsLoopback() && !a.IsUnspecified():
		out = append(out, v4(b[12:16]))
	case sixToFour.Contains(a):
		out = append(out, v4(b[2:6]))
	case teredo.Contains(a):
		client := []byte{^b[12], ^b[13], ^b[14], ^b[15]}
		out = append(out, v4(b[4:8]), v4(client))
	}
	return out
}

func ownAlwaysBlocked(a netip.Addr) bool {
	if !a.IsValid() || a.IsUnspecified() || a.IsLinkLocalUnicast() || a.IsLinkLocalMulticast() || a.IsMulticast() {
		return true
	}
	for _, p := range alwaysBlockPrefixes {
		if p.Contains(a) {
			return true
		}
	}
	for _, b := range alwaysBlock {
		if a == b {
			return true
		}
	}
	return false
}

func alwaysBlocked(a netip.Addr) bool {
	for _, e := range effective(a) {
		if ownAlwaysBlocked(e) {
			return true
		}
	}
	return false
}

func privateClass(a netip.Addr) bool {
	for _, e := range effective(a) {
		if e.IsLoopback() || e.IsPrivate() || cgnat.Contains(e) {
			return true
		}
	}
	return false
}

// allowedAddr reports whether a connection to a may be made under p.
func allowedAddr(a netip.Addr, p GuardPolicy) bool {
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
		// A hostname is accepted too (a Docker service name, a LAN host): the
		// guarded client dials plain http only at private addresses, so the
		// key cannot travel in clear text over the internet.
		local := localName(host) || !isIP || privateClass(addr)
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
			IdleConnTimeout:       90 * time.Second,
			MaxIdleConnsPerHost:   2,
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

// schemeTransport sends https through a transport that allows what p allows
// and plain http through one that dials private addresses only.
type schemeTransport struct{ secure, plain *http.Transport }

func (s *schemeTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	if r.URL.Scheme == "http" {
		return s.plain.RoundTrip(r)
	}
	return s.secure.RoundTrip(r)
}

// NewGuardedClient is for admin-registered endpoints: no proxy (through one
// the dialled IP would be the proxy's and the check blind), no redirects, the
// dialled IP checked against p, and plain http dialled at private addresses
// only.
func NewGuardedClient(p GuardPolicy, resolver *net.Resolver) *http.Client {
	secure := newClient(nil, p, resolver)
	plain := newClient(nil, p, resolver).Transport.(*http.Transport)
	plain.DialContext = privateOnlyDialer(p, resolver).DialContext
	secure.Transport = &schemeTransport{secure: secure.Transport.(*http.Transport), plain: plain}
	return secure
}

// privateOnlyDialer refuses every address p refuses and every address that is
// not loopback, private or CGNAT.
func privateOnlyDialer(p GuardPolicy, resolver *net.Resolver) *net.Dialer {
	d := guardedDialer(p, resolver)
	inner := d.Control
	d.Control = func(network, address string, c syscall.RawConn) error {
		if err := inner(network, address, c); err != nil {
			return err
		}
		ap, _ := netip.ParseAddrPort(address)
		if !privateClass(ap.Addr().Unmap()) {
			return blocked("address " + ap.Addr().Unmap().String())
		}
		return nil
	}
	return d
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
