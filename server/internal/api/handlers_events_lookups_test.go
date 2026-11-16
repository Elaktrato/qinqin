package api_test

import (
	"database/sql"
	"net/http"
	"strconv"
	"testing"
)

// TestDeleteLookupEvents: DELETE /api/events/lookups?workspace= removes only
// the caller's lookup events of that workspace (#72).
func TestDeleteLookupEvents(t *testing.T) {
	ts, sqlDB := newServer(t)
	alice := registerUser(t, ts.URL, "alice", "")
	bob := registerUser(t, ts.URL, "bob", alice)
	ws1 := createWorkspace(t, ts.URL, alice, "zh", "Chinese")
	ws2 := createWorkspace(t, ts.URL, alice, "ja", "Japanese")
	bobWS := createWorkspace(t, ts.URL, bob, "zh", "Chinese")

	n := 0
	post := func(token string, ws int64, types ...string) {
		t.Helper()
		var evs []map[string]any
		for _, typ := range types {
			n++
			evs = append(evs, map[string]any{"id": eventID(n), "workspaceId": ws, "device": "web",
				"ts": "2026-11-16T09:00:00Z", "type": typ, "payload": map[string]string{"query": "马"}})
		}
		resp := doJSON(t, http.MethodPost, ts.URL, "/api/events/batch", token, map[string]any{"events": evs})
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("batch status %d", resp.StatusCode)
		}
	}
	post(alice, ws1, "lookup", "review", "view", "lookup", "read")
	post(alice, ws2, "lookup")
	post(bob, bobWS, "lookup")
	count := func(ws int64, typ string) int {
		t.Helper()
		var c int
		if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM study_events WHERE workspace_id = ? AND type = ?`, ws, typ).Scan(&c); err != nil {
			t.Fatal(err)
		}
		return c
	}
	del := func(token, query string) *http.Response {
		t.Helper()
		return doJSON(t, http.MethodDelete, ts.URL, "/api/events/lookups"+query, token, nil)
	}
	q := func(ws int64) string { return "?workspace=" + strconv.FormatInt(ws, 10) }

	if s := del("", q(ws1)).StatusCode; s != http.StatusUnauthorized {
		t.Errorf("no token: %d, want 401", s)
	}
	if s := del(alice, "").StatusCode; s != http.StatusBadRequest {
		t.Errorf("no workspace: %d, want 400", s)
	}
	if s := del(alice, "?workspace=abc").StatusCode; s != http.StatusBadRequest {
		t.Errorf("workspace=abc: %d, want 400", s)
	}
	if s := del(bob, q(ws1)).StatusCode; s != http.StatusNotFound {
		t.Errorf("bob with alice's workspace: %d, want 404", s)
	}
	if s := del(alice, q(bobWS)).StatusCode; s != http.StatusNotFound {
		t.Errorf("alice with bob's workspace: %d, want 404", s)
	}
	if count(ws1, "lookup") != 2 || count(bobWS, "lookup") != 1 {
		t.Fatalf("a refused call deleted events")
	}

	resp := del(alice, q(ws1))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("alice: %d, want 200", resp.StatusCode)
	}
	var out map[string]any
	decodeJSON(t, resp, &out)
	if len(out) != 1 || out["deleted"] != float64(2) {
		t.Errorf("body = %v, want {deleted: 2}", out)
	}
	if count(ws1, "lookup") != 0 || count(ws1, "review") != 1 || count(ws1, "view") != 1 || count(ws1, "read") != 1 {
		t.Errorf("ws1 after delete: lookup %d review %d view %d read %d", count(ws1, "lookup"), count(ws1, "review"), count(ws1, "view"), count(ws1, "read"))
	}
	if count(ws2, "lookup") != 1 || count(bobWS, "lookup") != 1 {
		t.Errorf("other workspaces lost lookup events")
	}
	resp = del(alice, q(ws1))
	out = nil
	decodeJSON(t, resp, &out)
	if resp.StatusCode != http.StatusOK || out["deleted"] != float64(0) {
		t.Errorf("repeat: %d %v, want 200 {deleted: 0}", resp.StatusCode, out)
	}

	restrict(t, sqlDB, "alice")
	if s := del(alice, q(ws2)).StatusCode; s != http.StatusForbidden {
		t.Errorf("restricted session: %d, want 403", s)
	}
	if count(ws2, "lookup") != 1 {
		t.Errorf("a restricted session deleted events")
	}
}

func restrict(t *testing.T, sqlDB *sql.DB, username string) {
	t.Helper()
	if _, err := sqlDB.Exec(`UPDATE users SET must_change_password = 1 WHERE username = ?`, username); err != nil {
		t.Fatal(err)
	}
}
