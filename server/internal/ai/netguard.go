package ai

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"syscall"
	"time"

	"qinqin/internal/netguard"
)

// ErrEndpointBlocked means the outbound-HTTP policy refused a URL or an
// address. The error text carries a reason word and at most an IP, never the
// URL's query, userinfo or any header.
var ErrEndpointBlocked = netguard.ErrBlocked

// MaxResponseBytes caps every provider response body.
const MaxResponseBytes = 8 << 20

const (
	tlsHandshakeTimeout   = 10 * time.Second
	responseHeaderTimeout = 150 * time.Second
)

// GuardPolicy is the SSRF policy for a client (see internal/netguard).
type GuardPolicy = netguard.GuardPolicy

func blocked(reason string) error { return netguard.Blocked(reason) }

func alwaysBlocked(a netip.Addr) bool                          { return netguard.AlwaysBlocked(a) }
func privateClass(a netip.Addr) bool                           { return netguard.PrivateClass(a) }
func allowedAddr(a netip.Addr, p GuardPolicy) bool             { return netguard.AllowedAddr(a, p) }
func localName(h string) bool                                  { return netguard.LocalName(h) }
func numericHost(h string) bool                                { return netguard.NumericHost(h) }
func guardedDialer(p GuardPolicy, r *net.Resolver) *net.Dialer { return netguard.NewDialer(p, r) }

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
