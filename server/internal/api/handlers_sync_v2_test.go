package api_test

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"testing"

	"qinqin/internal/auth"
	"qinqin/internal/datapkg"
	chinsync "qinqin/internal/sync"
)

// The paged pull over HTTP (GET /api/sync/pull?v=2, B3): the handler maps
// the sync package's errors to JSON codes, keeps the route's token rule
// and serves exactly what sync.PullPage answers.

type v2Page struct {
	Format      int                          `json:"format"`
	InstanceID  string                       `json:"instanceId"`
	Scope       *chinsync.Scope              `json:"scope"`
	Restarted   []string                     `json:"restarted"`
	Collections map[string][]json.RawMessage `json:"collections"`
	More        bool                         `json:"more"`
	Next        *string                      `json:"next"`
	Cursor      *string                      `json:"cursor"`
}

func syncUserID(t *testing.T, ts string, token string) int64 {
	t.Helper()
	resp := doJSON(t, http.MethodGet, ts, "/api/auth/me", token, nil)
	var me struct {
		ID int64 `json:"id"`
	}
	decodeJSON(t, resp, &me)
	if me.ID == 0 {
		t.Fatal("no user id")
	}
	return me.ID
}

func get(t *testing.T, tsURL, path, token string) (int, http.Header, []byte) {
	t.Helper()
	resp := doJSON(t, http.MethodGet, tsURL, path, token, nil)
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return resp.StatusCode, resp.Header, body
}

