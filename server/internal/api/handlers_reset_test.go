package api_test

import (
	"database/sql"
	"strings"
	"sync"
	"testing"
)

type resetIssued struct {
	Path      string `json:"path"`
	ExpiresAt string `json:"expiresAt"`
}

func issueReset(t *testing.T, url, adminTok string, id int64, body map[string]any) (int, resetIssued, string) {
	t.Helper()
	if _, ok := body["currentPassword"]; !ok {
		body["currentPassword"] = "secret-pass-owner" // the acting admin re-enters their password
	}
	resp := doJSON(t, "POST", url, "/api/admin/users/"+itoa(id)+"/reset-link", adminTok, body)
	var out resetIssued
	var e errBody
	if resp.StatusCode == 201 {
		decodeJSON(t, resp, &out)
		return resp.StatusCode, out, ""
	}
	decodeJSON(t, resp, &e)
	return resp.StatusCode, out, e.Error
}

func tokenOf(path string) string { return strings.TrimPrefix(path, "/reset#t=") }

func userID(t *testing.T, sqlDB *sql.DB, name string) int64 {
	t.Helper()
	var id int64
	if err := sqlDB.QueryRow(`SELECT id FROM users WHERE username = ?`, name).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func TestAdminResetLinkFlow(t *testing.T) {
	ts, sqlDB := newLooseServer(t)
	owner := registerUser(t, ts.URL, "owner", "")
	bob := registerUser(t, ts.URL, "bobby", owner)
	bobID := userID(t, sqlDB, "bobby")
	bob2 := login(t, ts.URL, "bobby")

	st, link, _ := issueReset(t, ts.URL, owner, bobID, map[string]any{})
	if st != 201 || !strings.HasPrefix(link.Path, "/reset#t=") {
		t.Fatalf("issue = %d %+v", st, link)
	}
	tok := tokenOf(link.Path)
	var stored string
	sqlDB.QueryRow(`SELECT token_hash FROM password_resets`).Scan(&stored)
	if stored == tok || stored != tokHash(tok) || len(tok) != 43 {
		t.Errorf("token storage wrong: stored %q len(token) %d", stored, len(tok))
	}
	// Issuing does not touch the password or the sessions.
	if r := doJSON(t, "GET", ts.URL, "/api/auth/me", bob, nil); r.StatusCode != 200 {
		t.Errorf("session changed by issuing: %d", r.StatusCode)
	}
	// A second issue invalidates the first.
	st, link2, _ := issueReset(t, ts.URL, owner, bobID, map[string]any{"expiresInHours": 2})
	tok2 := tokenOf(link2.Path)
	if r := doJSON(t, "POST", ts.URL, "/api/auth/reset/check", "", map[string]any{"token": tok}); r.StatusCode != 400 {
		t.Errorf("first token after second issue = %d, want 400", r.StatusCode)
	}
	var chk struct{ Username, ExpiresAt string }
	resp := doJSON(t, "POST", ts.URL, "/api/auth/reset/check", "", map[string]any{"token": tok2})
	decodeJSON(t, resp, &chk)
	if resp.StatusCode != 200 || chk.Username != "bobby" || chk.ExpiresAt == "" {
		t.Errorf("check = %d %+v", resp.StatusCode, chk)
	}
	// weak password: 422 and the token stays usable
	if r := doJSON(t, "POST", ts.URL, "/api/auth/reset", "", map[string]any{"token": tok2, "password": "short"}); r.StatusCode != 422 {
		t.Errorf("weak = %d", r.StatusCode)
	}
	var out struct {
		Status string `json:"status"`
		Token  string `json:"token"`
	}
	resp = doJSON(t, "POST", ts.URL, "/api/auth/reset", "", map[string]any{"token": tok2, "password": "brand-new-password"})
	decodeJSON(t, resp, &out)
	if resp.StatusCode != 200 || out.Status != "ok" || out.Token == "" {
		t.Fatalf("use = %d %+v", resp.StatusCode, out)
	}
	for _, old := range []string{bob, bob2} {
		if r := doJSON(t, "GET", ts.URL, "/api/auth/me", old, nil); r.StatusCode != 401 {
			t.Errorf("old session after reset = %d, want 401", r.StatusCode)
		}
	}
	if r := doJSON(t, "GET", ts.URL, "/api/auth/me", out.Token, nil); r.StatusCode != 200 {
		t.Errorf("new session = %d", r.StatusCode)
	}
	if st, _ := loginRaw(t, ts.URL, "bobby", "brand-new-password"); st != 200 {
		t.Errorf("login with the new password = %d", st)
	}
	if r := doJSON(t, "POST", ts.URL, "/api/auth/reset", "", map[string]any{"token": tok2, "password": "another-new-password"}); r.StatusCode != 400 {
		t.Errorf("second use = %d, want 400", r.StatusCode)
	}
	var must bool
	sqlDB.QueryRow(`SELECT must_change_password FROM users WHERE id = ?`, bobID).Scan(&must)
	if must {
		t.Error("must_change_password still set")
	}
	// audit rows
	for _, a := range []string{"reset_link_issued", "password_reset"} {
		var n int
		sqlDB.QueryRow(`SELECT COUNT(*) FROM auth_audit WHERE action = ?`, a).Scan(&n)
		if n == 0 {
			t.Errorf("no %s audit row", a)
		}
	}
	// ttl validation and unknown user and authorization
	for _, h := range []int{0, 169} {
		if st, _, _ := issueReset(t, ts.URL, owner, bobID, map[string]any{"expiresInHours": h}); st != 422 {
			t.Errorf("expiresInHours %d = %d, want 422", h, st)
		}
	}
	if st, _, _ := issueReset(t, ts.URL, owner, 9999, map[string]any{}); st != 404 {
		t.Errorf("unknown user = %d", st)
	}
	if st, _, _ := issueReset(t, ts.URL, out.Token, bobID, map[string]any{}); st != 403 {
		t.Errorf("as non-admin = %d", st)
	}
}

func TestResetTokenAnswersAreIdentical(t *testing.T) {
	ts, sqlDB := newLooseServer(t)
	owner := registerUser(t, ts.URL, "owner", "")
	registerUser(t, ts.URL, "bobby", owner)
	bobID := userID(t, sqlDB, "bobby")
	issue := func() string {
		_, l, _ := issueReset(t, ts.URL, owner, bobID, map[string]any{})
		return tokenOf(l.Path)
	}
	expired := issue()
	sqlDB.Exec(`UPDATE password_resets SET expires_at = '2000-01-01T00:00:00Z'`)
	used := issue()
	sqlDB.Exec(`UPDATE password_resets SET used_at = '2020-01-01T00:00:00Z' WHERE token_hash = ?`, tokHash(used))
	disabled := issue()
	sqlDB.Exec(`UPDATE users SET disabled_at = '2020-01-01T00:00:00Z' WHERE id = ?`, bobID)
	var first string
	for i, tok := range []string{"unknown-token-value", expired, used, disabled} {
		for _, path := range []string{"/api/auth/reset/check", "/api/auth/reset"} {
			resp := doJSON(t, "POST", ts.URL, path, "", map[string]any{"token": tok, "password": "brand-new-password"})
			b := new(strings.Builder)
			var e errBody
			decodeJSON(t, resp, &e)
			b.WriteString(e.Error + "|" + e.Message)
			if resp.StatusCode != 400 || e.Error != "token_invalid" {
				t.Errorf("token %d on %s = %d %s", i, path, resp.StatusCode, e.Error)
			}
			if first == "" {
				first = b.String()
			} else if b.String() != first {
				t.Errorf("token %d on %s body differs: %s vs %s", i, path, b.String(), first)
			}
		}
	}
}

func TestResetConcurrentUsesOneWinner(t *testing.T) {
	ts, sqlDB := newLooseServer(t)
	owner := registerUser(t, ts.URL, "owner", "")
	registerUser(t, ts.URL, "bobby", owner)
	_, l, _ := issueReset(t, ts.URL, owner, userID(t, sqlDB, "bobby"), map[string]any{})
	tok := tokenOf(l.Path)
	var wg sync.WaitGroup
	var mu sync.Mutex
	got := map[int]int{}
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r := doJSON(t, "POST", ts.URL, "/api/auth/reset", "", map[string]any{"token": tok, "password": "concurrent-pass-" + string(rune('a'+i))})
			mu.Lock()
			got[r.StatusCode]++
			mu.Unlock()
		}()
	}
	wg.Wait()
	if got[200] != 1 || got[400] != 5 {
		t.Errorf("statuses = %v, want one 200 and five 400", got)
	}
}

func TestResetUseClearsForcedChange(t *testing.T) {
	ts, sqlDB := newLooseServer(t)
	owner := registerUser(t, ts.URL, "owner", "")
	doJSON(t, "POST", ts.URL, "/api/admin/users", owner, map[string]any{"username": "carla", "password": "temp-password-1"})
	_, l, _ := issueReset(t, ts.URL, owner, userID(t, sqlDB, "carla"), map[string]any{})
	var out struct{ Token string }
	decodeJSON(t, doJSON(t, "POST", ts.URL, "/api/auth/reset", "", map[string]any{"token": tokenOf(l.Path), "password": "carla-new-password"}), &out)
	if r := doJSON(t, "GET", ts.URL, "/api/workspaces", out.Token, nil); r.StatusCode != 200 {
		t.Errorf("session after reset is still restricted: %d", r.StatusCode)
	}
}
