package ai

import (
	"bytes"
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestCheckEndpointURL(t *testing.T) {
	priv := GuardPolicy{AllowPrivate: true}
	none := GuardPolicy{}
	cases := []struct {
		name   string
		raw    string
		p      GuardPolicy
		reason string // "" = allowed
	}{
		{"https public", "https://llm.example.com/v1", none, ""},
		{"https public trailing slash", "https://llm.example.com/v1/", none, ""},
		{"https public ip", "https://203.0.113.5/v1", none, ""},
		{"metadata", "http://169.254.169.254/", priv, "address"},
		{"metadata https", "https://169.254.169.254/", priv, "address"},
		{"metadata mapped", "https://[::ffff:169.254.169.254]/", priv, "address"},
		{"loopback mapped", "http://[::ffff:127.0.0.1]/", none, "scheme"},
		{"loopback mapped https no switch", "https://[::ffff:127.0.0.1]/", none, "address"},
		{"alibaba metadata", "https://100.100.100.200/", priv, "address"},
		{"aws ipv6 metadata", "https://[fd00:ec2::254]/", priv, "address"},
		{"link local v6", "https://[fe80::1]/", priv, "address"},
		{"unspecified", "https://0.0.0.0/", priv, "address"},
		{"multicast", "https://224.0.0.1/", priv, "address"},
		{"broadcast", "https://255.255.255.255/", priv, "address"},
		{"decimal ip", "http://2130706433/", priv, "host"},
		{"decimal ip https", "https://2130706433/", none, "host"},
		{"hex ip", "https://0x7f000001/", priv, "host"},
		{"octal ip", "https://0177.0.0.1/", priv, "host"},
		{"short ip", "https://127.1/", priv, "host"},
		{"loopback http no switch", "http://127.0.0.1:11434/v1", none, "scheme"},
		{"loopback http switch", "http://127.0.0.1:11434/v1", priv, ""},
		{"loopback https no switch", "https://127.0.0.1/v1", none, "address"},
		{"private http switch", "http://192.168.1.10:8000/v1", priv, ""},
		{"private http no switch", "http://192.168.1.10:8000/v1", none, "scheme"},
		{"cgnat no switch", "https://100.64.0.1/", none, "address"},
		{"cgnat switch", "http://100.64.0.1/", priv, ""},
		{"ula switch", "http://[fd12::1]/", priv, ""},
		{"localhost http switch", "http://localhost:11434/v1", priv, ""},
		{"localhost http no switch", "http://localhost:11434/v1", none, "scheme"},
		{"localhost https no switch", "https://localhost/v1", none, "address"},
		{"foo.localhost switch", "http://ollama.localhost:11434/", priv, ""},
		{"http public name without switch", "http://llm.example.com/v1", none, "scheme"},
		{"http hostname with switch (docker service name)", "http://ollama:11434/v1", priv, ""},
		{"http hostname, no switch", "http://ollama:11434/v1", none, "scheme"},
		{"http public ip", "http://203.0.113.5/v1", priv, "scheme"},
		{"userinfo", "https://u:p@x.example/", none, "userinfo"},
		{"user only", "https://u@x.example/", none, "userinfo"},
		{"query", "https://x.example/v1?k=1", none, "query"},
		{"empty query", "https://x.example/v1?", none, "query"},
		{"fragment", "https://x.example/v1#a", none, "query"},
		{"ftp", "ftp://x.example/", none, "scheme"},
		{"no scheme", "x.example/v1", none, "scheme"},
		{"relative", "/v1", none, "scheme"},
		{"empty", "", none, "scheme"},
		{"no host", "https:///v1", none, "host"},
		{"zone", "https://[fe80::1%25eth0]/", priv, "address"},
		{"control char", "https://x.example/\x00", none, "scheme"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			u, err := CheckEndpointURL(c.raw, c.p)
			if c.reason == "" {
				if err != nil {
					t.Fatalf("blocked: %v", err)
				}
				if strings.HasSuffix(u.Path, "/") && u.Path != "" {
					t.Errorf("trailing slash kept: %q", u.Path)
				}
				return
			}
			if !errors.Is(err, ErrEndpointBlocked) {
				t.Fatalf("err = %v, want ErrEndpointBlocked (%s)", err, c.reason)
			}
			if !strings.Contains(err.Error(), c.reason) {
				t.Errorf("err = %q, want reason word %q", err, c.reason)
			}
		})
	}
	u, err := CheckEndpointURL("https://llm.example.com/v1/", none)
	if err != nil || u.String() != "https://llm.example.com/v1" {
		t.Errorf("normalised = %v, %v", u, err)
	}
}

