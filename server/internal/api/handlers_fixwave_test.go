package api_test

import (
	"context"
	"testing"

	"qinqin/internal/auth"
)

func TestPendingResetLinkDiesWithContainment(t *testing.T) {
	ts, sqlDB := newLooseServer(t)
	owner := registerUser(t, ts.URL, "owner", "")
	victim := registerUser(t, ts.URL, "bobby", owner)
	vid := userID(t, sqlDB, "bobby")
	_, link, _ := issueReset(t, ts.URL, owner, vid, map[string]any{})
	tok := tokenOf(link.Path)
	// The account holder changes the password: the attacker's link is dead.
	if r := doJSON(t, "POST", ts.URL, "/api/account/password", victim, map[string]any{"currentPassword": "secret-pass-bobby", "newPassword": "bobby-new-password"}); r.StatusCode != 200 {
		t.Fatalf("change = %d", r.StatusCode)
	}
	var e1, e2 errBody
	r1 := doJSON(t, "POST", ts.URL, "/api/auth/reset", "", map[string]any{"token": tok, "password": "attacker-password-1"})
	decodeJSON(t, r1, &e1)
	r2 := doJSON(t, "POST", ts.URL, "/api/auth/reset", "", map[string]any{"token": "unknown-token-value", "password": "attacker-password-1"})
	decodeJSON(t, r2, &e2)
	if r1.StatusCode != 400 || e1 != e2 || e1.Error != "token_invalid" {
		t.Errorf("link after the change = %d %+v (unknown: %+v)", r1.StatusCode, e1, e2)
	}
	// ... and after the owner's CLI recovery
	_, link, _ = issueReset(t, ts.URL, owner, vid, map[string]any{})
	if _, err := auth.RecoverAccount(context.Background(), sqlDB, auth.RecoverOptions{Username: "bobby", Hash: auth.Hash("recovered-temp-pw-1")}); err != nil {
		t.Fatal(err)
	}
	if r := doJSON(t, "POST", ts.URL, "/api/auth/reset/check", "", map[string]any{"token": tokenOf(link.Path)}); r.StatusCode != 400 {
		t.Errorf("link after recover = %d, want 400", r.StatusCode)
	}
}

func TestAdminRevokesAPendingLink(t *testing.T) {
	ts, sqlDB := newLooseServer(t)
	owner := registerUser(t, ts.URL, "owner", "")
	user := registerUser(t, ts.URL, "bobby", owner)
	vid := userID(t, sqlDB, "bobby")
	_, link, _ := issueReset(t, ts.URL, owner, vid, map[string]any{})
	path := "/api/admin/users/" + itoa(vid) + "/reset-link"
	if r := doJSON(t, "DELETE", ts.URL, path, user, nil); r.StatusCode != 403 {
		t.Errorf("non-admin revoke = %d", r.StatusCode)
	}
	if r := doJSON(t, "DELETE", ts.URL, path, owner, nil); r.StatusCode != 204 {
		t.Fatalf("revoke = %d", r.StatusCode)
	}
	if r := doJSON(t, "POST", ts.URL, "/api/auth/reset/check", "", map[string]any{"token": tokenOf(link.Path)}); r.StatusCode != 400 {
		t.Errorf("revoked link = %d", r.StatusCode)
	}
	if r := doJSON(t, "DELETE", ts.URL, "/api/admin/users/9999/reset-link", owner, nil); r.StatusCode != 404 {
		t.Errorf("unknown user = %d", r.StatusCode)
	}
	var n int
	sqlDB.QueryRow(`SELECT COUNT(*) FROM auth_audit WHERE action = 'reset_link_revoked'`).Scan(&n)
	if n != 1 {
		t.Errorf("reset_link_revoked rows = %d", n)
	}
}

func TestSensitiveAdminActionsNeedTheAdminsPassword(t *testing.T) {
	ts, sqlDB := newLooseServer(t)
	owner := registerUser(t, ts.URL, "owner", "")
	registerUser(t, ts.URL, "bobby", owner)
	bid := itoa(userID(t, sqlDB, "bobby"))
	calls := map[string][3]string{ // name -> method, path, body-extra
		"delete":     {"DELETE", "/api/admin/users/" + bid, "bobby"},
		"reset-link": {"POST", "/api/admin/users/" + bid + "/reset-link", ""},
		"grant":      {"PATCH", "/api/admin/users/" + bid, ""},
	}
	body := func(name, pw string) map[string]any {
		m := map[string]any{}
		switch name {
		case "delete":
			m["confirm"] = "bobby"
		case "grant":
			m["admin"] = true
		}
		if pw != "" {
			m["currentPassword"] = pw
		}
		return m
	}
	for name, c := range calls {
		var e errBody
		r := doJSON(t, c[0], ts.URL, c[1], owner, body(name, ""))
		decodeJSON(t, r, &e)
		if r.StatusCode != 422 || e.Error != "password_required" {
			t.Errorf("%s without password = %d %s", name, r.StatusCode, e.Error)
		}
		r = doJSON(t, c[0], ts.URL, c[1], owner, body(name, "not-my-password"))
		decodeJSON(t, r, &e)
		if r.StatusCode != 403 || e.Error != "wrong_password" {
			t.Errorf("%s with a wrong password = %d %s", name, r.StatusCode, e.Error)
		}
	}
	if n := countWhere(t, sqlDB, `SELECT COUNT(*) FROM users WHERE id = ?`, userID(t, sqlDB, "bobby")); n != 1 {
		t.Error("user deleted without the password")
	}
	var admin bool
	sqlDB.QueryRow(`SELECT admin FROM users WHERE username = 'bobby'`).Scan(&admin)
	if admin {
		t.Error("admin granted without the password")
	}
	// the right password works for each
	if r := doJSON(t, "PATCH", ts.URL, "/api/admin/users/"+bid, owner, body("grant", "secret-pass-owner")); r.StatusCode != 200 {
		t.Errorf("grant = %d", r.StatusCode)
	}
	// demoting needs no password (it only removes power)
	if r := doJSON(t, "PATCH", ts.URL, "/api/admin/users/"+bid, owner, map[string]any{"admin": false}); r.StatusCode != 200 {
		t.Errorf("demote = %d", r.StatusCode)
	}
}

func TestPatchIsAtomic(t *testing.T) {
	ts, sqlDB := newLooseServer(t)
	owner := registerUser(t, ts.URL, "owner", "")
	setAuthSetting(t, sqlDB, "email_policy", "optional")
	oid := itoa(userID(t, sqlDB, "owner"))
	var e errBody
	r := doJSON(t, "PATCH", ts.URL, "/api/admin/users/"+oid, owner, map[string]any{"email": "new@example.org", "admin": false})
	decodeJSON(t, r, &e)
	if r.StatusCode != 409 || e.Error != "last_admin" {
		t.Fatalf("patch = %d %s", r.StatusCode, e.Error)
	}
	var email *string
	sqlDB.QueryRow(`SELECT email FROM users WHERE username = 'owner'`).Scan(&email)
	if email != nil {
		t.Errorf("the email was written although the demotion was refused: %q", *email)
	}
}
