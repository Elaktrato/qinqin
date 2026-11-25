package update

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

type fakeGitHub struct {
	mu       sync.Mutex
	srv      *httptest.Server
	body     string
	etag     string
	status   int // 0: serve body
	requests []*http.Request
}

func newFakeGitHub(t *testing.T, releases ...map[string]any) *fakeGitHub {
	t.Helper()
	f := &fakeGitHub{etag: `W/"one"`}
	f.set(releases...)
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.requests = append(f.requests, r.Clone(context.Background()))
		if f.status != 0 {
			w.WriteHeader(f.status)
			return
		}
		if r.Header.Get("If-None-Match") == f.etag {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("ETag", f.etag)
		w.Write([]byte(f.body))
	}))
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeGitHub) set(releases ...map[string]any) {
	b, _ := json.Marshal(releases)
	f.body = string(b)
}

func (f *fakeGitHub) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.requests)
}

func rel(tag string, extra ...any) map[string]any {
	m := map[string]any{"tag_name": tag, "name": "qinqin " + tag, "body": "Notes of " + tag, "draft": false,
		"prerelease": false, "published_at": "2026-11-20T10:00:00Z", "html_url": "https://github.com/Elaktrato/qinqin/releases/tag/" + tag}
	for i := 0; i+1 < len(extra); i += 2 {
		m[extra[i].(string)] = extra[i+1]
	}
	return m
}

type clock struct{ t time.Time }

func (c *clock) now() time.Time          { return c.t }
func (c *clock) advance(d time.Duration) { c.t = c.t.Add(d) }

func newChecker(f *fakeGitHub, cl *clock, token string) *Checker {
	return NewChecker(Config{BaseURL: f.srv.URL, Repo: "Elaktrato/qinqin", Token: token, Now: cl.now})
}

func start() *clock { return &clock{time.Date(2026, 11, 25, 12, 0, 0, 0, time.UTC)} }

func TestCheckPicksTheNewestStableRelease(t *testing.T) {
	f := newFakeGitHub(t, rel("v0.6.0"), rel("v0.7.0-rc1", "prerelease", true), rel("v0.6.1"), rel("v9.9.9", "draft", true), rel("nightly"))
	c := newChecker(f, start(), "")
	got := c.Check(context.Background(), false, false)
	if got.State != StateOK || got.Latest == nil || got.Latest.Version != "0.6.1" || got.Latest.Tag != "v0.6.1" {
		t.Fatalf("stable = %+v", got)
	}
	if got.Latest.Notes != "Notes of v0.6.1" || got.Latest.URL != "https://github.com/Elaktrato/qinqin/releases/tag/v0.6.1" || got.Latest.Prerelease {
		t.Errorf("release = %+v", got.Latest)
	}
	// The pre-release channel needs no second request: the list is cached.
	pre := c.Check(context.Background(), true, false)
	if pre.Latest.Version != "0.7.0-rc1" || !pre.Latest.Prerelease || f.count() != 1 {
		t.Errorf("prerelease = %+v after %d requests", pre.Latest, f.count())
	}
}

func TestCheckSendsOnlyAPlainRequest(t *testing.T) {
	f := newFakeGitHub(t, rel("v0.6.0"))
	newChecker(f, start(), "").Check(context.Background(), false, false)
	r := f.requests[0]
	if r.Method != "GET" || r.URL.Path != "/repos/Elaktrato/qinqin/releases" || r.URL.Query().Get("per_page") != "30" {
		t.Errorf("request = %s %s", r.Method, r.URL)
	}
	if ua := r.Header.Get("User-Agent"); ua != "qinqin-update-check" {
		t.Errorf("User-Agent = %q", ua)
	}
	for _, h := range []string{"Authorization", "Cookie", "Referer", "If-None-Match", "X-Forwarded-For"} {
		if r.Header.Get(h) != "" {
			t.Errorf("%s = %q on a first anonymous request", h, r.Header.Get(h))
		}
	}
	for h := range r.Header {
		switch h {
		case "User-Agent", "Accept", "X-Github-Api-Version", "Accept-Encoding":
		default:
			t.Errorf("unexpected header %s", h)
		}
	}
}

