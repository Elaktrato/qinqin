package api_test

import (
	"context"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"qinqin/internal/api"
	"qinqin/internal/dbtest"
	"qinqin/internal/ratelimit"
)

type apiErr struct {
	Error   string `json:"error"`
	Message string `json:"message"`
}

func pwChange(t *testing.T, ts *httptest.Server, token string, body map[string]any) (int, apiErr, http.Header) {
	t.Helper()
	resp := doJSON(t, http.MethodPost, ts.URL, "/api/account/password", token, body)
	var e apiErr
	decodeJSON(t, resp, &e)
	return resp.StatusCode, e, resp.Header
}

func status(t *testing.T, ts *httptest.Server, path, token string) int {
	t.Helper()
	return doJSON(t, http.MethodGet, ts.URL, path, token, nil).StatusCode
}

func loginStatus(t *testing.T, ts *httptest.Server, user, pass string) int {
	t.Helper()
	return doJSON(t, http.MethodPost, ts.URL, "/api/auth/login", "", map[string]string{"username": user, "password": pass}).StatusCode
}

func TestChangePasswordFullSession(t *testing.T) {
	ts, sqlDB := newServer(t)
	alice := registerUser(t, ts.URL, "alice", "")
	other := login(t, ts.URL, "alice")

	if code, _, _ := pwChange(t, ts, "", map[string]any{"currentPassword": "x", "newPassword": "y"}); code != 401 {
		t.Errorf("anonymous = %d, want 401", code)
	}
	// A wrong current password is 403, never 401: the web client drops its
	// token on any 401.
	code, e, _ := pwChange(t, ts, alice, map[string]any{"currentPassword": "not-the-password", "newPassword": "a-new-long-password"})
	if code != 403 || e.Error != "wrong_password" || e.Message == "" {
		t.Errorf("wrong current = %d %+v, want 403 wrong_password", code, e)
	}
	if status(t, ts, "/api/auth/me", alice) != 200 {
		t.Error("a wrong current password logged the caller out")
	}
	code, e, _ = pwChange(t, ts, alice, map[string]any{"currentPassword": "secret-pass-alice", "newPassword": "short"})
	if code != 422 || e.Error != "weak_password" {
		t.Errorf("weak new = %d %+v, want 422 weak_password", code, e)
	}
	if code, e, _ = pwChange(t, ts, alice, map[string]any{"currentPassword": "secret-pass-alice", "newPassword": "alice"}); code != 422 {
		t.Errorf("new password equal to the username = %d", code)
	}

	code, e, _ = pwChange(t, ts, alice, map[string]any{"currentPassword": "secret-pass-alice", "newPassword": "a-new-long-password"})
	if code != 200 {
		t.Fatalf("change = %d %+v", code, e)
	}
	if loginStatus(t, ts, "alice", "secret-pass-alice") != 401 || loginStatus(t, ts, "alice", "a-new-long-password") != 200 {
		t.Error("old password still works or new one does not")
	}
	if status(t, ts, "/api/auth/me", alice) != 200 {
		t.Error("the changing session was revoked")
	}
	if status(t, ts, "/api/auth/me", other) != 401 {
		t.Error("another session survived the default sign-out-others")
	}
	var detail string
	if err := sqlDB.QueryRow(`SELECT detail FROM auth_audit WHERE action = 'password_changed'`).Scan(&detail); err != nil {
		t.Fatalf("no audit row: %v", err)
	}
	if strings.Contains(detail, "password") && strings.Contains(detail, "a-new") || strings.Contains(detail, "secret") {
		t.Errorf("audit detail leaks: %s", detail)
	}
}

func TestChangePasswordKeepsOthersWhenAsked(t *testing.T) {
	ts, _ := newServer(t)
	alice := registerUser(t, ts.URL, "alice", "")
	other := login(t, ts.URL, "alice")
	f := false
	code, _, _ := pwChange(t, ts, alice, map[string]any{"currentPassword": "secret-pass-alice", "newPassword": "a-new-long-password", "signOutOthers": f})
	if code != 200 || status(t, ts, "/api/auth/me", other) != 200 {
		t.Errorf("code %d, other session alive = %v; want 200 and alive", code, status(t, ts, "/api/auth/me", other) == 200)
	}
}

