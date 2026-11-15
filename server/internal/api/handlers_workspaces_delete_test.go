package api_test

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"qinqin/internal/journal"
	"qinqin/internal/library"
)

var deleteTestPlugin = validManifest("qinqin-flashcards", "")

// eventID returns a valid, distinct ULID for test events.
func eventID(n int) string {
	return fmt.Sprintf("01J%023d", n)
}

// createWorkspace opens a workspace through the API and returns its id.
func createWorkspace(t *testing.T, tsURL, token, language, name string) int64 {
	t.Helper()
	resp := doJSON(t, http.MethodPost, tsURL, "/api/workspaces", token, map[string]string{"language": language, "name": name})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("POST workspace %s/%s: status = %d", language, name, resp.StatusCode)
	}
	var ws workspaceBody
	decodeJSON(t, resp, &ws)
	return ws.ID
}

// deleteWorkspace sends DELETE /api/workspaces/{id} and returns the status.
func deleteWorkspace(t *testing.T, tsURL, token string, id int64) int {
	t.Helper()
	return doJSON(t, http.MethodDelete, tsURL, "/api/workspaces/"+strconv.FormatInt(id, 10), token, nil).StatusCode
}

// populateWorkspace gives one workspace a study event, a flashcards
// data row, and a book with a bookmark and a highlight, all through the
// API (the book through the store), and returns the book id.
func populateWorkspace(t *testing.T, tsURL, token string, store library.Store, userID, wsID int64, n int) int64 {
	t.Helper()
	ws := strconv.FormatInt(wsID, 10)
	batch := map[string]any{"events": []map[string]any{{
		"id": eventID(n), "workspaceId": wsID, "device": "web",
		"ts": "2026-11-14T10:00:00Z", "type": "review", "payload": map[string]any{"cardId": "c"},
	}}}
	if resp := doJSON(t, http.MethodPost, tsURL, "/api/events/batch", token, batch); resp.StatusCode != http.StatusOK {
		t.Fatalf("events batch for %s: status = %d", ws, resp.StatusCode)
	}
	if resp := doRaw(t, http.MethodPut, tsURL, "/api/plugins/qinqin-flashcards/data/card:x?workspace="+ws, token, `{"id":"x"}`); resp.StatusCode != http.StatusOK {
		t.Fatalf("plugin data for %s: status = %d", ws, resp.StatusCode)
	}
	b, err := store.Create(context.Background(), library.Book{
		UserID: userID, WorkspaceID: wsID, Language: "zh", Title: "Book " + ws, Source: "upload", SourceID: "s" + ws,
	}, []library.Chapter{{Title: "One", Paragraphs: []library.Paragraph{{{Text: "你好"}}}}})
	if err != nil {
		t.Fatalf("create book in %s: %v", ws, err)
	}
	book := "/api/library/books/" + strconv.FormatInt(b.ID, 10)
	if resp := doJSON(t, http.MethodPost, tsURL, book+"/bookmarks", token, map[string]string{"position": "0:0", "label": "x"}); resp.StatusCode != http.StatusCreated {
		t.Fatalf("bookmark in %s: status = %d", ws, resp.StatusCode)
	}
	hl := map[string]any{"chapter": 0, "paragraph": 0, "start": 0, "end": 2, "text": "你好"}
	if resp := doJSON(t, http.MethodPost, tsURL, book+"/highlights", token, hl); resp.StatusCode != http.StatusCreated {
		t.Fatalf("highlight in %s: status = %d", ws, resp.StatusCode)
	}
	return b.ID
}

// countWhere counts the rows of a query with one id argument.
func countWhere(t *testing.T, sqlDB *sql.DB, query string, id int64) int {
	t.Helper()
	var n int
	if err := sqlDB.QueryRow(query, id).Scan(&n); err != nil {
		t.Fatalf("%s: %v", query, err)
	}
	return n
}

