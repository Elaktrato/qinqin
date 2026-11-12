package sources_test

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"qinqin/internal/library/sources"
)

type fakeClock struct {
	mu     sync.Mutex
	t      time.Time
	sleeps []time.Duration
}

func (f *fakeClock) now() time.Time {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.t
}

func (f *fakeClock) sleep(ctx context.Context, d time.Duration) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sleeps = append(f.sleeps, d)
	f.t = f.t.Add(d)
	return nil
}

func (f *fakeClock) advance(d time.Duration) {
	f.mu.Lock()
	f.t = f.t.Add(d)
	f.mu.Unlock()
}

func newClient(t *testing.T, ua string) (*sources.HTTPClient, *fakeClock, string) {
	t.Helper()
	dir := t.TempDir()
	c := sources.NewHTTPClient(dir, ua)
	fc := &fakeClock{t: time.Now()}
	c.SetClock(fc.now, fc.sleep)
	c.AllowPrivate = true // httptest listens on 127.0.0.1
	return c, fc, dir
}

func TestHTTPClientSendsUserAgent(t *testing.T) {
	var got atomic.Value
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got.Store(r.Header.Get("User-Agent"))
		fmt.Fprint(w, "ok")
	}))
	defer srv.Close()
	ua := "qinqin/1.2.3 (+https://github.com/Elaktrato/qinqin)"
	c, _, _ := newClient(t, ua)
	if _, err := c.Get(context.Background(), srv.URL, 100, 0); err != nil {
		t.Fatal(err)
	}
	if got.Load() != ua {
		t.Fatalf("user agent = %v", got.Load())
	}
}

func TestHTTPClientCachesWithinTTL(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		fmt.Fprint(w, "body")
	}))
	defer srv.Close()
	c, fc, dir := newClient(t, "ua")
	ctx := context.Background()
	for i := 0; i < 2; i++ {
		b, err := c.Get(ctx, srv.URL+"/a?x=../../etc", 100, time.Hour)
		if err != nil || string(b) != "body" {
			t.Fatalf("get %d: %q %v", i, b, err)
		}
	}
	if hits.Load() != 1 {
		t.Fatalf("hits = %d, want 1", hits.Load())
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 || len(entries[0].Name()) != 64 || strings.ContainsAny(entries[0].Name(), "/.?") {
		t.Fatalf("cache entries: %v", entries)
	}
	fc.advance(2 * time.Hour)
	if _, err := c.Get(ctx, srv.URL+"/a?x=../../etc", 100, time.Hour); err != nil {
		t.Fatal(err)
	}
	if hits.Load() != 2 {
		t.Fatalf("hits after ttl = %d, want 2", hits.Load())
	}
	// ttl 0 never caches
	c.Get(ctx, srv.URL+"/b", 100, 0)
	c.Get(ctx, srv.URL+"/b", 100, 0)
	if hits.Load() != 4 {
		t.Fatalf("hits without ttl = %d, want 4", hits.Load())
	}
}

func TestHTTPClientRateLimitsPerHost(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, "x") }))
	defer srv.Close()
	c, fc, _ := newClient(t, "ua")
	ctx := context.Background()
	get := func(u string) {
		t.Helper()
		if _, err := c.Get(ctx, u, 10, 0); err != nil {
			t.Fatal(err)
		}
	}
	get(srv.URL + "/1")
	if len(fc.sleeps) != 0 {
		t.Fatalf("first request slept: %v", fc.sleeps)
	}
	get(srv.URL + "/2")
	if len(fc.sleeps) != 1 || fc.sleeps[0] != time.Second {
		t.Fatalf("second request sleeps = %v, want [1s]", fc.sleeps)
	}
	// a different host name for the same server is not throttled
	other := strings.Replace(srv.URL, "127.0.0.1", "localhost", 1)
	get(other + "/3")
	if len(fc.sleeps) != 1 {
		t.Fatalf("other host slept: %v", fc.sleeps)
	}
	fc.advance(5 * time.Second)
	get(srv.URL + "/4")
	if len(fc.sleeps) != 1 {
		t.Fatalf("request after the interval slept: %v", fc.sleeps)
	}
}

func TestHTTPClientBodyCap(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(strings.Repeat("a", 60)))
		w.(http.Flusher).Flush() // chunked, no Content-Length
		w.Write([]byte(strings.Repeat("a", 60)))
	}))
	defer srv.Close()
	c, _, dir := newClient(t, "ua")
	b, err := c.Get(context.Background(), srv.URL, 100, time.Hour)
	if !errors.Is(err, sources.ErrTooLarge) || b != nil {
		t.Fatalf("got %d bytes, err %v", len(b), err)
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 0 {
		t.Fatalf("oversized body was cached: %v", entries)
	}
	b, err = c.Get(context.Background(), srv.URL, 120, 0)
	if err != nil || len(b) != 120 {
		t.Fatalf("exact cap: %d %v", len(b), err)
	}
}

