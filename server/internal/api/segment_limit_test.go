package api_test

import (
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"qinqin/internal/api"
	"qinqin/internal/dbtest"
	"qinqin/internal/lang"
	"qinqin/internal/ratelimit"
)

func limitServer(t *testing.T, opts ...api.Option) *httptest.Server {
	t.Helper()
	lang.Register(lang.Zh{})
	sqlDB := dbtest.Open(t)
	ts := httptest.NewServer(api.New(sqlDB, t.TempDir(), nil, opts...))
	t.Cleanup(ts.Close)
	return ts
}

func getFrom(t *testing.T, url, ip string) *http.Response {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, url, nil)
	req.Header.Set("X-Forwarded-For", ip)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	return resp
}

// The anonymous lookup routes share a per-address bucket: past it 429
// rate_limited with Retry-After, while another address goes on.
func TestLookupRoutesAreLimitedPerAddress(t *testing.T) {
	p := api.DefaultAuthPolicy()
	p.Named["lookup"] = ratelimit.BucketPolicy{Burst: 3, Every: time.Hour, MaxKeys: 16}
	trusted, _ := api.ParseTrustedProxies("127.0.0.1/32")
	ts := limitServer(t, api.WithAuthPolicy(p), api.WithTrustedProxies(trusted))
	paths := []string{segmentAtPath("zh", "学", "0"), lookupPath("zh", "学", "0"), segmentAtPath("zh", "学", "0")}
	for _, path := range paths {
		if resp := getFrom(t, ts.URL+path, "203.0.113.1"); resp.StatusCode != http.StatusOK {
			t.Fatalf("%s = %d within the burst", path, resp.StatusCode)
		}
	}
	resp := getFrom(t, ts.URL+lookupPath("zh", "学", "0"), "203.0.113.1")
	if resp.StatusCode != http.StatusTooManyRequests || resp.Header.Get("Retry-After") == "" {
		t.Errorf("past the burst = %d, Retry-After %q", resp.StatusCode, resp.Header.Get("Retry-After"))
	}
	if resp := getFrom(t, ts.URL+segmentAtPath("zh", "学", "0"), "203.0.113.2"); resp.StatusCode != http.StatusOK {
		t.Errorf("another address = %d", resp.StatusCode)
	}
}

// A reader's burst — 200 taps and hovers in a row — passes the default
// policy.
func TestReaderBurstPassesTheDefaultLimits(t *testing.T) {
	ts := limitServer(t)
	for i := range 200 {
		path := lookupPath("zh", "学", "0")
		if i%2 == 0 {
			path = segmentAtPath("zh", "学", "0")
		}
		if resp := getFrom(t, ts.URL+path, ""); resp.StatusCode != http.StatusOK {
			t.Fatalf("request %d = %d", i+1, resp.StatusCode)
		}
	}
}

// POST /api/segment allows a few requests in flight per user: one more is
// 429 rate_limited with Retry-After, another user is not affected, and a
// reader's two parallel chunks pass.
func TestSegmentConcurrencyPerUser(t *testing.T) {
	release := make(chan struct{})
	var entered sync.WaitGroup
	hold := func() { entered.Done(); <-release }
	ts := limitServer(t, api.WithSegmentHook(func() { hold() }))
	alice := registerUser(t, ts.URL, "alice", "")
	bob := registerUser(t, ts.URL, "bob", alice)
	body := map[string]string{"lang": "zh", "text": "学"}
	var done sync.WaitGroup
	entered.Add(api.MaxSegmentsInFlight)
	for range api.MaxSegmentsInFlight {
		done.Add(1)
		go func() {
			defer done.Done()
			resp := doJSON(t, http.MethodPost, ts.URL, "/api/segment", alice, body)
			resp.Body.Close()
		}()
	}
	entered.Wait()
	resp := doJSON(t, http.MethodPost, ts.URL, "/api/segment", alice, body)
	if resp.StatusCode != http.StatusTooManyRequests || resp.Header.Get("Retry-After") == "" {
		t.Errorf("one more for alice = %d, Retry-After %q", resp.StatusCode, resp.Header.Get("Retry-After"))
	}
	resp.Body.Close()
	entered.Add(1)
	bobDone := make(chan int, 1)
	go func() {
		r := doJSON(t, http.MethodPost, ts.URL, "/api/segment", bob, body)
		r.Body.Close()
		bobDone <- r.StatusCode
	}()
	entered.Wait() // bob got a slot while alice holds all of hers
	close(release)
	done.Wait()
	if code := <-bobDone; code != http.StatusOK {
		t.Errorf("bob = %d", code)
	}
	// Freed: alice's next request passes.
	hold = func() {}
	if resp := doJSON(t, http.MethodPost, ts.URL, "/api/segment", alice, body); resp.StatusCode != http.StatusOK {
		t.Errorf("alice after the others finished = %d", resp.StatusCode)
	}
}