func TestCheckSendsTheTokenAsBearer(t *testing.T) {
	f := newFakeGitHub(t, rel("v0.6.0"))
	newChecker(f, start(), "ghp_secret").Check(context.Background(), false, false)
	if got := f.requests[0].Header.Get("Authorization"); got != "Bearer ghp_secret" {
		t.Errorf("Authorization = %q", got)
	}
}

func TestCheckCachesAndRevalidatesWithTheETag(t *testing.T) {
	f := newFakeGitHub(t, rel("v0.6.0"))
	cl := start()
	c := newChecker(f, cl, "")
	c.Check(context.Background(), false, false)
	cl.advance(5 * time.Hour)
	c.Check(context.Background(), false, false)
	if f.count() != 1 {
		t.Fatalf("a fresh cache made %d requests, want 1", f.count())
	}
	cl.advance(2 * time.Hour) // 7 h: stale
	got := c.Check(context.Background(), false, false)
	if f.count() != 2 || f.requests[1].Header.Get("If-None-Match") != `W/"one"` {
		t.Fatalf("revalidation: %d requests, If-None-Match %q", f.count(), f.requests[1].Header.Get("If-None-Match"))
	}
	if got.State != StateOK || got.Latest.Version != "0.6.0" || !got.CheckedAt.Equal(cl.t) {
		t.Errorf("after a 304 = %+v", got)
	}
	// A new release with a new ETag replaces the cache.
	f.set(rel("v0.6.0"), rel("v0.7.0"))
	f.etag = `W/"two"`
	cl.advance(7 * time.Hour)
	if got := c.Check(context.Background(), false, false); got.Latest.Version != "0.7.0" {
		t.Errorf("after a new release = %+v", got.Latest)
	}
}

func TestCheckNowSkipsTheCacheButNotTheFloor(t *testing.T) {
	f := newFakeGitHub(t, rel("v0.6.0"))
	cl := start()
	c := newChecker(f, cl, "")
	c.Check(context.Background(), false, false)
	cl.advance(10 * time.Second)
	c.Check(context.Background(), false, true)
	if f.count() != 1 {
		t.Errorf("a forced check 10 s after the last one made %d requests, want 1", f.count())
	}
	cl.advance(25 * time.Second)
	c.Check(context.Background(), false, true)
	if f.count() != 2 {
		t.Errorf("a forced check after the floor made %d requests total, want 2", f.count())
	}
}

func TestCheckErrorStates(t *testing.T) {
	cases := []struct {
		name   string
		status int
		body   string
		want   string
	}{
		{"rate limited", 403, "", ErrRateLimited},
		{"too many", 429, "", ErrRateLimited},
		{"server error", 500, "", ErrBadResponse},
		{"not found", 404, "", ErrBadResponse},
		{"not json", 200, "<html>", ErrBadResponse},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newFakeGitHub(t)
			f.status = tc.status
			if tc.status == 200 {
				f.status, f.body = 0, tc.body
			}
			got := newChecker(f, start(), "").Check(context.Background(), false, false)
			if got.State != StateError || got.Error != tc.want || got.Latest != nil {
				t.Errorf("got %+v, want error %s", got, tc.want)
			}
		})
	}
}

func TestCheckOfflineKeepsTheLastAnswerAsStale(t *testing.T) {
	f := newFakeGitHub(t, rel("v0.6.0"))
	cl := start()
	c := newChecker(f, cl, "")
	c.Check(context.Background(), false, false)
	f.srv.Close()
	cl.advance(7 * time.Hour)
	got := c.Check(context.Background(), false, false)
	if got.State != StateError || got.Error != ErrOffline || !got.Stale || got.Latest == nil || got.Latest.Version != "0.6.0" {
		t.Fatalf("offline = %+v", got)
	}
	// A failure is remembered for 15 minutes: no new attempt.
	cl.advance(10 * time.Minute)
	if again := c.Check(context.Background(), false, false); again.Error != ErrOffline {
		t.Errorf("within the failure window = %+v", again)
	}
}