func TestHTTPClientRejectsOtherSchemesAndStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/redir":
			http.Redirect(w, r, "ftp://example.com/x", http.StatusFound)
		case "/missing":
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	c, _, _ := newClient(t, "ua")
	ctx := context.Background()
	for _, u := range []string{"file:///etc/passwd", "ftp://example.com/x", "/relative", srv.URL + "/redir", srv.URL + "/missing"} {
		if _, err := c.Get(ctx, u, 100, 0); err == nil {
			t.Errorf("Get(%q) succeeded", u)
		}
	}
}

func TestHTTPClientConcurrentSameURL(t *testing.T) {
	body := strings.Repeat("0123456789", 1000)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, body) }))
	defer srv.Close()
	c, _, _ := newClient(t, "ua")
	var wg sync.WaitGroup
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			b, err := c.Get(context.Background(), srv.URL, 1<<20, time.Hour)
			if err != nil || string(b) != body {
				t.Errorf("len %d err %v", len(b), err)
			}
		}()
	}
	wg.Wait()
	b, err := c.Get(context.Background(), srv.URL, 1<<20, time.Hour)
	if err != nil || string(b) != body {
		t.Fatalf("cached read: len %d err %v", len(b), err)
	}
}

func TestHTTPClientRefusesNonPublicAddress(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, "x") }))
	defer srv.Close()
	c := sources.NewHTTPClient(t.TempDir(), "ua") // AllowPrivate defaults to false
	_, err := c.Get(context.Background(), srv.URL, 10, 0)
	if !errors.Is(err, sources.ErrBlocked) {
		t.Fatalf("err = %v, want ErrBlocked", err)
	}
	if strings.Contains(err.Error(), "127.0.0.1:") && strings.Contains(err.Error(), "dial") {
		t.Fatalf("error leaks dial details: %v", err)
	}
}

func TestHTTPClientHostPolicyAppliesToRedirects(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/redir":
			http.Redirect(w, r, strings.Replace(srv0(r), "127.0.0.1", "localhost", 1)+"/ok", http.StatusFound)
		case "/loop":
			http.Redirect(w, r, "/loop", http.StatusFound)
		default:
			fmt.Fprint(w, "ok")
		}
	}))
	defer srv.Close()
	c, _, _ := newClient(t, "ua")
	only := c.For(func(u *url.URL) error {
		if u.Hostname() != "127.0.0.1" {
			return errors.New("no")
		}
		return nil
	})
	ctx := context.Background()
	if _, err := only.Get(ctx, srv.URL+"/redir", 10, 0); !errors.Is(err, sources.ErrBlocked) {
		t.Fatalf("redirect to other host: %v", err)
	}
	if _, err := only.Get(ctx, strings.Replace(srv.URL, "127.0.0.1", "localhost", 1)+"/ok", 10, 0); !errors.Is(err, sources.ErrBlocked) {
		t.Fatalf("initial other host: %v", err)
	}
	if b, err := only.Get(ctx, srv.URL+"/ok", 10, 0); err != nil || string(b) != "ok" {
		t.Fatalf("allowed host: %q %v", b, err)
	}
	if _, err := only.Get(ctx, srv.URL+"/loop", 10, 0); !errors.Is(err, sources.ErrTooManyRedirects) {
		t.Fatalf("redirect loop: %v", err)
	}
}

func srv0(r *http.Request) string { return "http://" + r.Host }

func TestHTTPClientErrorsDoNotLeakAddresses(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	u := srv.URL
	srv.Close() // nothing listens any more
	c, _, _ := newClient(t, "ua")
	_, err := c.Get(context.Background(), u+"/secret?token=1", 10, 0)
	if err == nil || strings.Contains(err.Error(), "secret") || strings.Contains(err.Error(), "token") {
		t.Fatalf("err = %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := c.Get(ctx, u, 10, 0); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled: %v", err)
	}
}

func TestHTTPClientInvalidate(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		fmt.Fprint(w, "x")
	}))
	defer srv.Close()
	c, _, dir := newClient(t, "ua")
	ctx := context.Background()
	c.Get(ctx, srv.URL, 10, time.Hour)
	if err := c.Invalidate(srv.URL); err != nil {
		t.Fatal(err)
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 0 {
		t.Fatalf("cache not cleared: %v", entries)
	}
	if err := c.Invalidate(srv.URL); err != nil { // already gone
		t.Fatal(err)
	}
	c.Get(ctx, srv.URL, 10, time.Hour)
	if hits.Load() != 2 {
		t.Fatalf("hits = %d, want 2", hits.Load())
	}
}
