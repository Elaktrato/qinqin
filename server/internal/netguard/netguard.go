// Package netguard is the outbound-address policy (SSRF guard) shared by the
// AI provider clients and the SMTP transport: link-local, metadata, unspecified
// and multicast targets are never reachable; loopback, RFC 1918, CGNAT and ULA
// only when the policy allows private targets. Dialing checks the address
// actually connected to, after DNS.
package netguard

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"strings"
	"syscall"
	"time"
)

// ErrBlocked means the policy refused a host or an address. The error text
// carries a reason word and at most an IP, never a URL, query or header.
var ErrBlocked = errors.New("endpoint blocked")

// DialTimeout bounds one connection attempt.
const DialTimeout = 10 * time.Second

// GuardPolicy is the SSRF policy for a client. AllowPrivate admits loopback,
// RFC 1918, CGNAT and unique-local targets (never link-local, metadata,
// unspecified or multicast).
type GuardPolicy struct{ AllowPrivate bool }

// Blocked builds an ErrBlocked with a reason word.
func Blocked(reason string) error { return fmt.Errorf("%w: %s", ErrBlocked, reason) }

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

func AlwaysBlocked(a netip.Addr) bool {
	for _, e := range effective(a) {
		if ownAlwaysBlocked(e) {
			return true
		}
	}
	return false
}

func PrivateClass(a netip.Addr) bool {
	for _, e := range effective(a) {
		if e.IsLoopback() || e.IsPrivate() || cgnat.Contains(e) {
			return true
		}
	}
	return false
}

// AllowedAddr reports whether a connection to a may be made under p.
func AllowedAddr(a netip.Addr, p GuardPolicy) bool {
	if AlwaysBlocked(a) {
		return false
	}
	if PrivateClass(a) {
		return p.AllowPrivate
	}
	return true
}

func LocalName(host string) bool { return host == "localhost" || strings.HasSuffix(host, ".localhost") }

// NumericHost reports whether the last label looks like a number, which
// resolvers read as an IPv4 form (decimal, octal, hex, short) that netip does
// not parse.
func NumericHost(host string) bool {
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

// NewDialer returns a dialer whose Control refuses any address p refuses.
func NewDialer(p GuardPolicy, resolver *net.Resolver) *net.Dialer {
	return &net.Dialer{
		Timeout:  DialTimeout,
		Resolver: resolver,
		// Control sees the address actually being dialled, after DNS: a
		// rebinding answer or a poisoned record cannot slip past a check made
		// on the name.
		Control: func(_, address string, _ syscall.RawConn) error {
			ap, err := netip.ParseAddrPort(address)
			if err != nil {
				return Blocked("address")
			}
			if !AllowedAddr(ap.Addr(), p) {
				return Blocked("address " + ap.Addr().Unmap().String())
			}
			return nil
		},
	}
}

// CheckHost validates a configured host name or IP literal against p before
// anything is dialled. A host name passes here (it is resolved and checked at
// dial time); an IP literal, an IPv4 numeric form or a local name is judged now.
func CheckHost(host string, p GuardPolicy) error {
	host = strings.ToLower(strings.TrimSuffix(host, "."))
	if host == "" {
		return Blocked("host")
	}
	if strings.Contains(host, ":") || NumericHost(host) {
		a, err := netip.ParseAddr(host)
		if err != nil || a.Zone() != "" {
			return Blocked("host")
		}
		if !AllowedAddr(a.Unmap(), p) {
			return Blocked("address")
		}
		return nil
	}
	if LocalName(host) && !p.AllowPrivate {
		return Blocked("address")
	}
	return nil
}

// DialContext returns a dial function that resolves with r (nil = default)
// and refuses any resolved address p refuses.
func DialContext(p GuardPolicy, r *net.Resolver) func(ctx context.Context, network, addr string) (net.Conn, error) {
	return NewDialer(p, r).DialContext
}
