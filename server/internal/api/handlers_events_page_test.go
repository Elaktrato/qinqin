package api_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"qinqin/internal/events"
	chinsync "qinqin/internal/sync"

	"github.com/oklog/ulid/v2"
)

// The paged form of GET /api/events (#110, docs/contracts/events/page.json):
// limit or page select it; the legacy array stays (streamed, deprecated).

type eventsPage struct {
	Events []json.RawMessage `json:"events"`
	More   bool              `json:"more"`
	Next   *string           `json:"next"`
}

func postEvents(t *testing.T, tsURL, token string, ws int64, n int, base time.Time) {
	t.Helper()
	for start := 0; start < n; start += 500 {
		evs := []map[string]any{}
		for i := start; i < min(n, start+500); i++ {
			evs = append(evs, map[string]any{"id": ulid.Make().String(), "workspaceId": ws, "device": "web",
				"ts": base.Add(time.Duration(i/2) * time.Second).Format(time.RFC3339), "type": []string{"review", "lookup"}[i%2],
				"payload": map[string]int{"i": i}})
		}
		if r := doJSON(t, http.MethodPost, tsURL, "/api/events/batch", token, map[string]any{"events": evs}); r.StatusCode != 200 {
			t.Fatalf("batch: %d", r.StatusCode)
		}
	}
}

// walkEvents follows a paged walk over HTTP from first, repeating
// workspace (when given) on every continuation; it returns the joined
// items and the page count.
func walkEvents(t *testing.T, tsURL, token, first, workspace string) (string, int) {
	t.Helper()
	parts := []string{}
	path := first
	for n := 1; ; n++ {
		st, h, body := get(t, tsURL, path, token)
		if st != 200 {
			t.Fatalf("page %d %s: %d %s", n, path, st, body)
		}
		if cc, want := h.Get("Cache-Control"), contractCacheControl(t, "events", "page.json"); cc != want {
			t.Errorf("page %d Cache-Control %q, want %q (events/page.json)", n, cc, want)
		}
		var p eventsPage
		dec := json.NewDecoder(strings.NewReader(string(body)))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&p); err != nil || p.Events == nil {
			t.Fatalf("page %d is not a page: %v %s", n, err, body[:min(200, len(body))])
		}
		for _, raw := range p.Events {
			parts = append(parts, string(raw))
		}
		if !p.More {
			if p.Next != nil {
				t.Fatalf("last page has next")
			}
			return "[" + strings.Join(parts, ",") + "]", n
		}
		path = "/api/events?page=" + url.QueryEscape(*p.Next)
		if workspace != "" {
			path += "&workspace=" + workspace
		}
	}
}