// workspaceRows counts everything scoped to one workspace, directly or
// through its books.
func workspaceRows(t *testing.T, sqlDB *sql.DB, wsID int64) map[string]int {
	t.Helper()
	return map[string]int{
		"workspaces":         countWhere(t, sqlDB, `SELECT COUNT(*) FROM workspaces WHERE id = ?`, wsID),
		"study_events":       countWhere(t, sqlDB, `SELECT COUNT(*) FROM study_events WHERE workspace_id = ?`, wsID),
		"plugin_data":        countWhere(t, sqlDB, `SELECT COUNT(*) FROM plugin_data WHERE workspace_id = ?`, wsID),
		"library_books":      countWhere(t, sqlDB, `SELECT COUNT(*) FROM library_books WHERE workspace_id = ?`, wsID),
		"library_bookmarks":  countWhere(t, sqlDB, `SELECT COUNT(*) FROM library_bookmarks WHERE book_id IN (SELECT id FROM library_books WHERE workspace_id = ?)`, wsID),
		"library_highlights": countWhere(t, sqlDB, `SELECT COUNT(*) FROM library_highlights WHERE book_id IN (SELECT id FROM library_books WHERE workspace_id = ?)`, wsID),
	}
}

func TestDeleteWorkspaceCascades(t *testing.T) {
	ts, sqlDB, dataDir := newServerWithDir(t)
	store := library.Store{DB: sqlDB, Dir: filepath.Join(dataDir, "books")}
	alice := registerUser(t, ts.URL, "alice", "")
	bob := registerUser(t, ts.URL, "bob", alice)
	seedBuiltin(t, sqlDB, deleteTestPlugin)
	var aliceID, bobID int64
	sqlDB.QueryRow(`SELECT id FROM users WHERE username = 'alice'`).Scan(&aliceID)
	sqlDB.QueryRow(`SELECT id FROM users WHERE username = 'bob'`).Scan(&bobID)

	gone := createWorkspace(t, ts.URL, alice, "zh", "throwaway")
	kept := createWorkspace(t, ts.URL, alice, "zh", "")
	bobs := createWorkspace(t, ts.URL, bob, "zh", "")
	goneBook := populateWorkspace(t, ts.URL, alice, store, aliceID, gone, 1)
	keptBook := populateWorkspace(t, ts.URL, alice, store, aliceID, kept, 2)
	populateWorkspace(t, ts.URL, bob, store, bobID, bobs, 3)
	// A user-global row is not the workspace's and stays.
	if resp := doRaw(t, http.MethodPut, ts.URL, "/api/plugins/qinqin-flashcards/data/settings", alice, `{"a":1}`); resp.StatusCode != http.StatusOK {
		t.Fatalf("user-global plugin data: status = %d", resp.StatusCode)
	}
	keptBefore := workspaceRows(t, sqlDB, kept)
	bobBefore := workspaceRows(t, sqlDB, bobs)
	for table, n := range workspaceRows(t, sqlDB, gone) {
		if n != 1 {
			t.Fatalf("fixture: %s has %d rows for the doomed workspace, want 1", table, n)
		}
	}

	// Bob cannot delete Alice's workspace: it is invisible to him.
	if got := deleteWorkspace(t, ts.URL, bob, gone); got != http.StatusNotFound {
		t.Errorf("DELETE foreign workspace: status = %d, want 404", got)
	}
	if got := deleteWorkspace(t, ts.URL, alice, 999999); got != http.StatusNotFound {
		t.Errorf("DELETE unknown workspace: status = %d, want 404", got)
	}
	if resp := doJSON(t, http.MethodDelete, ts.URL, "/api/workspaces/abc", alice, nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("DELETE non-integer id: status = %d, want 404", resp.StatusCode)
	}
	if got := deleteWorkspace(t, ts.URL, "", gone); got != http.StatusUnauthorized {
		t.Errorf("DELETE without token: status = %d, want 401", got)
	}
	if n := countWhere(t, sqlDB, `SELECT COUNT(*) FROM workspaces WHERE id = ?`, gone); n != 1 {
		t.Fatal("refused deletes removed the workspace")
	}

	if got := deleteWorkspace(t, ts.URL, alice, gone); got != http.StatusNoContent {
		t.Fatalf("DELETE own workspace: status = %d, want 204", got)
	}
	for table, n := range workspaceRows(t, sqlDB, gone) {
		if n != 0 {
			t.Errorf("%s: %d rows left for the deleted workspace", table, n)
		}
	}
	if n := countWhere(t, sqlDB, `SELECT COUNT(*) FROM library_bookmarks WHERE book_id = ?`, goneBook); n != 0 {
		t.Errorf("bookmarks of the deleted book: %d left", n)
	}
	if n := countWhere(t, sqlDB, `SELECT COUNT(*) FROM library_highlights WHERE book_id = ?`, goneBook); n != 0 {
		t.Errorf("highlights of the deleted book: %d left", n)
	}
	content := filepath.Join(dataDir, "books", strconv.FormatInt(aliceID, 10), strconv.FormatInt(goneBook, 10)+".json")
	if _, err := os.Stat(content); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("content file of the deleted book still there (stat err %v)", err)
	}
	if resp := doJSON(t, http.MethodGet, ts.URL, "/api/library/books/"+strconv.FormatInt(goneBook, 10), alice, nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("GET deleted book: status = %d, want 404", resp.StatusCode)
	}

	// Everything else is untouched, ids included.
	if got := workspaceRows(t, sqlDB, kept); fmt.Sprint(got) != fmt.Sprint(keptBefore) {
		t.Errorf("kept workspace rows %v, want %v", got, keptBefore)
	}
	if got := workspaceRows(t, sqlDB, bobs); fmt.Sprint(got) != fmt.Sprint(bobBefore) {
		t.Errorf("bob's workspace rows %v, want %v", got, bobBefore)
	}
	if resp := doJSON(t, http.MethodGet, ts.URL, "/api/library/books/"+strconv.FormatInt(keptBook, 10)+"/chapters/0", alice, nil); resp.StatusCode != http.StatusOK {
		t.Errorf("GET kept book chapter: status = %d, want 200", resp.StatusCode)
	}
	if n := countWhere(t, sqlDB, `SELECT COUNT(*) FROM plugin_data WHERE workspace_id IS NULL AND user_id = ?`, aliceID); n != 1 {
		t.Errorf("user-global plugin rows = %d, want 1", n)
	}

	// Listing afterwards shows the one left and recreates no defaults.
	list := doJSON(t, http.MethodGet, ts.URL, "/api/workspaces", alice, nil)
	var ws []workspaceBody
	decodeJSON(t, list, &ws)
	if len(ws) != 1 || ws[0].ID != kept {
		t.Errorf("GET workspaces after delete = %+v, want only %d", ws, kept)
	}

	// The deleted workspace's routes are 404 now.
	g := strconv.FormatInt(gone, 10)
	if resp := doJSON(t, http.MethodGet, ts.URL, "/api/library/books?workspace="+g, alice, nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("GET books of deleted workspace: status = %d, want 404", resp.StatusCode)
	}
	if resp := doJSON(t, http.MethodGet, ts.URL, "/api/events?workspace="+g, alice, nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("GET events of deleted workspace: status = %d, want 404", resp.StatusCode)
	}

	// A second delete of the same id is a 404, and a new workspace never
	// gets the deleted id back.
	if got := deleteWorkspace(t, ts.URL, alice, gone); got != http.StatusNotFound {
		t.Errorf("DELETE again: status = %d, want 404", got)
	}
	if again := createWorkspace(t, ts.URL, alice, "zh", "throwaway"); again == gone {
		t.Errorf("new workspace reused the deleted id %d", gone)
	}
}