func TestAllowedAddr(t *testing.T) {
	for _, c := range []struct {
		addr          string
		none, private bool
	}{
		{"203.0.113.5", true, true},
		{"2001:db8::1", true, true},
		{"8.8.8.8", true, true},
		{"127.0.0.1", false, true},
		{"::1", false, true},
		{"10.1.2.3", false, true},
		{"172.16.0.1", false, true},
		{"192.168.0.1", false, true},
		{"fc00::1", false, true},
		{"100.64.0.1", false, true},
		{"100.127.255.254", false, true},
		{"100.128.0.1", true, true},
		{"169.254.169.254", false, false},
		{"169.254.0.1", false, false},
		{"fe80::1", false, false},
		{"ff02::1", false, false},
		{"224.0.0.1", false, false},
		{"0.0.0.0", false, false},
		{"::", false, false},
		{"255.255.255.255", false, false},
		{"100.100.100.200", false, false},
		{"fd00:ec2::254", false, false},
		{"::ffff:169.254.169.254", false, false},
		{"::ffff:127.0.0.1", false, true},
		{"::ffff:203.0.113.5", true, true},
	} {
		a := netip.MustParseAddr(c.addr)
		if got := allowedAddr(a, GuardPolicy{}); got != c.none {
			t.Errorf("allowedAddr(%s, none) = %v, want %v", c.addr, got, c.none)
		}
		if got := allowedAddr(a, GuardPolicy{AllowPrivate: true}); got != c.private {
			t.Errorf("allowedAddr(%s, private) = %v, want %v", c.addr, got, c.private)
		}
	}
	if allowedAddr(netip.Addr{}, GuardPolicy{AllowPrivate: true}) {
		t.Error("invalid address allowed")
	}
}

// dnsServer answers A queries over UDP with whatever answer(n) returns for
// the n-th A query (1-based) and AAAA queries with an empty answer.
type dnsServer struct {
	conn   net.PacketConn
	mu     sync.Mutex
	n      int
	answer func(n int) []netip.Addr
}

func newDNS(t *testing.T, answer func(n int) []netip.Addr) *dnsServer {
	t.Helper()
	pc, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	d := &dnsServer{conn: pc, answer: answer}
	t.Cleanup(func() { pc.Close() })
	go func() {
		buf := make([]byte, 512)
		for {
			n, from, err := pc.ReadFrom(buf)
			if err != nil {
				return
			}
			if resp := d.reply(buf[:n]); resp != nil {
				pc.WriteTo(resp, from)
			}
		}
	}()
	return d
}

func (d *dnsServer) reply(q []byte) []byte {
	if len(q) < 17 {
		return nil
	}
	i := 12
	for i < len(q) && q[i] != 0 {
		i += int(q[i]) + 1
	}
	i++ // root label
	if i+4 > len(q) {
		return nil
	}
	qtype := int(q[i])<<8 | int(q[i+1])
	question := q[12 : i+4]
	var addrs []netip.Addr
	if qtype == 1 {
		d.mu.Lock()
		d.n++
		addrs = d.answer(d.n)
		d.mu.Unlock()
	}
	resp := []byte{q[0], q[1], 0x81, 0x80, 0, 1, 0, byte(len(addrs)), 0, 0, 0, 0}
	resp = append(resp, question...)
	for _, a := range addrs {
		ip := a.As4()
		resp = append(resp, 0xC0, 0x0C, 0, 1, 0, 1, 0, 0, 0, 0, 0, 4)
		resp = append(resp, ip[:]...)
	}
	return resp
}

func (d *dnsServer) resolver() *net.Resolver {
	addr := d.conn.LocalAddr().String()
	return &net.Resolver{PreferGo: true, Dial: func(ctx context.Context, _, _ string) (net.Conn, error) {
		var nd net.Dialer
		return nd.DialContext(ctx, "udp", addr)
	}}
}

func fixed(ips ...string) func(int) []netip.Addr {
	var as []netip.Addr
	for _, s := range ips {
		as = append(as, netip.MustParseAddr(s))
	}
	return func(int) []netip.Addr { return as }
}