func TestForcedChangeNeedsNoCurrentPasswordFromTheTemporaryLogin(t *testing.T) {
	ts, sqlDB := newServer(t)
	admin := registerUser(t, ts.URL, "admin1", "")
	bob := registerUser(t, ts.URL, "bobby", admin)
	_ = bob
	// The admin forces a change (flag + the moment it was set); bobby's
	// next login is the one with the temporary password.
	sqlDB.Exec(`UPDATE users SET must_change_password = 1, must_change_after = 0 WHERE username = 'bobby'`)
	pwcToken := login(t, ts.URL, "bobby")
	otherToken := login(t, ts.URL, "bobby")

	if code := status(t, ts, "/api/workspaces", pwcToken); code != 403 {
		t.Fatalf("restricted session reached /api/workspaces: %d", code)
	}
	// Even with signOutOthers false a forced change signs the others out.
	f := false
	code, e, _ := pwChange(t, ts, pwcToken, map[string]any{"newPassword": "a-new-long-password", "signOutOthers": f})
	if code != 200 {
		t.Fatalf("forced change = %d %+v", code, e)
	}
	if status(t, ts, "/api/workspaces", pwcToken) != 200 {
		t.Error("the same token must reach /api/workspaces after the change")
	}
	if status(t, ts, "/api/auth/me", otherToken) != 401 {
		t.Error("a forced change left another session alive")
	}
	var must int
	sqlDB.QueryRow(`SELECT must_change_password FROM users WHERE username = 'bobby'`).Scan(&must)
	if must != 0 {
		t.Error("flag not cleared")
	}
}

func TestSessionOlderThanTheFlagMustGiveTheCurrentPassword(t *testing.T) {
	ts, sqlDB := newServer(t)
	admin := registerUser(t, ts.URL, "admin1", "")
	registerUser(t, ts.URL, "bobby", admin)
	old := login(t, ts.URL, "bobby") // a stolen, older session
	sqlDB.Exec(`UPDATE users SET must_change_password = 1, must_change_after = 999999 WHERE username = 'bobby'`)

	code, e, _ := pwChange(t, ts, old, map[string]any{"newPassword": "attackers-new-password"})
	if code != 403 || e.Error != "current_password_required" {
		t.Errorf("old session without current = %d %+v, want 403 current_password_required", code, e)
	}
	code, e, _ = pwChange(t, ts, old, map[string]any{"currentPassword": "attackers-guess-1", "newPassword": "attackers-new-password"})
	if code != 403 || e.Error != "wrong_password" {
		t.Errorf("old session with a wrong current = %d %+v, want 403 wrong_password", code, e)
	}
	if loginStatus(t, ts, "bobby", "attackers-new-password") == 200 {
		t.Fatal("the account was taken over")
	}
	code, _, _ = pwChange(t, ts, old, map[string]any{"currentPassword": "secret-pass-bobby", "newPassword": "owners-new-password"})
	if code != 200 {
		t.Errorf("with the current password = %d, want 200", code)
	}
}

func TestChangePasswordRefusedForEnrolmentSession(t *testing.T) {
	ts, sqlDB := newServer(t)
	alice := registerUser(t, ts.URL, "alice", "")
	sqlDB.Exec(`UPDATE sessions SET level = 'enroll'`)
	code, e, _ := pwChange(t, ts, alice, map[string]any{"currentPassword": "secret-pass-alice", "newPassword": "a-new-long-password"})
	if code != 403 || e.Error != "mfa_enrollment_required" {
		t.Errorf("enrolment session = %d %+v", code, e)
	}
}

func reauthPolicy(burst int) api.Option {
	p := api.DefaultAuthPolicy()
	p.Named = map[string]ratelimit.BucketPolicy{"reauth": {Burst: burst, Every: time.Hour, MaxKeys: 100}}
	return api.WithAuthPolicy(p)
}

func newPolicyServer(t *testing.T, opts ...api.Option) (*httptest.Server, *sql.DB) {
	t.Helper()
	sqlDB := dbtest.Open(t)
	ts := newTestServer(sqlDB, api.New(sqlDB, t.TempDir(), nil, opts...))
	t.Cleanup(ts.Close)
	return ts, sqlDB
}

