package api_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"qinqin/internal/auth"
	"qinqin/internal/library"
)

// tokenWorld: alice owns workspaces A and B, both populated (an event, a
// flashcards row, a book with a bookmark and a highlight); bob owns C,
// populated too. Tokens are minted directly in the store.
type tokenWorld struct {
	url                 string
	alice, bob          string // sessions
	aliceID, bobID      int64
	wsA, wsB, wsC       int64
	bookA, bookB, bookC int64
	limitedA, writeAll  string // alice's tokens
	bobWrite            string
}

func newTokenWorld(t *testing.T) tokenWorld {
	t.Helper()
	ts, sqlDB, dataDir := newServerWithDir(t)
	store := library.Store{DB: sqlDB, Dir: filepath.Join(dataDir, "books")}
	w := tokenWorld{url: ts.URL}
	w.alice = registerUser(t, ts.URL, "alice", "")
	w.bob = registerUser(t, ts.URL, "bob", w.alice)
	seedBuiltin(t, sqlDB, deleteTestPlugin)
	w.aliceID, w.bobID = userID(t, sqlDB, "alice"), userID(t, sqlDB, "bob")
	w.wsA = createWorkspace(t, ts.URL, w.alice, "zh", "A")
	w.wsB = createWorkspace(t, ts.URL, w.alice, "zh", "B")
	w.wsC = createWorkspace(t, ts.URL, w.bob, "zh", "C")
	w.bookA = populateWorkspace(t, ts.URL, w.alice, store, w.aliceID, w.wsA, 1)
	w.bookB = populateWorkspace(t, ts.URL, w.alice, store, w.aliceID, w.wsB, 2)
	w.bookC = populateWorkspace(t, ts.URL, w.bob, store, w.bobID, w.wsC, 3)
	mint := func(u int64, scope string, ws *int64) string {
		tok, _, err := auth.CreateToken(context.Background(), sqlDB, u, auth.TokenRequest{Name: "t", Scope: scope, ExpiresInDays: 30, WorkspaceID: ws})
		if err != nil {
			t.Fatal(err)
		}
		return tok
	}
	w.limitedA = mint(w.aliceID, "write", &w.wsA)
	w.writeAll = mint(w.aliceID, "write", nil)
	w.bobWrite = mint(w.bobID, "write", nil)
	return w
}

func body(t *testing.T, resp *http.Response) string {
	t.Helper()
	b, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	return string(b)
}

