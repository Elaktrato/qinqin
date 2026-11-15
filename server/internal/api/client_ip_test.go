package api

import (
	"net/http"
	"net/netip"
	"strings"
	"testing"
)

func req(peer string, xff ...string) *http.Request {
	r, _ := http.NewRequest(http.MethodPost, "/", nil)
	r.RemoteAddr = peer
	for _, v := range xff {
		r.Header.Add("X-Forwarded-For", v)
	}
	return r
}

func TestClientIP(t *testing.T) {
	long := strings.Repeat("10.0.0.7, ", 39) + "10.0.0.8"
	cases := []struct {
		name  string
		s     *server
		r     *http.Request
		want  string
		trust []netip.Prefix
	}{
		{"no header", &server{}, req("10.0.0.2:5000"), "10.0.0.2", nil},
		{"public peer forged header", &server{}, req("198.51.100.7:1", "1.2.3.4"), "198.51.100.7", nil},
		{"trusted peer with header", &server{}, req("10.0.0.2:5000", "203.0.113.9"), "203.0.113.9", nil},
		{"chain right to left", &server{}, req("10.0.0.2:5000", "198.51.100.1, 10.0.0.5"), "198.51.100.1", nil},
		{"spoofed left entry ignored", &server{}, req("10.0.0.2:5000", "9.9.9.9, 198.51.100.1"), "198.51.100.1", nil},
		{"two header lines joined", &server{}, req("10.0.0.2:5000", "9.9.9.9", "198.51.100.1, 10.0.0.5"), "198.51.100.1", nil},
		{"all trusted gives left-most", &server{}, req("10.0.0.2:5000", "10.0.0.9, 10.0.0.5"), "10.0.0.9", nil},
		{"garbage stops the walk", &server{}, req("10.0.0.2:5000", "203.0.113.9, nonsense, 10.0.0.5"), "10.0.0.5", nil},
		{"hop cap 32", &server{}, req("10.0.0.2:5000", "203.0.113.9, "+long), "10.0.0.7", nil},
		{"ipv6 /64 peer", &server{}, req("[2001:db8:1:2:aaaa::1]:80"), "2001:db8:1:2:aaaa::1", nil},
		{"v4-mapped peer", &server{}, req("[::ffff:10.0.0.2]:80", "203.0.113.9"), "203.0.113.9", nil},
		{"zoned peer", &server{}, req("[fe80::1%eth0]:80", "203.0.113.9"), "203.0.113.9", nil},
		{"none ignores header", &server{trusted: []netip.Prefix{}}, req("10.0.0.2:5000", "203.0.113.9"), "10.0.0.2", nil},
		{"custom set", &server{trusted: mustPrefixes("203.0.113.0/24")}, req("203.0.113.5:1", "198.51.100.1"), "198.51.100.1", nil},
		{"bare peer without port", &server{}, req("198.51.100.7"), "198.51.100.7", nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := c.s.clientIP(c.r); got.String() != c.want {
				t.Fatalf("clientIP = %v, want %s", got, c.want)
			}
		})
	}
}

func TestClientIPUnreadablePeer(t *testing.T) {
	s := &server{}
	if a := s.clientIP(req("@")); a.IsValid() {
		t.Fatalf("got %v", a)
	}
	if clientKeyString(netip.Addr{}) != "unknown" {
		t.Fatal("zero addr key")
	}
}

func TestClientKeyString(t *testing.T) {
	a := netip.MustParseAddr
	if clientKeyString(a("203.0.113.9")) != "203.0.113.9" {
		t.Fatal("v4")
	}
	if clientKeyString(a("2001:db8:1:2:aaaa::1")) != clientKeyString(a("2001:db8:1:2:bbbb::9")) {
		t.Fatal("same /64 not grouped")
	}
	if clientKeyString(a("2001:db8:1:2::1")) == clientKeyString(a("2001:db8:1:3::1")) {
		t.Fatal("different /64 grouped")
	}
	if clientKeyString(a("::ffff:203.0.113.9")) != "203.0.113.9" {
		t.Fatal("mapped")
	}
}

func TestParseTrustedProxies(t *testing.T) {
	if p, err := ParseTrustedProxies(""); err != nil || len(p) != len(DefaultTrustedProxies) {
		t.Fatalf("default: %v %v", p, err)
	}
	if p, err := ParseTrustedProxies("none"); err != nil || p == nil || len(p) != 0 {
		t.Fatalf("none: %#v %v", p, err)
	}
	p, err := ParseTrustedProxies("10.0.0.0/8, 203.0.113.5 ,2001:db8::1")
	if err != nil || len(p) != 3 || p[1].Bits() != 32 || p[2].Bits() != 128 {
		t.Fatalf("list: %v %v", p, err)
	}
	for _, bad := range []string{"10.0.0.0/33", "10.0.0.0/8,nonsense", ","} {
		if _, err := ParseTrustedProxies(bad); err == nil {
			t.Fatalf("%q accepted", bad)
		}
	}
	if _, err := ParseTrustedProxies("10.0.0.0/8,nonsense"); err == nil || !strings.Contains(err.Error(), "nonsense") {
		t.Fatalf("error does not name the item: %v", err)
	}
}