func TestReauthLimiterCountsWrongPasswordsOnly(t *testing.T) {
	ts, _ := newPolicyServer(t, reauthPolicy(2))
	alice := registerUser(t, ts.URL, "alice", "")
	for i := 0; i < 2; i++ {
		if code, e, _ := pwChange(t, ts, alice, map[string]any{"currentPassword": "wrong-one-here", "newPassword": "a-new-long-password"}); code != 403 {
			t.Fatalf("wrong %d = %d %+v", i, code, e)
		}
	}
	code, e, h := pwChange(t, ts, alice, map[string]any{"currentPassword": "wrong-one-here", "newPassword": "a-new-long-password"})
	if code != 429 || e.Error != "rate_limited" || h.Get("Retry-After") == "" {
		t.Errorf("third wrong = %d %+v retry-after %q, want 429 rate_limited with Retry-After", code, e, h.Get("Retry-After"))
	}
	// Right passwords do not use the budget up.
	ts2, _ := newPolicyServer(t, reauthPolicy(1))
	bob := registerUser(t, ts2.URL, "bobby", "")
	cur := "secret-pass-bobby"
	for i, next := range []string{"change-number-one", "change-number-two", "change-number-three"} {
		code, e, _ := pwChange(t, ts2, bob, map[string]any{"currentPassword": cur, "newPassword": next})
		if code != 200 {
			t.Fatalf("correct change %d = %d %+v (a right password must refund its token)", i, code, e)
		}
		cur = next
	}
}

// The new hash is computed before any write transaction is open: a write
// issued from inside the hash step must not block on the request's own lock.
func TestChangePasswordHashesBeforeTheTransaction(t *testing.T) {
	var sqlDB *sql.DB
	var probeErr error
	probed := false
	hook := func(pw string) string {
		probed = true
		ctx, cancel := context.WithTimeout(context.Background(), 800*time.Millisecond)
		defer cancel()
		_, probeErr = sqlDB.ExecContext(ctx, `INSERT INTO auth_audit (at, action) VALUES ('probe', 'probe')`)
		return "$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	}
	var ts *httptest.Server
	ts, sqlDB = newPolicyServer(t, api.WithAuthHooks(api.AuthHooks{Hash: hook}))
	alice := registerUser(t, ts.URL, "alice", "")
	probed = false
	if code, e, _ := pwChange(t, ts, alice, map[string]any{"currentPassword": "secret-pass-alice", "newPassword": "a-new-long-password"}); code != 200 {
		t.Fatalf("change = %d %+v", code, e)
	}
	if !probed || probeErr != nil {
		t.Errorf("hash step probed=%v, a write inside it failed: %v", probed, probeErr)
	}
}

// An empty current password is refused before it spends a re-auth token or
// a hash, and `me` says up front whether the form must ask for it.
func TestEmptyCurrentPasswordCostsNothing(t *testing.T) {
	ts, sqlDB := newPolicyServer(t, reauthPolicy(1))
	alice := registerUser(t, ts.URL, "alice", "")
	for i := 0; i < 3; i++ {
		if code, e, _ := pwChange(t, ts, alice, map[string]any{"newPassword": "a-new-long-password"}); code != 403 || e.Error != "current_password_required" {
			t.Fatalf("empty current %d = %d %+v", i, code, e)
		}
	}
	// The single reauth token is still there: one wrong guess is a plain 403.
	if code, e, _ := pwChange(t, ts, alice, map[string]any{"currentPassword": "not-the-one-here", "newPassword": "a-new-long-password"}); code != 403 || e.Error != "wrong_password" {
		t.Errorf("first real guess = %d %+v, want 403 wrong_password", code, e)
	}
	var me struct {
		NeedsCurrentPassword bool `json:"needsCurrentPassword"`
	}
	decodeJSON(t, doJSON(t, http.MethodGet, ts.URL, "/api/auth/me", alice, nil), &me)
	if !me.NeedsCurrentPassword {
		t.Error("a full session must be told to ask for the current password")
	}
	sqlDB.Exec(`UPDATE users SET must_change_password = 1, must_change_after = 0`)
	pwc := login(t, ts.URL, "alice")
	decodeJSON(t, doJSON(t, http.MethodGet, ts.URL, "/api/auth/me", pwc, nil), &me)
	if me.NeedsCurrentPassword {
		t.Error("the temporary-password session needs no current password")
	}
}