func TestDeleteLastWorkspaceRefused(t *testing.T) {
	ts, sqlDB := newServer(t)
	alice := registerUser(t, ts.URL, "alice", "")
	only := createWorkspace(t, ts.URL, alice, "zh", "")
	if got := deleteWorkspace(t, ts.URL, alice, only); got != http.StatusConflict {
		t.Errorf("DELETE last workspace: status = %d, want 409", got)
	}
	if n := countWhere(t, sqlDB, `SELECT COUNT(*) FROM workspaces WHERE id = ?`, only); n != 1 {
		t.Error("the last workspace was deleted")
	}
	// Another user's workspaces do not count towards Alice's last one.
	bob := registerUser(t, ts.URL, "bob", alice)
	createWorkspace(t, ts.URL, bob, "zh", "")
	if got := deleteWorkspace(t, ts.URL, alice, only); got != http.StatusConflict {
		t.Errorf("DELETE last workspace with another user's around: status = %d, want 409", got)
	}
}

func TestDeletedWorkspaceSync(t *testing.T) {
	ts, sqlDB := newServer(t)
	alice := registerUser(t, ts.URL, "alice", "")
	seedBuiltin(t, sqlDB, deleteTestPlugin)
	gone := createWorkspace(t, ts.URL, alice, "zh", "throwaway")
	kept := createWorkspace(t, ts.URL, alice, "zh", "")
	for _, ws := range []int64{gone, kept} {
		if resp := doRaw(t, http.MethodPut, ts.URL, "/api/plugins/qinqin-flashcards/data/card:x?workspace="+strconv.FormatInt(ws, 10), alice, `{"id":"x"}`); resp.StatusCode != http.StatusOK {
			t.Fatalf("plugin data: status = %d", resp.StatusCode)
		}
	}
	if got := deleteWorkspace(t, ts.URL, alice, gone); got != http.StatusNoContent {
		t.Fatalf("DELETE: status = %d, want 204", got)
	}

	// A pull lists nothing of the deleted workspace.
	pull := doJSON(t, http.MethodGet, ts.URL, "/api/sync/pull?cursor=1970-01-01T00:00:00Z&collections=pluginData", alice, nil)
	if pull.StatusCode != http.StatusOK {
		t.Fatalf("pull: status = %d", pull.StatusCode)
	}
	var delta struct {
		PluginData []struct {
			WorkspaceID *int64 `json:"workspaceId"`
		} `json:"pluginData"`
	}
	decodeJSON(t, pull, &delta)
	if len(delta.PluginData) != 1 || delta.PluginData[0].WorkspaceID == nil || *delta.PluginData[0].WorkspaceID != kept {
		t.Errorf("pulled plugin data %+v, want only the kept workspace's row", delta.PluginData)
	}

	// A device still holding the deleted workspace's data cannot push it
	// back: plugin data, events, and the direct routes are all 404.
	push := map[string]any{"pluginData": []map[string]any{{
		"pluginId": "qinqin-flashcards", "key": "card:y", "workspaceId": gone,
		"data": map[string]string{"id": "y"}, "updatedAt": "2026-11-14T10:00:00Z",
	}}}
	if resp := doJSON(t, http.MethodPost, ts.URL, "/api/sync/push", alice, push); resp.StatusCode != http.StatusNotFound {
		t.Errorf("push plugin data of deleted workspace: status = %d, want 404", resp.StatusCode)
	}
	push = map[string]any{"events": []map[string]any{{
		"id": eventID(9), "workspaceId": gone, "device": "web", "ts": "2026-11-14T10:00:00Z", "type": "review", "payload": map[string]any{},
	}}}
	if resp := doJSON(t, http.MethodPost, ts.URL, "/api/sync/push", alice, push); resp.StatusCode != http.StatusNotFound {
		t.Errorf("push events of deleted workspace: status = %d, want 404", resp.StatusCode)
	}
	if resp := doJSON(t, http.MethodPost, ts.URL, "/api/events/batch", alice, push); resp.StatusCode != http.StatusNotFound {
		t.Errorf("event batch of deleted workspace: status = %d, want 404", resp.StatusCode)
	}
	if resp := doRaw(t, http.MethodPut, ts.URL, "/api/plugins/qinqin-flashcards/data/card:y?workspace="+strconv.FormatInt(gone, 10), alice, `{"id":"y"}`); resp.StatusCode != http.StatusNotFound {
		t.Errorf("PUT plugin data of deleted workspace: status = %d, want 404", resp.StatusCode)
	}
	for table, n := range workspaceRows(t, sqlDB, gone) {
		if n != 0 {
			t.Errorf("%s: %d rows came back for the deleted workspace", table, n)
		}
	}
}