func jsonError(t *testing.T, body []byte) (string, string) {
	t.Helper()
	var e struct {
		Error   string `json:"error"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(body, &e); err != nil {
		t.Errorf("error body %q is not JSON: %v", body, err)
	}
	if e.Message == "" {
		t.Errorf("error body %s has no message", body)
	}
	return e.Error, e.Message
}

// seedPluginRows writes n keyed rows of size bytes each for user in ws.
func seedPluginRows(t *testing.T, ctx context.Context, exec func(string, ...any), user, ws int64, n, size int) {
	t.Helper()
	data := `"` + strings.Repeat("x", size) + `"`
	for i := range n {
		exec(`INSERT INTO keyed_rows (user_id, workspace_id, key, data, version, updated_at, modified_at)
			VALUES (?, ?, ?, ?, 1, ?, ?)`, user, ws, fmt.Sprintf("note:%d", i+1), data,
			fmt.Sprintf("2026-01-01T00:%02d:%02dZ", i/60, i%60), "2026-01-01T00:00:00Z")
	}
}

func TestSyncPullV2Handler(t *testing.T) {
	ctx := context.Background()
	ts, sqlDB := newServer(t)
	alice := registerUser(t, ts.URL, "alice", "")
	bob := registerUser(t, ts.URL, "bob", alice)
	aliceID := syncUserID(t, ts.URL, alice)
	wsZh := createWorkspace(t, ts.URL, alice, "zh", "Chinese")
	createWorkspace(t, ts.URL, alice, "ja", "Japanese")
	bobWS := createWorkspace(t, ts.URL, bob, "zh", "Chinese")
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := sqlDB.Exec(q, args...); err != nil {
			t.Fatal(err)
		}
	}
	seedPluginRows(t, ctx, exec, aliceID, wsZh, 7, 10)
	// A round ships rows stamped before its clock second (stamp < until);
	// workspaces made in the second of the round would miss it.
	exec(`UPDATE workspaces SET updated_at = '2026-01-01T00:00:00Z'`)

	t.Run("v=2 selects the paged form; without it the answer is 404", func(t *testing.T) {
		st, h, body := get(t, ts.URL, "/api/sync/pull?v=2", alice)
		if st != http.StatusOK {
			t.Fatalf("v=2: %d %s", st, body)
		}
		var top map[string]json.RawMessage
		json.Unmarshal(body, &top)
		if string(top["format"]) != "2" || top["more"] == nil || top["entries"] != nil {
			t.Errorf("v=2 answer is not a page: %s", body[:min(len(body), 200)])
		}
		if cc, want := h.Get("Cache-Control"), contractCacheControl(t, "sync", "pull-page.json"); cc != want {
			t.Errorf("Cache-Control %q, want %q (sync/pull-page.json)", cc, want)
		}
		if ct := h.Get("Content-Type"); ct != "application/json" {
			t.Errorf("Content-Type %q", ct)
		}
		// without v=2: the removed legacy form (legacy_removed_test.go)
		if st, _, body = get(t, ts.URL, "/api/sync/pull", alice); st != http.StatusNotFound {
			t.Errorf("legacy form: %d %s, want 404", st, body[:min(len(body), 200)])
		}
	})

	t.Run("errors are JSON codes", func(t *testing.T) {
		first := v2Page{}
		st, _, body := get(t, ts.URL, "/api/sync/pull?v=2&limit=2", alice)
		if st != 200 || json.Unmarshal(body, &first) != nil || first.Next == nil {
			t.Fatalf("first page: %d %s", st, body)
		}
		next := url.QueryEscape(*first.Next)
		cases := []struct {
			name, query, code string
			status            int
		}{
			{"page with since", "page=" + next + "&since=c2.x", "sync_page_invalid", 400},
			{"page with collections", "page=" + next + "&collections=rows", "sync_page_invalid", 400},
			{"page with workspace", "page=" + next + "&workspace=" + strconv.FormatInt(wsZh, 10), "sync_page_invalid", 400},
			{"page with limit", "page=" + next + "&limit=5", "sync_page_invalid", 400},
			{"garbled page", "page=p2.garbage", "sync_page_invalid", 400},
			{"limit 0", "limit=0", "sync_page_invalid", 400},
			{"limit 2001", "limit=2001", "sync_page_invalid", 400},
			{"limit abc", "limit=abc", "sync_page_invalid", 400},
			{"unknown collection", "collections=rows,flashcards", "sync_page_invalid", 400},
			{"moved collection", "collections=rows,entries", "sync_collection_moved", 400},
			{"foreign workspace", "workspace=" + strconv.FormatInt(bobWS, 10), "not_found", 404},
			{"unknown workspace", "workspace=999999", "not_found", 404},
		}
		for _, c := range cases {
			st, _, body := get(t, ts.URL, "/api/sync/pull?v=2&"+c.query, alice)
			if st != c.status {
				t.Errorf("%s: %d %s, want %d", c.name, st, body, c.status)
				continue
			}
			if code, msg := jsonError(t, body); code != c.code {
				t.Errorf("%s: code %q, want %q", c.name, code, c.code)
			} else if c.code == "sync_collection_moved" && !strings.Contains(msg, "/api/packages") {
				t.Errorf("%s: message %q does not name /api/packages", c.name, msg)
			}
		}
		// Alice's page token used by bob is refused and leaks nothing.
		st, _, body = get(t, ts.URL, "/api/sync/pull?v=2&page="+next, bob)
		if code, _ := jsonError(t, body); st != 400 || code != "sync_page_invalid" || strings.Contains(string(body), "k000") {
			t.Errorf("bob with alice's token: %d %s", st, body)
		}
	})

	t.Run("401, 403 and the token rule", func(t *testing.T) {
		if st, _, _ := get(t, ts.URL, "/api/sync/pull?v=2", ""); st != http.StatusUnauthorized {
			t.Errorf("anonymous: %d, want 401", st)
		}
		read, _, err := auth.CreateToken(ctx, sqlDB, aliceID, auth.TokenRequest{Name: "r", Scope: "read", ExpiresInDays: 30})
		if err != nil {
			t.Fatal(err)
		}
		if st, _, body := get(t, ts.URL, "/api/sync/pull?v=2", read); st != http.StatusOK {
			t.Errorf("read token: %d %s, want 200", st, body)
		}
		limited, _, err := auth.CreateToken(ctx, sqlDB, aliceID, auth.TokenRequest{Name: "l", Scope: "read", ExpiresInDays: 30, WorkspaceID: &wsZh})
		if err != nil {
			t.Fatal(err)
		}
		st, _, body := get(t, ts.URL, "/api/sync/pull?v=2&workspace="+strconv.FormatInt(wsZh, 10), limited)
		if st != http.StatusForbidden {
			t.Errorf("workspace-limited token: %d %s, want 403 (the route's token rule)", st, body)
		}
		carol := registerUser(t, ts.URL, "carol", alice)
		restrict(t, sqlDB, "carol")
		if st, _, _ := get(t, ts.URL, "/api/sync/pull?v=2", carol); st != http.StatusForbidden {
			t.Errorf("restricted session: %d, want 403", st)
		}
	})

	t.Run("a round over HTTP equals PullPage", func(t *testing.T) {
		httpRows := map[string][]string{}
		var scope *chinsync.Scope
		path := "/api/sync/pull?v=2&limit=3"
		pages := 0
		for {
			st, _, body := get(t, ts.URL, path, alice)
			var p v2Page
			if st != 200 || json.Unmarshal(body, &p) != nil {
				t.Fatalf("page %d: %d %s", pages, st, body)
			}
			if pages == 0 {
				scope = p.Scope
			} else if p.Scope != nil {
				t.Errorf("scope on page %d", pages)
			}
			for c, list := range p.Collections {
				for _, r := range list {
					httpRows[c] = append(httpRows[c], string(r))
				}
			}
			pages++
			if !p.More {
				if p.Cursor == nil {
					t.Fatal("last page without cursor")
				}
				break
			}
			path = "/api/sync/pull?v=2&page=" + url.QueryEscape(*p.Next)
		}
		reg := datapkg.Registry{DB: sqlDB}
		cat := func(ctx context.Context, langs []string) (string, error) {
			c, err := reg.Catalogue(ctx, langs, true) // alice is the instance administrator
			return c.ETag, err
		}
		direct := map[string][]string{}
		req := chinsync.PageRequest{Limit: 3}
		var first chinsync.Page
		for i := 0; ; i++ {
			p, err := chinsync.PullPage(ctx, sqlDB, aliceID, req, cat)
			if err != nil {
				t.Fatal(err)
			}
			if i == 0 {
				first = p
			}
			for c, raw := range p.Collections {
				var list []json.RawMessage
				json.Unmarshal(raw, &list)
				for _, r := range list {
					direct[c] = append(direct[c], string(r))
				}
			}
			if !p.More {
				break
			}
			req = chinsync.PageRequest{Page: *p.Next}
		}
		for _, c := range chinsync.V2Collections {
			if !slices.Equal(httpRows[c], direct[c]) {
				t.Errorf("%s over HTTP %v, direct %v", c, httpRows[c], direct[c])
			}
		}
		if len(httpRows["rows"]) != 7 || len(httpRows["workspaces"]) != 2 {
			t.Errorf("round rows: %d plugin rows, %d workspaces", len(httpRows["rows"]), len(httpRows["workspaces"]))
		}
		got, _ := json.Marshal(scope)
		want, _ := json.Marshal(first.Scope)
		if string(got) != string(want) || scope == nil || scope.Catalogue == "" {
			t.Errorf("scope over HTTP %s, direct %s", got, want)
		}
		if !slices.Equal(scope.Languages, []string{"ja", "zh"}) {
			t.Errorf("scope languages %v", scope.Languages)
		}
	})

	t.Run("a page stays within 4 MiB plus its largest row", func(t *testing.T) {
		dave := registerUser(t, ts.URL, "dave", alice)
		daveID := syncUserID(t, ts.URL, dave)
		ws := createWorkspace(t, ts.URL, dave, "zh", "Chinese")
		const rowBytes = 300 << 10
		seedPluginRows(t, ctx, exec, daveID, ws, 30, rowBytes) // about 9 MiB
		path := "/api/sync/pull?v=2&collections=rows&limit=2000"
		total := 0
		for pages := 0; ; pages++ {
			st, _, body := get(t, ts.URL, path, dave)
			var p v2Page
			if st != 200 || json.Unmarshal(body, &p) != nil {
				t.Fatalf("page %d: %d", pages, st)
			}
			n := 0
			for _, r := range p.Collections["rows"] {
				n += len(r)
			}
			if n > chinsync.MaxPageBytes+rowBytes+1024 {
				t.Errorf("page %d holds %d row bytes", pages, n)
			}
			if len(body) > chinsync.MaxPageBytes+rowBytes+64<<10 {
				t.Errorf("page %d is %d bytes", pages, len(body))
			}
			if len(p.Collections["rows"]) == 0 {
				t.Errorf("page %d is empty", pages)
			}
			total += len(p.Collections["rows"])
			if !p.More {
				if pages == 0 {
					t.Error("9 MiB in one page")
				}
				break
			}
			path = "/api/sync/pull?v=2&page=" + url.QueryEscape(*p.Next)
		}
		if total != 30 {
			t.Errorf("%d rows over the round, want 30", total)
		}
	})
}
