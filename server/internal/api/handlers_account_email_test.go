package api_test

import "testing"

func TestAccountEmailFollowsThePolicy(t *testing.T) {
	ts, sqlDB := newLooseServer(t)
	owner := registerUser(t, ts.URL, "owner", "")
	bob := registerUser(t, ts.URL, "bobby", owner)
	put := func(tok string, body map[string]any) (int, errBody) {
		r := doJSON(t, "PUT", ts.URL, "/api/account/email", tok, body)
		var e errBody
		decodeJSON(t, r, &e)
		return r.StatusCode, e
	}
	pw := "secret-pass-bobby"
	// off: an address is refused
	if st, e := put(bob, map[string]any{"email": "b@example.org", "currentPassword": pw}); st != 422 || e.Error != "email_disabled" {
		t.Errorf("off = %d %s", st, e.Error)
	}
	setAuthSetting(t, sqlDB, "email_policy", "optional")
	if st, e := put(bob, map[string]any{"email": "b@example.org", "currentPassword": "wrong-password-x"}); st != 403 || e.Error != "wrong_password" {
		t.Errorf("wrong password = %d %s", st, e.Error)
	}
	if st, _ := put(bob, map[string]any{"email": "b@example.org", "currentPassword": pw}); st != 200 {
		t.Fatalf("set = %d", st)
	}
	var me struct {
		Email         *string `json:"email"`
		EmailVerified bool    `json:"emailVerified"`
	}
	decodeJSON(t, doJSON(t, "GET", ts.URL, "/api/auth/me", bob, nil), &me)
	if me.Email == nil || *me.Email != "b@example.org" || me.EmailVerified {
		t.Errorf("me = %+v, want the address, unverified", me)
	}
	// someone else's address
	if st, e := put(owner, map[string]any{"email": "B@Example.org", "currentPassword": "secret-pass-owner"}); st != 409 || e.Error != "email_taken" {
		t.Errorf("taken = %d %s", st, e.Error)
	}
	// probing: a wrong or missing password never reveals a taken address
	if st, e := put(owner, map[string]any{"email": "b@example.org", "currentPassword": "wrong-password-x"}); st != 403 || e.Error != "wrong_password" {
		t.Errorf("probe with a wrong password = %d %s, want 403 wrong_password", st, e.Error)
	}
	if st, e := put(owner, map[string]any{"email": "b@example.org"}); st != 403 || e.Error != "current_password_required" {
		t.Errorf("probe without a password = %d %s, want 403 current_password_required", st, e.Error)
	}
	// a restricted (enrolment) session cannot use the route at all
	sqlDB.Exec(`UPDATE sessions SET level = 'enroll' WHERE user_id = (SELECT id FROM users WHERE username = 'owner')`)
	if st, e := put(owner, map[string]any{"email": "b@example.org", "currentPassword": "secret-pass-owner"}); st != 403 || e.Error != "mfa_enrollment_required" {
		t.Errorf("enrolment session = %d %s", st, e.Error)
	}
	sqlDB.Exec(`UPDATE sessions SET level = 'full'`)
	// re-saving the same address keeps verification
	sqlDB.Exec(`UPDATE users SET email_verified_at = '2026-01-01T00:00:00Z' WHERE username = 'bobby'`)
	put(bob, map[string]any{"email": "B@example.org", "currentPassword": pw})
	var verified *string
	sqlDB.QueryRow(`SELECT email_verified_at FROM users WHERE username = 'bobby'`).Scan(&verified)
	if verified == nil {
		t.Error("re-saving the same address dropped its verification")
	}
	// required: cannot clear; optional: can
	setAuthSetting(t, sqlDB, "email_policy", "required")
	if st, e := put(bob, map[string]any{"email": nil, "currentPassword": pw}); st != 422 || e.Error != "email_required" {
		t.Errorf("clear under required = %d %s", st, e.Error)
	}
	setAuthSetting(t, sqlDB, "email_policy", "optional")
	if st, _ := put(bob, map[string]any{"email": nil, "currentPassword": pw}); st != 200 {
		t.Errorf("clear under optional = %d", st)
	}
	if st, _ := put("", map[string]any{"email": nil}); st != 401 {
		t.Errorf("anonymous = %d", st)
	}
}