// TestConcurrentWorkspaceDeletes deletes all of a user's workspaces at
// once while creating others: deletes serialize, so exactly the last
// survivor is refused and the user always keeps at least one.
func TestConcurrentWorkspaceDeletes(t *testing.T) {
	ts, sqlDB := newServer(t)
	alice := registerUser(t, ts.URL, "alice", "")
	var ids []int64
	for i := range 4 {
		ids = append(ids, createWorkspace(t, ts.URL, alice, "zh", fmt.Sprint("w", i)))
	}
	var aliceID int64
	sqlDB.QueryRow(`SELECT id FROM users WHERE username = 'alice'`).Scan(&aliceID)

	var wg sync.WaitGroup
	statuses := make([]int, len(ids))
	created := make([]int, 2)
	for i, id := range ids {
		wg.Add(1)
		go func() {
			defer wg.Done()
			req, _ := http.NewRequest(http.MethodDelete, ts.URL+"/api/workspaces/"+strconv.FormatInt(id, 10), nil)
			req.Header.Set("Authorization", "Bearer "+alice)
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Error(err)
				return
			}
			resp.Body.Close()
			statuses[i] = resp.StatusCode
		}()
	}
	wg.Wait()
	deleted, refused := 0, 0
	for _, s := range statuses {
		switch s {
		case http.StatusNoContent:
			deleted++
		case http.StatusConflict:
			refused++
		default:
			t.Errorf("concurrent DELETE status = %d", s)
		}
	}
	if deleted != len(ids)-1 || refused != 1 {
		t.Errorf("deleted %d refused %d, want %d and 1 (statuses %v)", deleted, refused, len(ids)-1, statuses)
	}
	if n := countWhere(t, sqlDB, `SELECT COUNT(*) FROM workspaces WHERE user_id = ?`, aliceID); n != 1 {
		t.Errorf("workspaces left = %d, want 1", n)
	}

	// Deletes racing creates: every create lands, the user keeps >= 1.
	left := createWorkspace(t, ts.URL, alice, "zh", "extra")
	var remaining int64
	sqlDB.QueryRow(`SELECT id FROM workspaces WHERE user_id = ? AND id <> ?`, aliceID, left).Scan(&remaining)
	for i := range created {
		wg.Add(1)
		go func() {
			defer wg.Done()
			body := fmt.Sprintf(`{"language":"zh","name":"race%d"}`, i)
			req, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/workspaces", strings.NewReader(body))
			req.Header.Set("Authorization", "Bearer "+alice)
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Error(err)
				return
			}
			resp.Body.Close()
			created[i] = resp.StatusCode
		}()
	}
	for _, id := range []int64{remaining, left} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			req, _ := http.NewRequest(http.MethodDelete, ts.URL+"/api/workspaces/"+strconv.FormatInt(id, 10), nil)
			req.Header.Set("Authorization", "Bearer "+alice)
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Error(err)
				return
			}
			resp.Body.Close()
		}()
	}
	wg.Wait()
	for _, s := range created {
		if s != http.StatusCreated {
			t.Errorf("racing create status = %d, want 201", s)
		}
	}
	if n := countWhere(t, sqlDB, `SELECT COUNT(*) FROM workspaces WHERE user_id = ?`, aliceID); n < 1 {
		t.Errorf("workspaces left = %d, want at least 1", n)
	}
}