func TestEventsPagedHandler(t *testing.T) {
	ts, _ := newServer(t)
	alice := registerUser(t, ts.URL, "alice", "")
	bob := registerUser(t, ts.URL, "bob", alice)
	wsZh := createWorkspace(t, ts.URL, alice, "zh", "Chinese")
	wsJa := createWorkspace(t, ts.URL, alice, "ja", "Japanese")
	bobWS := createWorkspace(t, ts.URL, bob, "zh", "Chinese")
	base := time.Date(2026, 11, 1, 9, 0, 0, 0, time.UTC)
	postEvents(t, ts.URL, alice, wsZh, 1205, base)
	postEvents(t, ts.URL, alice, wsJa, 30, base)
	postEvents(t, ts.URL, bob, bobWS, 20, base)
	zh, ja := strconv.FormatInt(wsZh, 10), strconv.FormatInt(wsJa, 10)

	t.Run("the walk equals the legacy answer", func(t *testing.T) {
		for _, tc := range []struct{ query, ws string }{
			{"since=1970-01-01T00:00:00Z&workspace=" + zh, zh},
			{"workspace=" + ja, ja},
			{"since=2026-11-01T09:03:00Z&workspace=" + zh, zh},
			{"", ""},
		} {
			st, h, legacy := get(t, ts.URL, "/api/events?"+tc.query, alice)
			if st != 200 || h.Get("Deprecation") != "true" || !strings.Contains(h.Get("Link"), `rel="successor-version"`) {
				t.Errorf("legacy %q: %d Deprecation %q Link %q", tc.query, st, h.Get("Deprecation"), h.Get("Link"))
			}
			if ct := h.Get("Content-Type"); ct != "application/json" {
				t.Errorf("legacy Content-Type %q", ct)
			}
			for _, limit := range []int{1000, 2000} {
				q := "limit=" + strconv.Itoa(limit)
				if tc.query != "" {
					q += "&" + tc.query
				}
				got, pages := walkEvents(t, ts.URL, alice, "/api/events?"+q, tc.ws)
				if got != string(legacy) {
					t.Errorf("%s: walk differs from the legacy answer (%d vs %d bytes)", q, len(got), len(legacy))
				}
				if tc.query == "workspace="+ja && pages != 1 {
					t.Errorf("%s: %d pages, want 1", q, pages)
				}
				if strings.HasPrefix(tc.query, "since=1970") && limit == 1000 && pages != 2 {
					t.Errorf("%s: %d pages, want 2", q, pages)
				}
			}
			if strings.Contains(string(legacy), fmt.Sprintf(`"workspaceId":%d`, bobWS)) {
				t.Errorf("alice's log shows bob's events")
			}
		}
	})

	t.Run("unauthenticated is 401 in both forms", func(t *testing.T) {
		for _, q := range []string{"", "?limit=5", "?page=e1.x", "?workspace=" + zh} {
			if st, _, _ := get(t, ts.URL, "/api/events"+q, ""); st != http.StatusUnauthorized {
				t.Errorf("%q: %d, want 401", q, st)
			}
		}
	})

	t.Run("errors", func(t *testing.T) {
		st, _, body := get(t, ts.URL, "/api/events?limit=3&workspace="+zh, alice)
		var first eventsPage
		if st != 200 || json.Unmarshal(body, &first) != nil || first.Next == nil {
			t.Fatalf("first page: %d %s", st, body)
		}
		next := url.QueryEscape(*first.Next)
		for _, tc := range []struct {
			name, token, query string
			status             int
			code               string
		}{
			{"limit 0", alice, "limit=0", 400, "events_page_invalid"},
			{"limit 2001", alice, "limit=2001", 400, "events_page_invalid"},
			{"limit text", alice, "limit=many", 400, "events_page_invalid"},
			{"empty page", alice, "page=", 400, "events_page_invalid"},
			{"garbled page", alice, "page=e1.%21%21&workspace=" + zh, 400, "events_page_invalid"},
			{"continuation repeats since", alice, "page=" + next + "&workspace=" + zh + "&since=2026-01-01T00:00:00Z", 400, "events_page_invalid"},
			{"continuation repeats limit", alice, "page=" + next + "&workspace=" + zh + "&limit=3", 400, "events_page_invalid"},
			{"continuation drops workspace", alice, "page=" + next, 400, "events_page_invalid"},
			{"continuation names another workspace", alice, "page=" + next + "&workspace=" + ja, 400, "events_page_invalid"},
			{"bob replays alice's token on his workspace", bob, "page=" + next + "&workspace=" + strconv.FormatInt(bobWS, 10), 400, "events_page_invalid"},
			{"bob replays alice's token on her workspace", bob, "page=" + next + "&workspace=" + zh, 404, ""},
			{"bob's first page on alice's workspace", bob, "limit=5&workspace=" + zh, 404, ""},
			{"bad since", alice, "limit=5&since=yesterday", 400, ""},
			{"bad workspace", alice, "limit=5&workspace=x", 400, ""},
		} {
			st, _, body := get(t, ts.URL, "/api/events?"+tc.query, tc.token)
			if st != tc.status {
				t.Errorf("%s: %d %s, want %d", tc.name, st, body, tc.status)
				continue
			}
			if tc.code != "" {
				if code, _ := jsonError(t, body); code != tc.code {
					t.Errorf("%s: code %q, want %q", tc.name, code, tc.code)
				}
			}
		}
	})

	t.Run("a workspace-limited token walks its workspace", func(t *testing.T) {
		var tk struct {
			Token string `json:"token"`
		}
		r := doJSON(t, http.MethodPost, ts.URL, "/api/account/tokens", alice, map[string]any{"name": "script", "scope": "read",
			"expiresInDays": 1, "workspaceId": wsZh, "currentPassword": "secret-pass-alice"})
		decodeJSON(t, r, &tk)
		if r.StatusCode != 201 || tk.Token == "" {
			t.Fatalf("create token: %d", r.StatusCode)
		}
		_, _, legacy := get(t, ts.URL, "/api/events?workspace="+zh, alice)
		if got, pages := walkEvents(t, ts.URL, tk.Token, "/api/events?limit=500&workspace="+zh, zh); got != string(legacy) || pages != 3 {
			t.Errorf("token walk: %d pages, equal %v", pages, got == string(legacy))
		}
		st, _, body := get(t, ts.URL, "/api/events?limit=500&workspace="+zh, tk.Token)
		var first eventsPage
		json.Unmarshal(body, &first)
		if st != 200 || first.Next == nil {
			t.Fatalf("token first page: %d", st)
		}
		for _, q := range []string{"page=" + url.QueryEscape(*first.Next), "limit=5", "limit=5&workspace=" + ja} {
			if st, _, _ := get(t, ts.URL, "/api/events?"+q, tk.Token); st != http.StatusForbidden {
				t.Errorf("token %q: %d, want 403 token_workspace", q, st)
			}
		}
	})
}

// The page budget is the pull's.
func TestEventsPageBudgetIsThePulls(t *testing.T) {
	if events.MaxPageLimit != chinsync.MaxPageLimit || events.MaxPageBytes != chinsync.MaxPageBytes {
		t.Errorf("events budget %d/%d, pull %d/%d", events.MaxPageLimit, events.MaxPageBytes, chinsync.MaxPageLimit, chinsync.MaxPageBytes)
	}
}
