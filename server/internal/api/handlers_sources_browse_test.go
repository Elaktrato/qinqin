package api_test

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"qinqin/internal/library/sources"
)

// fakeBrowser is a fakeSource that also offers a browse assortment.
type fakeBrowser struct {
	*fakeSource
	browse []sources.Result
	err    error

	bmu      sync.Mutex
	calls    int
	gotLang  string
	gotSeed  string
	gotLimit int
	hasDL    bool
}

func (f *fakeBrowser) Browse(ctx context.Context, language, seed string, limit int) ([]sources.Result, error) {
	f.bmu.Lock()
	defer f.bmu.Unlock()
	f.calls++
	f.gotLang, f.gotSeed, f.gotLimit = language, seed, limit
	_, f.hasDL = ctx.Deadline()
	return f.browse, f.err
}

// seen returns what the last Browse call received, under the lock.
func (f *fakeBrowser) seen() (calls int, lang, seed string, limit int, hasDL bool) {
	f.bmu.Lock()
	defer f.bmu.Unlock()
	return f.calls, f.gotLang, f.gotSeed, f.gotLimit, f.hasDL
}

func TestSourcesBrowse(t *testing.T) {
	fb := &fakeBrowser{fakeSource: &fakeSource{id: "aozora"}, browse: []sources.Result{
		{SourceID: "1", Title: "東京", Author: "A", Language: "ja", Reading: "とうきょう"},
	}}
	plain := &fakeSource{id: "plain"}
	ts, _, _ := newSourcesServerAt(t, time.Date(2026, 11, 15, 15, 30, 0, 0, time.UTC), fb, plain)
	if resp := doJSON(t, http.MethodGet, ts.URL, "/api/library/sources/aozora/browse", "", nil); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("no token: status = %d, want 401", resp.StatusCode)
	}
	alice := registerUser(t, ts.URL, "alice", "")

	resp := doJSON(t, http.MethodGet, ts.URL, "/api/library/sources/aozora/browse?language=ja", alice, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d: %s", resp.StatusCode, bodyOf(t, resp))
	}
	var out []struct {
		SourceID string `json:"sourceId"`
		Title    string `json:"title"`
		Reading  string `json:"reading"`
	}
	decodeJSON(t, resp, &out)
	if len(out) != 1 || out[0].SourceID != "1" || out[0].Reading != "とうきょう" {
		t.Errorf("results = %+v", out)
	}
	_, gotLang, gotSeed, gotLimit, hasDL := fb.seen()
	if gotLang != "ja" || gotLimit != 12 || !hasDL {
		t.Errorf("source saw lang=%q limit=%d deadline=%v", gotLang, gotLimit, hasDL)
	}
	if gotSeed != "2026-11-15" {
		t.Errorf("default seed = %q, want the learner date 2026-11-15 (UTC, no zone set)", gotSeed)
	}
	// With a zone the default seed is the learner's date: 15:30Z is the 16th in Tokyo.
	doRaw(t, http.MethodPut, ts.URL, "/api/me/time-zone", alice, `{"zone":"Asia/Tokyo"}`)
	doJSON(t, http.MethodGet, ts.URL, "/api/library/sources/aozora/browse?language=ja", alice, nil)
	if _, _, seed, _, _ := fb.seen(); seed != "2026-11-16" {
		t.Errorf("tokyo default seed = %q, want 2026-11-16", seed)
	}

	resp = doJSON(t, http.MethodGet, ts.URL, "/api/library/sources/aozora/browse?language=ja&seed=abc", alice, nil)
	if _, _, seed, _, _ := fb.seen(); resp.StatusCode != http.StatusOK || seed != "abc" {
		t.Errorf("seed: status %d, seed %q", resp.StatusCode, seed)
	}

	// limit: default 12, clamped to 1..50, non-integers refused
	for query, want := range map[string]int{"limit=5": 5, "limit=50": 50, "limit=500": 50, "limit=0": 1, "limit=-3": 1} {
		resp := doJSON(t, http.MethodGet, ts.URL, "/api/library/sources/aozora/browse?language=ja&"+query, alice, nil)
		if _, _, _, limit, _ := fb.seen(); resp.StatusCode != http.StatusOK || limit != want {
			t.Errorf("%s: status %d, limit %d, want %d", query, resp.StatusCode, limit, want)
		}
	}
	for _, query := range []string{"limit=abc", "limit=1.5", "limit=", "language=JA!", "language=" + strings.Repeat("a", 40), "seed=" + strings.Repeat("s", 200)} {
		resp := doJSON(t, http.MethodGet, ts.URL, "/api/library/sources/aozora/browse?"+query, alice, nil)
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want 400", query, resp.StatusCode)
		}
	}

	// a language the source does not hold is an empty assortment, and
	// the source is not asked
	before, _, _, _, _ := fb.seen()
	resp = doJSON(t, http.MethodGet, ts.URL, "/api/library/sources/aozora/browse?language=zh", alice, nil)
	after, _, _, _, _ := fb.seen()
	if got := strings.TrimSpace(bodyOf(t, resp)); resp.StatusCode != http.StatusOK || got != "[]" || after != before {
		t.Errorf("zh on aozora: %d %s (calls %d -> %d)", resp.StatusCode, got, before, after)
	}

	if resp := doJSON(t, http.MethodGet, ts.URL, "/api/library/sources/nope/browse", alice, nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("unknown source: status = %d, want 404", resp.StatusCode)
	}
	if resp := doJSON(t, http.MethodGet, ts.URL, "/api/library/sources/plain/browse", alice, nil); resp.StatusCode != http.StatusNotImplemented {
		t.Errorf("source without browse: status = %d, want 501", resp.StatusCode)
	}
}

func TestSourcesBrowseEmptyAndUnavailable(t *testing.T) {
	fb := &fakeBrowser{fakeSource: &fakeSource{id: "gutenberg"}}
	ts, _, _ := newSourcesServer(t, fb)
	alice := registerUser(t, ts.URL, "alice", "")
	resp := doJSON(t, http.MethodGet, ts.URL, "/api/library/sources/gutenberg/browse?language=zh", alice, nil)
	if got := strings.TrimSpace(bodyOf(t, resp)); resp.StatusCode != http.StatusOK || got != "[]" {
		t.Errorf("empty: %d %s", resp.StatusCode, got)
	}
	fb.bmu.Lock()
	fb.err = errors.New("sources: GET 10.0.0.1: request failed")
	fb.bmu.Unlock()
	resp = doJSON(t, http.MethodGet, ts.URL, "/api/library/sources/gutenberg/browse?language=zh", alice, nil)
	body := bodyOf(t, resp)
	if resp.StatusCode != http.StatusBadGateway || strings.Contains(body, "10.0.0.1") {
		t.Errorf("offline: %d %s", resp.StatusCode, body)
	}
}
