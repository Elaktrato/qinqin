package api_test

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"testing"
)

// bookmarkBody mirrors the bookmark JSON.
type bookmarkBody struct {
	ID        int64  `json:"id"`
	BookID    int64  `json:"bookId"`
	Position  string `json:"position"`
	Label     string `json:"label"`
	CreatedAt string `json:"createdAt"`
}

// bookmarkFixture is alice with one zh book and bob with none.
func bookmarkFixture(t *testing.T) (tsURL, alice, bob, base string, bookID int64) {
	t.Helper()
	ts, _ := newServer(t)
	alice = registerUser(t, ts.URL, "alice", "")
	bob = registerUser(t, ts.URL, "bob", alice)
	zh := newWorkspace(t, ts.URL, alice, "zh", "")
	var b libBook
	decodeJSON(t, uploadBook(t, ts.URL, alice, tinyEpub(t, "zh"), "", zh), &b)
	return ts.URL, alice, bob, "/api/library/books/" + strconv.FormatInt(b.ID, 10) + "/bookmarks", b.ID
}

func listBookmarks(t *testing.T, tsURL, token, base string) []bookmarkBody {
	t.Helper()
	resp := doJSON(t, http.MethodGet, tsURL, base, token, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("list bookmarks: status = %d", resp.StatusCode)
	}
	var out []bookmarkBody
	decodeJSON(t, resp, &out)
	return out
}

func TestBookmarkRoutes(t *testing.T) {
	tsURL, alice, _, base, bookID := bookmarkFixture(t)

	if got := strings.TrimSpace(bodyOf(t, doJSON(t, http.MethodGet, tsURL, base, alice, nil))); got != "[]" {
		t.Errorf("empty list body = %s, want []", got)
	}

	resp := doJSON(t, http.MethodPost, tsURL, base, alice, map[string]string{"position": "0:3", "label": " 你好 "})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("add: status = %d", resp.StatusCode)
	}
	var m bookmarkBody
	decodeJSON(t, resp, &m)
	if m.ID == 0 || m.BookID != bookID || m.Position != "0:3" || m.Label != "你好" || m.CreatedAt == "" {
		t.Errorf("bookmark = %+v", m)
	}

	// The same position again: the existing bookmark, 200 not 201.
	resp = doJSON(t, http.MethodPost, tsURL, base, alice, map[string]string{"position": "0:3", "label": "x"})
	var again bookmarkBody
	decodeJSON(t, resp, &again)
	if resp.StatusCode != http.StatusOK || again != m {
		t.Errorf("repeat: status = %d %+v, want 200 with %+v", resp.StatusCode, again, m)
	}
	// The label is optional.
	resp = doJSON(t, http.MethodPost, tsURL, base, alice, map[string]string{"position": "1:0"})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("add without label: status = %d", resp.StatusCode)
	}
	var m2 bookmarkBody
	decodeJSON(t, resp, &m2)

	if got := listBookmarks(t, tsURL, alice, base); len(got) != 2 || got[0] != m || got[1].ID != m2.ID {
		t.Errorf("list = %+v", got)
	}

	path := base + "/" + strconv.FormatInt(m2.ID, 10)
	resp = doJSON(t, http.MethodPut, tsURL, path, alice, map[string]string{"label": "  Chapter two  "})
	var renamed bookmarkBody
	decodeJSON(t, resp, &renamed)
	if resp.StatusCode != http.StatusOK || renamed.Label != "Chapter two" || renamed.ID != m2.ID {
		t.Errorf("rename: status = %d %+v", resp.StatusCode, renamed)
	}

	if resp := doJSON(t, http.MethodDelete, tsURL, base+"/"+strconv.FormatInt(m.ID, 10), alice, nil); resp.StatusCode != http.StatusNoContent {
		t.Errorf("delete: status = %d, want 204", resp.StatusCode)
	}
	if resp := doJSON(t, http.MethodDelete, tsURL, base+"/"+strconv.FormatInt(m.ID, 10), alice, nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("second delete: status = %d, want 404", resp.StatusCode)
	}
	if got := listBookmarks(t, tsURL, alice, base); len(got) != 1 || got[0].Label != "Chapter two" {
		t.Errorf("list after delete = %+v", got)
	}

	// Deleting the book deletes its bookmarks; the routes then 404.
	if resp := doJSON(t, http.MethodDelete, tsURL, fmt.Sprintf("/api/library/books/%d", bookID), alice, nil); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete book: status = %d", resp.StatusCode)
	}
	if resp := doJSON(t, http.MethodGet, tsURL, base, alice, nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("list of a deleted book: status = %d, want 404", resp.StatusCode)
	}
	if resp := doJSON(t, http.MethodPut, tsURL, path, alice, map[string]string{"label": "x"}); resp.StatusCode != http.StatusNotFound {
		t.Errorf("rename after book delete: status = %d, want 404", resp.StatusCode)
	}
}