// TestDeletedBookIdIsNeverReused closes the stale-tab hazard: a book
// uploaded into workspace A, A deleted, a book uploaded into B. The new
// book must get a fresh id, so a reader tab still open on A's book gets
// 404s for its position and bookmark writes instead of writing them into
// B's unrelated book.
func TestDeletedBookIdIsNeverReused(t *testing.T) {
	ts, sqlDB, dataDir := newServerWithDir(t)
	store := library.Store{DB: sqlDB, Dir: filepath.Join(dataDir, "books")}
	alice := registerUser(t, ts.URL, "alice", "")
	var aliceID int64
	sqlDB.QueryRow(`SELECT id FROM users WHERE username = 'alice'`).Scan(&aliceID)
	a := createWorkspace(t, ts.URL, alice, "zh", "a")
	b := createWorkspace(t, ts.URL, alice, "zh", "b")
	upload := func(wsID int64) int64 {
		book, err := store.Create(context.Background(), library.Book{
			UserID: aliceID, WorkspaceID: wsID, Language: "zh", Title: "Upload", Source: "upload",
		}, []library.Chapter{{Title: "One", Paragraphs: []library.Paragraph{{{Text: "你好"}}}}})
		if err != nil {
			t.Fatalf("upload into %d: %v", wsID, err)
		}
		return book.ID
	}
	old := upload(a)
	if got := deleteWorkspace(t, ts.URL, alice, a); got != http.StatusNoContent {
		t.Fatalf("DELETE workspace a: status = %d, want 204", got)
	}
	fresh := upload(b)
	if fresh == old {
		t.Fatalf("book in workspace b reused deleted id %d", old)
	}
	stale := "/api/library/books/" + strconv.FormatInt(old, 10)
	if resp := doJSON(t, http.MethodPut, ts.URL, stale+"/position", alice, map[string]string{"position": "0:0"}); resp.StatusCode != http.StatusNotFound {
		t.Errorf("stale tab PUT position: status = %d, want 404", resp.StatusCode)
	}
	if resp := doJSON(t, http.MethodPost, ts.URL, stale+"/bookmarks", alice, map[string]string{"position": "0:0", "label": "x"}); resp.StatusCode != http.StatusNotFound {
		t.Errorf("stale tab POST bookmark: status = %d, want 404", resp.StatusCode)
	}
	if n := countWhere(t, sqlDB, `SELECT COUNT(*) FROM library_bookmarks WHERE book_id = ?`, fresh); n != 0 {
		t.Errorf("new book carries %d bookmarks of the deleted one", n)
	}
}

