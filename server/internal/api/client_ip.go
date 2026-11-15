package api

import (
	"fmt"
	"log"
	"net"
	"net/http"
	"net/netip"
	"strings"
)

// maxForwardedHops bounds how far clientIP walks X-Forwarded-For.
const maxForwardedHops = 32

// DefaultTrustedProxies are the networks a Docker or LAN reverse proxy
// connects from: the proxy's X-Forwarded-For is believed when the TCP
// peer is in one of them. QINQIN_TRUSTED_PROXIES overrides the set.
var DefaultTrustedProxies = mustPrefixes(
	"127.0.0.0/8", "::1/128", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16",
	"100.64.0.0/10", "169.254.0.0/16", "fc00::/7", "fe80::/10")

func mustPrefixes(cidrs ...string) []netip.Prefix {
	out := make([]netip.Prefix, len(cidrs))
	for i, c := range cidrs {
		out[i] = netip.MustParsePrefix(c)
	}
	return out
}

// ParseTrustedProxies parses a comma list of CIDRs and bare addresses
// (a bare address is a /32 or /128). "" gives DefaultTrustedProxies;
// "none" gives an empty, non-nil set (the header is ignored). An error
// names the bad item.
func ParseTrustedProxies(v string) ([]netip.Prefix, error) {
	v = strings.TrimSpace(v)
	if v == "" {
		return DefaultTrustedProxies, nil
	}
	if strings.EqualFold(v, "none") {
		return []netip.Prefix{}, nil
	}
	var out []netip.Prefix
	for _, item := range strings.Split(v, ",") {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		if p, err := netip.ParsePrefix(item); err == nil {
			if p.Addr().Is4In6() {
				// An IPv4-mapped prefix means the IPv4 network (the
				// server unmaps peer addresses before matching).
				if p.Bits() < 96 {
					return nil, fmt.Errorf("trusted proxies: bad item %q: an IPv4-mapped prefix must be at least /96", item)
				}
				p = netip.PrefixFrom(p.Addr().Unmap(), p.Bits()-96)
			}
			out = append(out, p.Masked())
			continue
		}
		a, err := netip.ParseAddr(item)
		if err != nil {
			return nil, fmt.Errorf("trusted proxies: bad item %q: want a CIDR or an address", item)
		}
		a = a.Unmap().WithZone("")
		out = append(out, netip.PrefixFrom(a, a.BitLen()))
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("trusted proxies: no addresses in %q (use \"none\" to disable)", v)
	}
	return out, nil
}

// WithTrustedProxies sets the proxy networks whose X-Forwarded-For is
// believed; nil keeps DefaultTrustedProxies, an empty set trusts none.
func WithTrustedProxies(p []netip.Prefix) Option { return func(s *server) { s.trusted = p } }

func (s *server) trustedProxies() []netip.Prefix {
	if s.trusted == nil {
		return DefaultTrustedProxies
	}
	return s.trusted
}

func (s *server) isTrusted(a netip.Addr) bool {
	for _, p := range s.trustedProxies() {
		if p.Contains(a) {
			return true
		}
	}
	return false
}

func normAddr(a netip.Addr) netip.Addr { return a.Unmap().WithZone("") }

// clientIP is the address a request counts against: the TCP peer, or,
// when the peer is a trusted proxy, the first address in X-Forwarded-For
// (walking from the right, at most 32 hops) that is not itself a
// trusted proxy. All hops trusted gives the left-most; a malformed
// entry stops the walk at the last good address. The zero Addr means
// the peer address was unreadable.
func (s *server) clientIP(r *http.Request) netip.Addr {
	var peer netip.Addr
	if ap, err := netip.ParseAddrPort(r.RemoteAddr); err == nil {
		peer = ap.Addr()
	} else if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		peer, _ = netip.ParseAddr(host)
	} else {
		peer, _ = netip.ParseAddr(r.RemoteAddr)
	}
	if !peer.IsValid() {
		return netip.Addr{}
	}
	cur := normAddr(peer)
	if !s.isTrusted(cur) {
		return cur
	}
	var hops []string
	for _, line := range r.Header.Values("X-Forwarded-For") {
		hops = append(hops, strings.Split(line, ",")...)
	}
	if len(hops) > 0 {
		s.forwardedOnce.Do(func() {
			log.Printf("auth: honouring X-Forwarded-For from a trusted proxy; set QINQIN_TRUSTED_PROXIES=none if you have no reverse proxy")
		})
	}
	for i, walked := len(hops)-1, 0; i >= 0 && walked < maxForwardedHops; i, walked = i-1, walked+1 {
		a, ok := parseHop(hops[i])
		if !ok {
			return cur
		}
		cur = normAddr(a)
		if !s.isTrusted(cur) {
			return cur
		}
	}
	return cur
}

// parseHop reads one X-Forwarded-For entry: an address, an address with
// a port (1.2.3.4:5678, [2001:db8::1]:443) or a bracketed IPv6 address.
func parseHop(h string) (netip.Addr, bool) {
	h = strings.TrimSpace(h)
	if a, err := netip.ParseAddr(h); err == nil {
		return a, true
	}
	if ap, err := netip.ParseAddrPort(h); err == nil {
		return ap.Addr(), true
	}
	if len(h) > 2 && h[0] == '[' && h[len(h)-1] == ']' {
		if a, err := netip.ParseAddr(h[1 : len(h)-1]); err == nil {
			return a, true
		}
	}
	return netip.Addr{}, false
}

// clientKeyString is the text a client address is keyed by: IPv4 as is,
// IPv6 masked to its /64 (one subscriber owns a whole /64 or more).
func clientKeyString(a netip.Addr) string {
	if !a.IsValid() {
		return "unknown"
	}
	a = normAddr(a)
	if a.Is6() {
		p, _ := a.Prefix(64)
		return p.String()
	}
	return a.String()
}