func TestBookmarkValidation(t *testing.T) {
	tsURL, alice, _, base, _ := bookmarkFixture(t)
	resp := doJSON(t, http.MethodPost, tsURL, base, alice, map[string]string{"position": "0:0", "label": "x"})
	var m bookmarkBody
	decodeJSON(t, resp, &m)
	path := base + "/" + strconv.FormatInt(m.ID, 10)

	for name, tc := range map[string]struct {
		method, path, body string
		want               int
	}{
		"empty position":       {http.MethodPost, base, `{"position":"","label":"x"}`, http.StatusUnprocessableEntity},
		"missing position":     {http.MethodPost, base, `{"label":"x"}`, http.StatusUnprocessableEntity},
		"121-character label":  {http.MethodPost, base, `{"position":"1:1","label":"` + strings.Repeat("字", 121) + `"}`, http.StatusUnprocessableEntity},
		"malformed add":        {http.MethodPost, base, `{`, http.StatusBadRequest},
		"non-string position":  {http.MethodPost, base, `{"position":5}`, http.StatusBadRequest},
		"oversized add":        {http.MethodPost, base, `{"position":"` + strings.Repeat("1", 1100) + `"}`, http.StatusRequestEntityTooLarge},
		"long label rename":    {http.MethodPut, path, `{"label":"` + strings.Repeat("a", 121) + `"}`, http.StatusUnprocessableEntity},
		"missing label rename": {http.MethodPut, path, `{}`, http.StatusBadRequest},
		"unknown key rename":   {http.MethodPut, path, `{"label":"a","position":"1:1"}`, http.StatusBadRequest},
		"malformed rename":     {http.MethodPut, path, `[`, http.StatusBadRequest},
		"oversized rename":     {http.MethodPut, path, `{"label":"` + strings.Repeat("a", 1100) + `"}`, http.StatusRequestEntityTooLarge},
		"unknown bookmark":     {http.MethodPut, base + "/999999", `{"label":"a"}`, http.StatusNotFound},
		"malformed bookmark":   {http.MethodDelete, base + "/x", ``, http.StatusNotFound},
		"unknown book":         {http.MethodGet, "/api/library/books/999999/bookmarks", ``, http.StatusNotFound},
		"malformed book":       {http.MethodPost, "/api/library/books/x/bookmarks", `{"position":"0:1"}`, http.StatusNotFound},
		"no token":             {http.MethodGet, base, ``, http.StatusUnauthorized},
	} {
		token := alice
		if name == "no token" {
			token = ""
		}
		if resp := doRaw(t, tc.method, tsURL, tc.path, token, tc.body); resp.StatusCode != tc.want {
			t.Errorf("%s: status = %d, want %d", name, resp.StatusCode, tc.want)
		}
	}
	// 120 characters fit.
	if resp := doJSON(t, http.MethodPost, tsURL, base, alice, map[string]string{"position": "2:2", "label": strings.Repeat("字", 120)}); resp.StatusCode != http.StatusCreated {
		t.Errorf("120-character label: status = %d, want 201", resp.StatusCode)
	}
	if got := listBookmarks(t, tsURL, alice, base); len(got) != 2 || got[0].Label != "x" {
		t.Errorf("bookmarks after rejects = %+v", got)
	}
}

func TestBookmarkLimitRoute(t *testing.T) {
	tsURL, alice, _, base, _ := bookmarkFixture(t)
	for i := range 200 {
		if resp := doJSON(t, http.MethodPost, tsURL, base, alice, map[string]string{"position": fmt.Sprintf("0:%d", i)}); resp.StatusCode != http.StatusCreated {
			t.Fatalf("bookmark %d: status = %d", i, resp.StatusCode)
		}
	}
	if resp := doJSON(t, http.MethodPost, tsURL, base, alice, map[string]string{"position": "1:0"}); resp.StatusCode != http.StatusConflict {
		t.Errorf("bookmark 201: status = %d, want 409", resp.StatusCode)
	}
}

func TestBookmarksOtherUserRoutes(t *testing.T) {
	tsURL, alice, bob, base, _ := bookmarkFixture(t)
	resp := doJSON(t, http.MethodPost, tsURL, base, alice, map[string]string{"position": "0:1", "label": "secret"})
	var m bookmarkBody
	decodeJSON(t, resp, &m)
	path := base + "/" + strconv.FormatInt(m.ID, 10)

	for _, tc := range []struct {
		method, path string
		body         any
	}{
		{http.MethodGet, base, nil},
		{http.MethodPost, base, map[string]string{"position": "0:1"}},
		{http.MethodPost, base, map[string]string{"position": "0:2"}},
		{http.MethodPut, path, map[string]string{"label": "mine now"}},
		{http.MethodDelete, path, nil},
	} {
		resp := doJSON(t, tc.method, tsURL, tc.path, bob, tc.body)
		body := bodyOf(t, resp)
		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("bob %s %s: status = %d, want 404", tc.method, tc.path, resp.StatusCode)
		}
		if strings.Contains(body, "secret") || strings.Contains(body, "0:1") {
			t.Errorf("bob %s %s leaks: %s", tc.method, tc.path, body)
		}
	}
	if got := listBookmarks(t, tsURL, alice, base); len(got) != 1 || got[0].Label != "secret" {
		t.Errorf("alice's bookmarks = %+v, want hers intact", got)
	}
}