// Matrix 8: a token limited to A sees only A's rows on every wsQuery read,
// and writes only A's plugin rows.
func TestLimitedTokenSeesOnlyItsWorkspace(t *testing.T) {
	w := newTokenWorld(t)
	A, B := strconv.FormatInt(w.wsA, 10), strconv.FormatInt(w.wsB, 10)
	get := func(path string) (int, string) {
		resp := doJSON(t, http.MethodGet, w.url, path, w.limitedA, nil)
		return resp.StatusCode, body(t, resp)
	}
	// events: only A's event (populateWorkspace n=1 -> eventID(1)).
	st, b := get("/api/events?workspace=" + A)
	if st != 200 || !strings.Contains(b, eventID(1)) || strings.Contains(b, eventID(2)) || strings.Contains(b, eventID(3)) {
		t.Errorf("events: %d %s", st, b)
	}
	// books: only A's book.
	st, b = get("/api/library/books?workspace=" + A)
	var books []struct{ ID int64 }
	json.Unmarshal([]byte(b), &books)
	if st != 200 || len(books) != 1 || books[0].ID != w.bookA {
		t.Errorf("books: %d %s", st, b)
	}
	// plugin data list and single row: A's row only.
	st, b = get("/api/plugins/qinqin-flashcards/data?workspace=" + A)
	var rows []struct {
		WorkspaceID *int64 `json:"workspaceId"`
	}
	json.Unmarshal([]byte(b), &rows)
	// populateWorkspace: one keyed row plus one typed study row of each of
	// the six families, which the legacy view lists as plugin rows.
	if st != 200 || len(rows) != 7 {
		t.Errorf("plugin data list: %d %s", st, b)
	}
	for _, r := range rows {
		if r.WorkspaceID == nil || *r.WorkspaceID != w.wsA {
			t.Errorf("plugin data list row of another workspace: %s", b)
		}
	}
	if st, b = get("/api/plugins/qinqin-flashcards/data/known:1?workspace=" + A); st != 200 || !strings.Contains(b, `"workspaceId":`+A) {
		t.Errorf("plugin data row: %d %s", st, b)
	}
	// stats: the handler is reached with A (no activity rule is installed
	// here, so the cells are empty either way; the refusals below matter).
	if st, b = get("/api/stats/activity?from=2026-11-01&to=2026-11-30&workspace=" + A); st != 200 {
		t.Errorf("activity: %d %s", st, b)
	}
	// The other own workspace, a missing parameter and bob's are refused.
	for _, path := range []string{"/api/events?workspace=" + B, "/api/events", "/api/library/books?workspace=" + strconv.FormatInt(w.wsC, 10),
		"/api/plugins/qinqin-flashcards/data", "/api/stats/activity?workspace=" + B} {
		if st, b := get(path); st != 403 || !strings.Contains(b, "token_workspace") {
			t.Errorf("%s: %d %s, want 403 token_workspace", path, st, b)
		}
	}
	// Writes: A's row changes, B's not; B and user-global are refused.
	if resp := doRaw(t, http.MethodPut, w.url, "/api/plugins/qinqin-flashcards/data/known:1?workspace="+A, w.limitedA, `{"id":"changed"}`); resp.StatusCode != 200 {
		t.Errorf("put A: %d %s", resp.StatusCode, body(t, resp))
	}
	for _, path := range []string{"/api/plugins/qinqin-flashcards/data/known:1?workspace=" + B, "/api/plugins/qinqin-flashcards/data/settings"} {
		if resp := doRaw(t, http.MethodPut, w.url, path, w.limitedA, `{"id":"changed"}`); resp.StatusCode != 403 {
			t.Errorf("put %s: %d, want 403", path, resp.StatusCode)
		}
	}
	_, bRow := doJSONBody(t, http.MethodGet, w.url, "/api/plugins/qinqin-flashcards/data/known:1?workspace="+B, w.alice)
	if strings.Contains(bRow, "changed") {
		t.Error("B's row changed")
	}
	// Matrix 10: spanning and by-id routes are out of reach.
	for _, path := range []string{"/api/sync/pull", "/api/workspaces", "/api/library/books/" + strconv.FormatInt(w.bookA, 10)} {
		if st, b := get(path); st != 403 || !strings.Contains(b, "token_workspace") {
			t.Errorf("%s: %d %s, want 403 token_workspace", path, st, b)
		}
	}
	// wsGlobal reads pass.
	if st, b := get("/api/languages"); st != 200 {
		t.Errorf("languages: %d %s", st, b)
	}
}

// Matrix 11: a token of alice reaches bob's objects exactly like alice's
// session does: not at all (404, no leak).
func TestTokenCannotReachAnotherUsersData(t *testing.T) {
	w := newTokenWorld(t)
	C := strconv.FormatInt(w.wsC, 10)
	bookC := "/api/library/books/" + strconv.FormatInt(w.bookC, 10)
	for _, c := range []struct{ method, path string }{
		{"GET", bookC},
		{"GET", bookC + "/bookmarks"},
		{"GET", bookC + "/highlights"},
		{"GET", bookC + "/chapters/0"},
		{"GET", "/api/events?workspace=" + C},
		{"GET", "/api/library/books?workspace=" + C},
		{"GET", "/api/plugins/qinqin-flashcards/data?workspace=" + C},
		{"GET", "/api/plugins/qinqin-flashcards/data/known:1?workspace=" + C},
		{"DELETE", bookC},
	} {
		tokSt, _ := doJSONBody(t, c.method, w.url, c.path, w.writeAll)
		if tokSt != 404 {
			t.Errorf("%s %s with alice's token: %d, want 404", c.method, c.path, tokSt)
		}
	}
	// bob's book is still there for bob.
	if st, _ := doJSONBody(t, "GET", w.url, bookC, w.bobWrite); st != 200 {
		t.Errorf("bob's book with bob's token: %d", st)
	}
	// alice's pull with her token carries none of bob's rows.
	_, pull := doJSONBody(t, "GET", w.url, "/api/sync/pull?cursor=1970-01-01T00:00:00Z", w.writeAll)
	if strings.Contains(pull, `"workspaceId":`+C) || strings.Contains(pull, `"userId":`+strconv.FormatInt(w.bobID, 10)) {
		t.Errorf("alice's pull carries bob's rows: %s", pull)
	}
	if !strings.Contains(pull, `"workspaceId":`+strconv.FormatInt(w.wsA, 10)) {
		t.Errorf("alice's pull lacks her own rows: %.300s", pull)
	}
}

func doJSONBody(t *testing.T, method, url, path, token string) (int, string) {
	t.Helper()
	resp := doJSON(t, method, url, path, token, nil)
	return resp.StatusCode, body(t, resp)
}