func TestCheckFailureWindowThenRetry(t *testing.T) {
	f := newFakeGitHub(t, rel("v0.6.0"))
	f.status = 500
	cl := start()
	c := newChecker(f, cl, "")
	c.Check(context.Background(), false, false)
	cl.advance(10 * time.Minute)
	c.Check(context.Background(), false, false)
	if f.count() != 1 {
		t.Fatalf("requests within the window = %d, want 1", f.count())
	}
	f.mu.Lock()
	f.status = 0
	f.mu.Unlock()
	cl.advance(6 * time.Minute)
	if got := c.Check(context.Background(), false, false); got.State != StateOK || f.count() != 2 {
		t.Errorf("after the window = %+v (%d requests)", got, f.count())
	}
}

func TestCheckTimesOut(t *testing.T) {
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(5 * time.Second):
		}
	}))
	defer slow.Close()
	c := NewChecker(Config{BaseURL: slow.URL, Repo: "a/b", Timeout: 100 * time.Millisecond})
	start := time.Now()
	got := c.Check(context.Background(), false, false)
	if got.Error != ErrOffline || time.Since(start) > 3*time.Second {
		t.Errorf("slow server = %+v after %v", got, time.Since(start))
	}
}

func TestCheckLimitsNotesAndAcceptsOnlyGitHubLinks(t *testing.T) {
	long := strings.Repeat("é", 20000) // 40000 bytes
	f := newFakeGitHub(t, rel("v0.6.0", "body", long, "html_url", "javascript:alert(1)"))
	got := newChecker(f, start(), "").Check(context.Background(), false, false)
	if len(got.Latest.Notes) > MaxNotes || !strings.HasSuffix(got.Latest.Notes, "…") {
		t.Errorf("notes = %d bytes, tail %q", len(got.Latest.Notes), got.Latest.Notes[len(got.Latest.Notes)-5:])
	}
	if got.Latest.URL != "https://github.com/Elaktrato/qinqin/releases/tag/v0.6.0" {
		t.Errorf("URL = %q", got.Latest.URL)
	}
}

func TestCheckWithoutReleases(t *testing.T) {
	f := newFakeGitHub(t)
	got := newChecker(f, start(), "").Check(context.Background(), false, false)
	if got.State != StateOK || got.Latest != nil {
		t.Errorf("no releases = %+v", got)
	}
}

func TestLastBeforeAnyCheckIsUnchecked(t *testing.T) {
	f := newFakeGitHub(t)
	c := newChecker(f, start(), "")
	if got := c.Last(false); got.State != StateUnchecked || f.count() != 0 {
		t.Errorf("Last = %+v, %d requests", got, f.count())
	}
}

func TestRelation(t *testing.T) {
	cases := []struct{ installed, latest, want string }{
		{"0.6.0", "0.7.0", RelAvailable},
		{"0.7.0", "0.7.0", RelCurrent},
		{"0.8.0", "0.7.0", RelAhead},
		{"0.7.0-rc1", "0.7.0", RelAvailable},
		{"0.7.0", "0.7.1-rc1", RelAvailable},
		{"dev", "0.7.0", RelUnknown},
		{"", "0.7.0", RelUnknown},
		{"0.7.0", "", RelUnknown},
	}
	for _, tc := range cases {
		if got := Relation(tc.installed, tc.latest); got != tc.want {
			t.Errorf("Relation(%q, %q) = %q, want %q", tc.installed, tc.latest, got, tc.want)
		}
	}
}

func TestRelationMatchesTheFixture(t *testing.T) {
	b, err := os.ReadFile("../../../docs/contracts/version/update-check.json")
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		Relation []struct{ Installed, Latest, Update string }
	}
	if err := json.Unmarshal(b, &f); err != nil || len(f.Relation) == 0 {
		t.Fatalf("fixture: %v", err)
	}
	for _, tc := range f.Relation {
		if got := Relation(tc.Installed, tc.Latest); got != tc.Update {
			t.Errorf("Relation(%q, %q) = %q, fixture %q", tc.Installed, tc.Latest, got, tc.Update)
		}
	}
}