func TestDeleteWorkspaceRemovesPhotos(t *testing.T) {
	ts, sqlDB, dataDir := newServerWithDir(t)
	alice := registerUser(t, ts.URL, "alice", "")
	var aliceID int64
	sqlDB.QueryRow(`SELECT id FROM users WHERE username = 'alice'`).Scan(&aliceID)
	w := createWorkspace(t, ts.URL, alice, "zh", "w")
	v := createWorkspace(t, ts.URL, alice, "zh", "v")
	photos := journal.Photos{DB: sqlDB, Dir: filepath.Join(dataDir, "journal")}
	ctx := context.Background()
	var wIDs []string
	for i := 0; i < 2; i++ {
		ph, err := photos.Create(ctx, aliceID, w, []byte("jpeg"))
		if err != nil {
			t.Fatal(err)
		}
		wIDs = append(wIDs, ph.ID)
	}
	keep, err := photos.Create(ctx, aliceID, v, []byte("jpeg"))
	if err != nil {
		t.Fatal(err)
	}
	if got := deleteWorkspace(t, ts.URL, alice, w); got != http.StatusNoContent {
		t.Fatalf("DELETE: status = %d", got)
	}
	for _, id := range wIDs {
		if _, err := os.Stat(filepath.Join(photos.Dir, strconv.FormatInt(aliceID, 10), id+".jpg")); !os.IsNotExist(err) {
			t.Errorf("photo file %s survived the workspace", id)
		}
	}
	if n := countWhere(t, sqlDB, `SELECT COUNT(*) FROM journal_photos WHERE workspace_id = ?`, w); n != 0 {
		t.Errorf("%d photo rows survived", n)
	}
	if _, _, err := photos.Get(ctx, aliceID, keep.ID); err != nil {
		t.Errorf("the other workspace's photo is gone: %v", err)
	}
}

// TestDeleteWorkspaceFailureRollsBack makes the library step of the
// deletion fail and requires the workspace, its events and its plugin data
// to survive: every statement runs on the one transaction.
func TestDeleteWorkspaceFailureRollsBack(t *testing.T) {
	ts, sqlDB, dataDir := newServerWithDir(t)
	store := library.Store{DB: sqlDB, Dir: filepath.Join(dataDir, "books")}
	alice := registerUser(t, ts.URL, "alice", "")
	seedBuiltin(t, sqlDB, deleteTestPlugin)
	var aliceID int64
	sqlDB.QueryRow(`SELECT id FROM users WHERE username = 'alice'`).Scan(&aliceID)
	gone := createWorkspace(t, ts.URL, alice, "zh", "throwaway")
	createWorkspace(t, ts.URL, alice, "zh", "")
	populateWorkspace(t, ts.URL, alice, store, aliceID, gone, 1)
	if _, err := sqlDB.Exec(`CREATE TRIGGER boom BEFORE DELETE ON library_books BEGIN SELECT RAISE(ABORT,'boom'); END`); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodDelete, ts.URL+"/api/workspaces/"+strconv.FormatInt(gone, 10), nil)
	req.Header.Set("Authorization", "Bearer "+alice)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", resp.StatusCode)
	}
	for table, n := range workspaceRows(t, sqlDB, gone) {
		if n != 1 {
			t.Errorf("%s: %d rows after the failed delete, want 1", table, n)
		}
	}
}
