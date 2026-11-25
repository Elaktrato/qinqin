package api_test

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"testing"
)

// highlightBody mirrors the highlight JSON.
type highlightBody struct {
	ID        int64  `json:"id"`
	BookID    int64  `json:"bookId"`
	Chapter   int    `json:"chapter"`
	Paragraph int    `json:"paragraph"`
	Start     int    `json:"start"`
	End       int    `json:"end"`
	Text      string `json:"text"`
	Color     string `json:"color"`
	Note      string `json:"note"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

// highlightFixture is alice with one zh book (two chapters) and bob
// with none.
func highlightFixture(t *testing.T) (tsURL, alice, bob, base string, bookID int64) {
	t.Helper()
	tsURL, alice, bob, base, bookID = bookmarkFixture(t)
	return tsURL, alice, bob, strings.TrimSuffix(base, "/bookmarks") + "/highlights", bookID
}

func listHighlights(t *testing.T, tsURL, token, base string) []highlightBody {
	t.Helper()
	resp := doJSON(t, http.MethodGet, tsURL, base, token, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("list highlights: status = %d", resp.StatusCode)
	}
	var out []highlightBody
	decodeJSON(t, resp, &out)
	return out
}

func TestHighlightRoutes(t *testing.T) {
	tsURL, alice, _, base, bookID := highlightFixture(t)

	if got := strings.TrimSpace(bodyOf(t, doJSON(t, http.MethodGet, tsURL, base, alice, nil))); got != "[]" {
		t.Errorf("empty list body = %s, want []", got)
	}

	resp := doJSON(t, http.MethodPost, tsURL, base, alice, map[string]any{
		"chapter": 1, "paragraph": 0, "start": 0, "end": 2, "text": "世界", "note": "a <b>note</b>\nline",
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("add: status = %d %s", resp.StatusCode, bodyOf(t, resp))
	}
	var h highlightBody
	decodeJSON(t, resp, &h)
	if h.ID == 0 || h.BookID != bookID || h.Chapter != 1 || h.Paragraph != 0 || h.Start != 0 || h.End != 2 ||
		h.Text != "世界" || h.Color != "yellow" || h.Note != "a <b>note</b>\nline" || h.CreatedAt == "" || h.UpdatedAt == "" {
		t.Errorf("highlight = %+v", h)
	}

	resp = doJSON(t, http.MethodPost, tsURL, base, alice, map[string]any{
		"chapter": 0, "paragraph": 1, "start": 0, "end": 1, "text": "你", "color": "green",
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("add green: status = %d", resp.StatusCode)
	}
	var h2 highlightBody
	decodeJSON(t, resp, &h2)
	if got := listHighlights(t, tsURL, alice, base); len(got) != 2 || got[0] != h2 || got[1] != h {
		t.Errorf("list = %+v, want chapter order", got)
	}

	path := base + "/" + strconv.FormatInt(h.ID, 10)
	resp = doJSON(t, http.MethodPut, tsURL, path, alice, map[string]string{"color": "pink"})
	var up highlightBody
	decodeJSON(t, resp, &up)
	if resp.StatusCode != http.StatusOK || up.Color != "pink" || up.Note != h.Note || up.ID != h.ID {
		t.Errorf("update colour: status = %d %+v", resp.StatusCode, up)
	}
	resp = doJSON(t, http.MethodPut, tsURL, path, alice, map[string]string{"note": ""})
	decodeJSON(t, resp, &up)
	if resp.StatusCode != http.StatusOK || up.Color != "pink" || up.Note != "" {
		t.Errorf("clear note: status = %d %+v", resp.StatusCode, up)
	}

	if resp := doJSON(t, http.MethodDelete, tsURL, path, alice, nil); resp.StatusCode != http.StatusNoContent {
		t.Errorf("delete: status = %d, want 204", resp.StatusCode)
	}
	if resp := doJSON(t, http.MethodDelete, tsURL, path, alice, nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("second delete: status = %d, want 404", resp.StatusCode)
	}
	if got := listHighlights(t, tsURL, alice, base); len(got) != 1 || got[0].ID != h2.ID {
		t.Errorf("list after delete = %+v", got)
	}

	// Deleting the book deletes its highlights; the routes then 404.
	if resp := doJSON(t, http.MethodDelete, tsURL, fmt.Sprintf("/api/library/books/%d", bookID), alice, nil); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete book: status = %d", resp.StatusCode)
	}
	if resp := doJSON(t, http.MethodGet, tsURL, base, alice, nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("list of a deleted book: status = %d, want 404", resp.StatusCode)
	}
	if resp := doJSON(t, http.MethodPut, tsURL, base+"/"+strconv.FormatInt(h2.ID, 10), alice, map[string]string{"color": "blue"}); resp.StatusCode != http.StatusNotFound {
		t.Errorf("update after book delete: status = %d, want 404", resp.StatusCode)
	}
}

func TestHighlightOverlapRoute(t *testing.T) {
	tsURL, alice, _, base, _ := highlightFixture(t)
	resp := doJSON(t, http.MethodPost, tsURL, base, alice, map[string]any{"chapter": 0, "paragraph": 0, "start": 2, "end": 6, "text": "xxxx"})
	var h highlightBody
	decodeJSON(t, resp, &h)

	resp = doJSON(t, http.MethodPost, tsURL, base, alice, map[string]any{"chapter": 0, "paragraph": 0, "start": 5, "end": 8, "text": "yyy"})
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("overlap: status = %d, want 409", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); ct != "application/json" {
		t.Errorf("overlap content type = %q", ct)
	}
	var conflict struct {
		Error      string `json:"error"`
		ExistingID int64  `json:"existingId"`
	}
	decodeJSON(t, resp, &conflict)
	if conflict.ExistingID != h.ID || conflict.Error != "highlight_overlap" {
		t.Errorf("overlap body = %+v, want existingId %d", conflict, h.ID)
	}
	// Adjacent on both sides is fine; the same range in another paragraph too.
	for _, body := range []map[string]any{
		{"chapter": 0, "paragraph": 0, "start": 0, "end": 2, "text": "aa"},
		{"chapter": 0, "paragraph": 0, "start": 6, "end": 9, "text": "bbb"},
		{"chapter": 0, "paragraph": 1, "start": 2, "end": 6, "text": "cccc"},
		{"chapter": 1, "paragraph": 0, "start": 2, "end": 6, "text": "dddd"},
	} {
		if resp := doJSON(t, http.MethodPost, tsURL, base, alice, body); resp.StatusCode != http.StatusCreated {
			t.Errorf("%v: status = %d, want 201", body, resp.StatusCode)
		}
	}
}

func TestHighlightValidationRoutes(t *testing.T) {
	tsURL, alice, _, base, _ := highlightFixture(t)
	resp := doJSON(t, http.MethodPost, tsURL, base, alice, map[string]any{"chapter": 0, "paragraph": 0, "start": 0, "end": 1, "text": "x"})
	var h highlightBody
	decodeJSON(t, resp, &h)
	path := base + "/" + strconv.FormatInt(h.ID, 10)
	add := func(fields string) string {
		return `{"chapter":0,"paragraph":5,"start":0,"end":1,"text":"x"` + fields + `}`
	}

	for name, tc := range map[string]struct {
		method, path, body string
		want               int
	}{
		"chapter beyond count": {http.MethodPost, base, `{"chapter":2,"paragraph":0,"start":0,"end":1,"text":"x"}`, http.StatusUnprocessableEntity},
		"negative paragraph":   {http.MethodPost, base, `{"chapter":0,"paragraph":-1,"start":0,"end":1,"text":"x"}`, http.StatusUnprocessableEntity},
		"empty range":          {http.MethodPost, base, `{"chapter":0,"paragraph":1,"start":1,"end":1,"text":"x"}`, http.StatusUnprocessableEntity},
		"end beyond max":       {http.MethodPost, base, `{"chapter":0,"paragraph":1,"start":0,"end":100001,"text":"x"}`, http.StatusUnprocessableEntity},
		"missing range":        {http.MethodPost, base, `{"chapter":0,"paragraph":1,"text":"x"}`, http.StatusUnprocessableEntity},
		"unknown colour":       {http.MethodPost, base, add(`,"color":"red"`), http.StatusUnprocessableEntity},
		"missing text":         {http.MethodPost, base, `{"chapter":0,"paragraph":1,"start":0,"end":1}`, http.StatusUnprocessableEntity},
		"501-rune text":        {http.MethodPost, base, `{"chapter":0,"paragraph":1,"start":0,"end":501,"text":"` + strings.Repeat("字", 501) + `"}`, http.StatusUnprocessableEntity},
		"padded text":          {http.MethodPost, base, `{"chapter":0,"paragraph":1,"start":0,"end":4,"text":" 世界 "}`, http.StatusUnprocessableEntity},
		"trailing newline":     {http.MethodPost, base, `{"chapter":0,"paragraph":1,"start":0,"end":3,"text":"世界\n"}`, http.StatusUnprocessableEntity},
		"UTF-16 range":         {http.MethodPost, base, `{"chapter":0,"paragraph":1,"start":0,"end":2,"text":"😀"}`, http.StatusUnprocessableEntity},
		"range longer":         {http.MethodPost, base, `{"chapter":0,"paragraph":1,"start":0,"end":3,"text":"世界"}`, http.StatusUnprocessableEntity},
		"2001-rune note":       {http.MethodPost, base, add(`,"note":"` + strings.Repeat("字", 2001) + `"`), http.StatusUnprocessableEntity},
		"malformed add":        {http.MethodPost, base, `{`, http.StatusBadRequest},
		"non-number chapter":   {http.MethodPost, base, `{"chapter":"0","paragraph":0,"start":0,"end":1,"text":"x"}`, http.StatusBadRequest},
		"oversized add":        {http.MethodPost, base, add(`,"note":"` + strings.Repeat("a", 16500) + `"`), http.StatusRequestEntityTooLarge},
		"unknown key add":      {http.MethodPost, base, add(`,"position":"0:1"`), http.StatusBadRequest},
		"id in add":            {http.MethodPost, base, add(`,"id":3`), http.StatusBadRequest},
		"trailing JSON add":    {http.MethodPost, base, add(``) + ` {}`, http.StatusBadRequest},
		"trailing garbage add": {http.MethodPost, base, add(``) + `x`, http.StatusBadRequest},
		"unknown colour put":   {http.MethodPut, path, `{"color":"red"}`, http.StatusUnprocessableEntity},
		"empty colour put":     {http.MethodPut, path, `{"color":""}`, http.StatusUnprocessableEntity},
		"long note put":        {http.MethodPut, path, `{"note":"` + strings.Repeat("a", 2001) + `"}`, http.StatusUnprocessableEntity},
		"empty put":            {http.MethodPut, path, `{}`, http.StatusBadRequest},
		"range in put":         {http.MethodPut, path, `{"color":"blue","start":3}`, http.StatusBadRequest},
		"text in put":          {http.MethodPut, path, `{"text":"y"}`, http.StatusBadRequest},
		"trailing JSON put":    {http.MethodPut, path, `{"color":"blue"}{}`, http.StatusBadRequest},
		"oversized put":        {http.MethodPut, path, `{"note":"` + strings.Repeat("a", 16500) + `"}`, http.StatusRequestEntityTooLarge},
		"unknown highlight":    {http.MethodPut, base + "/999999", `{"color":"blue"}`, http.StatusNotFound},
		"malformed highlight":  {http.MethodDelete, base + "/x", ``, http.StatusNotFound},
		"unknown book":         {http.MethodGet, "/api/library/books/999999/highlights", ``, http.StatusNotFound},
		"unknown book add":     {http.MethodPost, "/api/library/books/999999/highlights", add(``), http.StatusNotFound},
		"malformed book":       {http.MethodPost, "/api/library/books/x/highlights", add(``), http.StatusNotFound},
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
	// An oversized body is a 413 with a highlight-specific JSON error.
	resp = doRaw(t, http.MethodPost, tsURL, base, alice, add(`,"note":"`+strings.Repeat("a", 16500)+`"`))
	if resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized: status = %d", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); ct != "application/json" {
		t.Errorf("oversized content type = %q", ct)
	}
	var tooBig map[string]any
	decodeJSON(t, resp, &tooBig)
	if code, _ := tooBig["error"].(string); code != "too_large" {
		t.Errorf("oversized body = %v", tooBig)
	}
	// The worst valid body fits the cap: a 500-code-point astral snapshot
	// and a 2000-character note of JSON-escaped characters (6 bytes each).
	worst := `{"chapter":0,"paragraph":7,"start":0,"end":500,"text":"` + strings.Repeat("😀", 500) +
		`","color":"yellow","note":"` + strings.Repeat(`\u00e9`, 2000) + `"}`
	if len(worst) <= 14000 {
		t.Fatalf("worst body is only %d bytes", len(worst))
	}
	if resp := doRaw(t, http.MethodPost, tsURL, base, alice, worst); resp.StatusCode != http.StatusCreated {
		t.Errorf("worst valid body (%d bytes): status = %d, want 201", len(worst), resp.StatusCode)
	} else {
		var got highlightBody
		decodeJSON(t, resp, &got)
		if got.Note != strings.Repeat("é", 2000) || got.Text != strings.Repeat("😀", 500) {
			t.Errorf("worst body stored note %d runes, text %d bytes", len([]rune(got.Note)), len(got.Text))
		}
		doJSON(t, http.MethodDelete, tsURL, base+"/"+strconv.FormatInt(got.ID, 10), alice, nil)
	}
	// Notes are cleaned: CR LF becomes LF, bidi controls go.
	resp = doJSON(t, http.MethodPut, tsURL, path, alice, map[string]string{"note": "a\r\nb\u202ec"})
	var cleaned highlightBody
	decodeJSON(t, resp, &cleaned)
	if resp.StatusCode != http.StatusOK || cleaned.Note != "a\nbc" {
		t.Errorf("cleaned note: status = %d %q", resp.StatusCode, cleaned.Note)
	}
	// A note of 2000 CJK characters fits the body cap and the rune limit.
	resp = doJSON(t, http.MethodPut, tsURL, path, alice, map[string]string{"note": strings.Repeat("字", 2000)})
	if resp.StatusCode != http.StatusOK {
		t.Errorf("2000-character note: status = %d, want 200", resp.StatusCode)
	}
	if got := listHighlights(t, tsURL, alice, base); len(got) != 1 || got[0].Color != "yellow" || got[0].Text != "x" {
		t.Errorf("highlights after rejects = %+v", got)
	}
}

func TestHighlightLimitRoute(t *testing.T) {
	ts, sqlDB := newServer(t)
	alice := registerUser(t, ts.URL, "alice", "")
	zh := newWorkspace(t, ts.URL, alice, "zh", "")
	var b libBook
	decodeJSON(t, uploadBook(t, ts.URL, alice, tinyEpub(t, "zh"), "", zh), &b)
	base := fmt.Sprintf("/api/library/books/%d/highlights", b.ID)

	// Fill to the cap directly; 2000 requests are slow.
	var uid int64
	if err := sqlDB.QueryRow(`SELECT user_id FROM library_books WHERE id = ?`, b.ID).Scan(&uid); err != nil {
		t.Fatalf("book owner: %v", err)
	}
	tx, err := sqlDB.Begin()
	if err != nil {
		t.Fatal(err)
	}
	for i := range 2000 {
		if _, err := tx.Exec(`INSERT INTO library_highlights
			(user_id, book_id, chapter, paragraph, start_cp, end_cp, text, color, note, created_at, updated_at)
			VALUES (?, ?, 0, ?, 0, 1, 'x', 'yellow', '', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`, uid, b.ID, i); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}

	resp := doJSON(t, http.MethodPost, ts.URL, base, alice, map[string]any{"chapter": 1, "paragraph": 0, "start": 0, "end": 1, "text": "x"})
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("highlight 2001: status = %d, want 409", resp.StatusCode)
	}
	var conflict map[string]any
	decodeJSON(t, resp, &conflict)
	if code, _ := conflict["error"].(string); code != "highlight_limit" || !strings.Contains(conflict["message"].(string), "2000 highlights") {
		t.Errorf("cap body = %v", conflict)
	}
	if _, ok := conflict["existingId"]; ok {
		t.Errorf("cap body has existingId: %v", conflict)
	}
}

func TestHighlightsOtherUserRoutes(t *testing.T) {
	tsURL, alice, bob, base, _ := highlightFixture(t)
	resp := doJSON(t, http.MethodPost, tsURL, base, alice, map[string]any{"chapter": 0, "paragraph": 0, "start": 0, "end": 6, "text": "secret", "note": "private"})
	var h highlightBody
	decodeJSON(t, resp, &h)
	path := base + "/" + strconv.FormatInt(h.ID, 10)

	for _, tc := range []struct {
		method, path string
		body         any
	}{
		{http.MethodGet, base, nil},
		{http.MethodPost, base, map[string]any{"chapter": 0, "paragraph": 0, "start": 0, "end": 6, "text": "xxxxxx"}},
		{http.MethodPost, base, map[string]any{"chapter": 0, "paragraph": 0, "start": 5, "end": 6, "text": "x"}},
		{http.MethodPut, path, map[string]string{"note": "mine now"}},
		{http.MethodDelete, path, nil},
	} {
		resp := doJSON(t, tc.method, tsURL, tc.path, bob, tc.body)
		body := bodyOf(t, resp)
		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("bob %s %s: status = %d, want 404", tc.method, tc.path, resp.StatusCode)
		}
		if strings.Contains(body, "secret") || strings.Contains(body, "private") || strings.Contains(body, strconv.FormatInt(h.ID, 10)) {
			t.Errorf("bob %s %s leaks: %s", tc.method, tc.path, body)
		}
	}
	if got := listHighlights(t, tsURL, alice, base); len(got) != 1 || got[0].Note != "private" {
		t.Errorf("alice's highlights = %+v, want hers intact", got)
	}
}
