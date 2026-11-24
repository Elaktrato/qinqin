package sync_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"qinqin/internal/api"
	"qinqin/internal/dbtest"
)

// A write to a stored typed row this server cannot read back is a coded
// 409 study_row_unreadable (JSON), never a 500; the paged pull still answers.
func TestUnreadableStoredRowOverHTTP(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ts := httptest.NewServer(api.New(sqlDB, t.TempDir(), nil))
	t.Cleanup(ts.Close)
	token := registerAndLogin(t, ts.URL)
	call := func(method, path, body string) (int, map[string]json.RawMessage) {
		req, _ := http.NewRequest(method, ts.URL+path, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+token)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var out map[string]json.RawMessage
		json.NewDecoder(resp.Body).Decode(&out)
		return resp.StatusCode, out
	}
	var owner int64
	sqlDB.QueryRow(`SELECT id FROM users WHERE username = 'owner'`).Scan(&owner)
	ws := newWorkspace(t, sqlDB, owner)
	if _, err := sqlDB.Exec(`INSERT INTO study_decks (user_id, workspace_id, id, name, created_at, source, extra, version, updated_at, modified_at)
		VALUES (?, ?, 'd9', 'Course', 't', '{"type":"course"}', '{}', 1, '2026-11-12T08:00:00Z', '2026-11-12T08:00:00Z')`, owner, ws); err != nil {
		t.Fatal(err)
	}
	push, _ := json.Marshal(map[string]any{"decks": []json.RawMessage{typedItem("decks", ws, "d9", time.Now())}})
	status, body := call(http.MethodPost, "/api/sync/push", string(push))
	if status != http.StatusConflict || string(body["error"]) != `"study_row_unreadable"` || len(body["message"]) == 0 {
		t.Errorf("push onto an unreadable stored row: %d %v, want 409 study_row_unreadable", status, body)
	}
	status, body = call(http.MethodGet, "/api/sync/pull?v=2&collections=decks", "")
	if status != http.StatusOK || string(body["collections"]) != `{"decks":[]}` {
		t.Errorf("pull: %d %s", status, body["collections"])
	}
}