func countingServer(t *testing.T, h http.HandlerFunc) (*httptest.Server, *atomic.Int32) {
	t.Helper()
	var n atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n.Add(1)
		if h != nil {
			h(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return srv, &n
}

func portOf(srv *httptest.Server) string {
	_, p, _ := net.SplitHostPort(strings.TrimPrefix(srv.URL, "http://"))
	return p
}

func TestDialBlocksResolvedPrivate(t *testing.T) {
	srv, hits := countingServer(t, nil)
	dns := newDNS(t, fixed("127.0.0.1"))
	c := NewGuardedClient(GuardPolicy{}, dns.resolver())
	resp, err := c.Get("http://evil.test:" + portOf(srv) + "/v1/models?token=QSECRET")
	if resp != nil {
		resp.Body.Close()
	}
	if !errors.Is(err, ErrEndpointBlocked) {
		t.Fatalf("err = %v, want ErrEndpointBlocked", err)
	}
	if hits.Load() != 0 {
		t.Errorf("server saw %d requests, want 0", hits.Load())
	}
	// With the switch the same name works (the policy, not DNS, decides).
	c = NewGuardedClient(GuardPolicy{AllowPrivate: true}, dns.resolver())
	resp, err = c.Get("http://evil.test:" + portOf(srv) + "/")
	if err != nil {
		t.Fatalf("with AllowPrivate: %v", err)
	}
	resp.Body.Close()
	if hits.Load() != 1 {
		t.Errorf("hits = %d, want 1", hits.Load())
	}
}

func TestRebindingSecondAnswerChecked(t *testing.T) {
	srv, hits := countingServer(t, nil)
	dns := newDNS(t, func(n int) []netip.Addr {
		if n == 1 {
			return []netip.Addr{netip.MustParseAddr("203.0.113.5")} // public (TEST-NET-3)
		}
		return []netip.Addr{netip.MustParseAddr("127.0.0.1")}
	})
	c := NewGuardedClient(GuardPolicy{}, dns.resolver())
	url := "https://rebind.test:" + portOf(srv) + "/" // https: plain http would refuse the public first answer itself

	ctx, cancel := context1(300 * time.Millisecond)
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	resp, err := c.Do(req) // first answer: allowed by policy; nothing listens there, so it fails or times out
	cancel()
	if resp != nil {
		resp.Body.Close()
	}
	if errors.Is(err, ErrEndpointBlocked) {
		t.Fatalf("public first answer was blocked: %v", err)
	}
	resp, err = c.Get(url) // second answer: loopback, refused at dial time
	if resp != nil {
		resp.Body.Close()
	}
	if !errors.Is(err, ErrEndpointBlocked) {
		t.Fatalf("second request err = %v, want ErrEndpointBlocked", err)
	}
	if hits.Load() != 0 {
		t.Errorf("server saw %d requests, want 0", hits.Load())
	}
}

func context1(d time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), d)
}

func TestRedirectNotFollowed(t *testing.T) {
	b, bHits := countingServer(t, func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("redirect target received a request (Authorization=%q)", r.Header.Get("Authorization"))
	})
	a, _ := countingServer(t, func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, b.URL+"/steal", http.StatusFound)
	})
	for name, c := range map[string]*http.Client{
		"guarded": NewGuardedClient(GuardPolicy{AllowPrivate: true}, nil),
		"builtin": NewBuiltinClient(nil),
	} {
		req, _ := http.NewRequest(http.MethodGet, a.URL+"/v1", nil)
		req.Header.Set("Authorization", "Bearer sk-fake-SECRET")
		resp, err := c.Do(req)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusFound {
			t.Errorf("%s: status = %d, want 302", name, resp.StatusCode)
		}
	}
	if bHits.Load() != 0 {
		t.Errorf("target saw %d requests", bHits.Load())
	}
}

// transportOf returns the https transport of a client (the guarded client
// picks a transport by scheme).
func transportOf(t *testing.T, c *http.Client) *http.Transport {
	t.Helper()
	switch tr := c.Transport.(type) {
	case *http.Transport:
		return tr
	case *schemeTransport:
		return tr.secure
	}
	t.Fatalf("transport is %T", c.Transport)
	return nil
}

func proxyOf(t *testing.T, c *http.Client) func(*http.Request) (*url.URL, error) {
	t.Helper()
	return transportOf(t, c).Proxy
}

func TestNoProxyFromEnv(t *testing.T) {
	t.Setenv("HTTPS_PROXY", "http://proxy.example:3128")
	t.Setenv("https_proxy", "http://proxy.example:3128")
	if p := proxyOf(t, NewGuardedClient(GuardPolicy{AllowPrivate: true}, nil)); p != nil {
		t.Error("guarded client has a Proxy func")
	}
	p := proxyOf(t, NewBuiltinClient(nil))
	if p == nil {
		t.Fatal("built-in client has no Proxy func")
	}
	// ProxyFromEnvironment reads the environment once per process, so compare
	// the function rather than its (possibly cached) answer.
	if reflect.ValueOf(p).Pointer() != reflect.ValueOf(http.ProxyFromEnvironment).Pointer() {
		t.Error("built-in client does not use http.ProxyFromEnvironment")
	}
}

func TestBuiltinClientNoRedirect(t *testing.T) {
	c := NewBuiltinClient(nil)
	if c.CheckRedirect == nil {
		t.Fatal("no CheckRedirect")
	}
	if err := c.CheckRedirect(&http.Request{}, nil); !errors.Is(err, http.ErrUseLastResponse) {
		t.Errorf("CheckRedirect = %v", err)
	}
	g := NewGuardedClient(GuardPolicy{}, nil)
	if err := g.CheckRedirect(&http.Request{}, nil); !errors.Is(err, http.ErrUseLastResponse) {
		t.Errorf("guarded CheckRedirect = %v", err)
	}
}

