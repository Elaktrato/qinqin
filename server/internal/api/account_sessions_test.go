package api_test

import (
	"net/http"
	"reflect"
	"sort"
	"strconv"
	"testing"
)

type sessionRow map[string]any

func listSessions(t *testing.T, tsURL, token string) []sessionRow {
	t.Helper()
	resp := doJSON(t, http.MethodGet, tsURL, "/api/account/sessions", token, nil)
	if resp.StatusCode != 200 {
		t.Fatalf("list sessions = %d", resp.StatusCode)
	}
	var body struct {
		Sessions []sessionRow `json:"sessions"`
	}
	decodeJSON(t, resp, &body)
	return body.Sessions
}

func TestListSessionsShapeAndCurrent(t *testing.T) {
	ts, _ := newServer(t)
	phone := registerUser(t, ts.URL, "alice", "")
	laptop := login(t, ts.URL, "alice")

	if code := doJSON(t, http.MethodGet, ts.URL, "/api/account/sessions", "", nil).StatusCode; code != 401 {
		t.Errorf("anonymous = %d", code)
	}
	rows := listSessions(t, ts.URL, laptop)
	if len(rows) != 2 {
		t.Fatalf("rows = %d, want 2", len(rows))
	}
	current := 0
	for _, r := range rows {
		keys := []string{}
		for k := range r {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		// Exactly the documented keys: never a token or its hash.
		if want := []string{"createdAt", "current", "device", "id", "lastUsedAt"}; !reflect.DeepEqual(keys, want) {
			t.Errorf("keys = %v, want %v", keys, want)
		}
		if r["current"] == true {
			current++
		}
	}
	if current != 1 {
		t.Errorf("%d rows are current, want exactly 1", current)
	}
	// The same list seen from the other session marks the other row.
	other := listSessions(t, ts.URL, phone)
	if other[0]["current"] == rows[0]["current"] && other[1]["current"] == rows[1]["current"] {
		t.Error("current did not follow the caller")
	}
}

func TestRevokeOneSession(t *testing.T) {
	ts, sqlDB := newServer(t)
	admin := registerUser(t, ts.URL, "admin1", "")
	bob := registerUser(t, ts.URL, "bobby", admin)
	phone := login(t, ts.URL, "bobby")
	var phoneID, adminSession int64
	sqlDB.QueryRow(`SELECT id FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = 'admin1') LIMIT 1`).Scan(&adminSession)

	// Another user's session id is a 404 and nothing is deleted.
	if code := doJSON(t, http.MethodDelete, ts.URL, "/api/account/sessions/"+strconv.FormatInt(adminSession, 10), bob, nil).StatusCode; code != 404 {
		t.Errorf("foreign id = %d, want 404", code)
	}
	if code := doJSON(t, http.MethodDelete, ts.URL, "/api/account/sessions/abc", bob, nil).StatusCode; code != 404 {
		t.Errorf("non-numeric id = %d, want 404", code)
	}
	if status(t, ts, "/api/auth/me", admin) != 200 {
		t.Fatal("the foreign delete removed a session")
	}
	for _, r := range listSessions(t, ts.URL, bob) {
		if r["current"] != true {
			phoneID = int64(r["id"].(float64))
		}
	}
	if code := doJSON(t, http.MethodDelete, ts.URL, "/api/account/sessions/"+strconv.FormatInt(phoneID, 10), bob, nil).StatusCode; code != 204 {
		t.Errorf("revoke other = %d, want 204", code)
	}
	if status(t, ts, "/api/auth/me", phone) != 401 || status(t, ts, "/api/auth/me", bob) != 200 {
		t.Error("the wrong session was removed")
	}
	// Revoking the current one is a logout.
	cur := listSessions(t, ts.URL, bob)[0]["id"].(float64)
	if code := doJSON(t, http.MethodDelete, ts.URL, "/api/account/sessions/"+strconv.FormatInt(int64(cur), 10), bob, nil).StatusCode; code != 204 {
		t.Errorf("revoke current = %d", code)
	}
	if status(t, ts, "/api/auth/me", bob) != 401 {
		t.Error("revoking the current session did not log it out")
	}
}

func TestRevokeScopes(t *testing.T) {
	ts, sqlDB := newServer(t)
	a := registerUser(t, ts.URL, "alice", "")
	b := login(t, ts.URL, "alice")
	c := login(t, ts.URL, "alice")
	_ = c
	revoke := func(token string, body any) (int, int) {
		resp := doJSON(t, http.MethodPost, ts.URL, "/api/account/sessions/revoke", token, body)
		var out struct {
			Revoked int `json:"revoked"`
		}
		if resp.StatusCode == 200 {
			decodeJSON(t, resp, &out)
		}
		return resp.StatusCode, out.Revoked
	}
	if code, _ := revoke(a, map[string]string{"scope": "everything"}); code != 400 {
		t.Errorf("bad scope = %d, want 400", code)
	}
	if code, _ := revoke(a, map[string]string{}); code != 400 {
		t.Errorf("missing scope = %d, want 400", code)
	}
	if code, n := revoke(b, map[string]string{"scope": "others"}); code != 200 || n != 2 {
		t.Errorf("others = %d, revoked %d, want 200 / 2", code, n)
	}
	if status(t, ts, "/api/auth/me", b) != 200 || status(t, ts, "/api/auth/me", a) != 401 {
		t.Error("others must keep the caller only")
	}
	if code, n := revoke(b, map[string]string{"scope": "all"}); code != 200 || n != 1 {
		t.Errorf("all = %d, revoked %d, want 200 / 1", code, n)
	}
	if status(t, ts, "/api/auth/me", b) != 401 {
		t.Error("all must end the caller's own session too")
	}
	var n int
	sqlDB.QueryRow(`SELECT COUNT(*) FROM auth_audit WHERE action = 'sessions_revoked'`).Scan(&n)
	if n != 2 {
		t.Errorf("audit rows = %d, want 2", n)
	}
}