func TestClientTimeouts(t *testing.T) {
	for name, c := range map[string]*http.Client{"builtin": NewBuiltinClient(nil), "guarded": NewGuardedClient(GuardPolicy{}, nil)} {
		tr := transportOf(t, c)
		if tr.TLSHandshakeTimeout != 10*time.Second || tr.ResponseHeaderTimeout != 150*time.Second || !tr.ForceAttemptHTTP2 {
			t.Errorf("%s transport = %v / %v / %v", name, tr.TLSHandshakeTimeout, tr.ResponseHeaderTimeout, tr.ForceAttemptHTTP2)
		}
	}
}

func TestBuiltinBlocksMetadata(t *testing.T) {
	dns := newDNS(t, fixed("169.254.169.254"))
	c := NewBuiltinClient(dns.resolver())
	resp, err := c.Get("https://metadata.test/latest/meta-data/")
	if resp != nil {
		resp.Body.Close()
	}
	if !errors.Is(err, ErrEndpointBlocked) {
		t.Fatalf("err = %v, want ErrEndpointBlocked", err)
	}
	// The built-in client does allow private targets (an egress proxy or a test server).
	srv, hits := countingServer(t, nil)
	resp, err = NewBuiltinClient(nil).Get(srv.URL)
	if err != nil {
		t.Fatalf("built-in client to loopback: %v", err)
	}
	resp.Body.Close()
	if hits.Load() != 1 {
		t.Errorf("hits = %d", hits.Load())
	}
}

func TestReadCapped(t *testing.T) {
	got, err := readCapped(strings.NewReader("hello"), 5)
	if err != nil || string(got) != "hello" {
		t.Errorf("at the cap: %q, %v", got, err)
	}
	if _, err := readCapped(bytes.NewReader(make([]byte, 6)), 5); !errors.Is(err, ErrBadReply) {
		t.Errorf("over the cap: %v, want ErrBadReply", err)
	}
	if got, err := readCapped(strings.NewReader(""), 5); err != nil || len(got) != 0 {
		t.Errorf("empty: %q, %v", got, err)
	}
	if MaxResponseBytes != 8<<20 {
		t.Errorf("MaxResponseBytes = %d", MaxResponseBytes)
	}
}

func TestGuardErrorsHaveNoQuery(t *testing.T) {
	for _, raw := range []string{"https://x.example/v1?k=QSECRET", "https://u:PSECRET@x.example/", "https://x.example/#FSECRET"} {
		_, err := CheckEndpointURL(raw, GuardPolicy{})
		if err == nil {
			t.Fatalf("%s allowed", raw)
		}
		for _, bad := range []string{"QSECRET", "PSECRET", "FSECRET", "k="} {
			if strings.Contains(err.Error(), bad) {
				t.Errorf("error %q contains %q", err, bad)
			}
		}
	}
	// A blocked dial: the guard's own error names the address, not the URL.
	srv, _ := countingServer(t, nil)
	dns := newDNS(t, fixed("127.0.0.1"))
	c := NewGuardedClient(GuardPolicy{}, dns.resolver())
	resp, err := c.Get("http://evil.test:" + portOf(srv) + "/v1?token=QSECRET")
	if resp != nil {
		resp.Body.Close()
	}
	var ue *url.Error
	if !errors.As(err, &ue) {
		t.Fatalf("err = %T", err)
	}
	if inner := ue.Err.Error(); strings.Contains(inner, "QSECRET") || strings.Contains(inner, "token") {
		t.Errorf("guard error %q leaks the query", inner)
	}
}

// An http endpoint is only ever dialled at private addresses, whatever its
// hostname resolves to: a key must not travel in clear text over the internet.
func TestPlainHTTPOnlyDialsPrivateAddresses(t *testing.T) {
	srv, hits := countingServer(t, nil)
	pub := newDNS(t, fixed("203.0.113.5"))
	c := NewGuardedClient(GuardPolicy{AllowPrivate: true}, pub.resolver())
	resp, err := c.Get("http://ollama.test:" + portOf(srv) + "/v1/models")
	if resp != nil {
		resp.Body.Close()
	}
	if !errors.Is(err, ErrEndpointBlocked) {
		t.Fatalf("http to a public address: err = %v, want ErrEndpointBlocked", err)
	}
	loop := newDNS(t, fixed("127.0.0.1"))
	c = NewGuardedClient(GuardPolicy{AllowPrivate: true}, loop.resolver())
	resp, err = c.Get("http://ollama.test:" + portOf(srv) + "/v1/models")
	if err != nil {
		t.Fatalf("http to a private address: %v", err)
	}
	resp.Body.Close()
	if hits.Load() != 1 {
		t.Errorf("hits = %d", hits.Load())
	}
}
