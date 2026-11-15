package api_test

import (
	"net/http"
	"strings"
	"testing"
)

type adminUserBody struct {
	ID                 int64   `json:"id"`
	Username           string  `json:"username"`
	Email              *string `json:"email"`
	EmailVerified      bool    `json:"emailVerified"`
	Admin              bool    `json:"admin"`
	Disabled           bool    `json:"disabled"`
	MustChangePassword bool    `json:"mustChangePassword"`
	LastSeenAt         *string `json:"lastSeenAt"`
}

func loginRaw(t *testing.T, tsURL, user, pass string) (int, map[string]any) {
	t.Helper()
	resp := doJSON(t, "POST", tsURL, "/api/auth/login", "", map[string]string{"username": user, "password": pass})
	var m map[string]any
	decodeJSON(t, resp, &m)
	return resp.StatusCode, m
}

func TestAdminCreateUserForcesChange(t *testing.T) {
	ts, sqlDB := newLooseServer(t)
	owner := registerUser(t, ts.URL, "owner", "")
	setAuthSetting(t, sqlDB, "email_policy", "optional")
	var u adminUserBody
	resp := doJSON(t, "POST", ts.URL, "/api/admin/users", owner, map[string]any{"username": "carla", "password": "temp-password-1", "email": "Carla@Example.org"})
	decodeJSON(t, resp, &u)
	if resp.StatusCode != 201 || !u.MustChangePassword || u.Admin || !u.EmailVerified || u.Email == nil {
		t.Fatalf("create = %d %+v", resp.StatusCode, u)
	}
	st, login := loginRaw(t, ts.URL, "carla", "temp-password-1")
	if st != 200 || login["status"] != "password_change_required" {
		t.Fatalf("login = %d %v", st, login)
	}
	token := login["token"].(string)
	if r := doJSON(t, "GET", ts.URL, "/api/workspaces", token, nil); r.StatusCode != 403 {
		t.Errorf("workspaces before the change = %d, want 403", r.StatusCode)
	}
	// The temporary session changes the password without the current one.
	if r := doJSON(t, "POST", ts.URL, "/api/account/password", token, map[string]any{"newPassword": "carla-chosen-pw"}); r.StatusCode != 200 {
		t.Fatalf("change = %d", r.StatusCode)
	}
	if r := doJSON(t, "GET", ts.URL, "/api/workspaces", token, nil); r.StatusCode != 200 {
		t.Errorf("workspaces after the change = %d", r.StatusCode)
	}
	// validation reuses the registration rules
	for body, want := range map[string]int{
		`{"username":"ab","password":"temp-password-1"}`:                                422,
		`{"username":"carla","password":"temp-password-1"}`:                             409,
		`{"username":"dave1","password":"short"}`:                                       422,
		`{"username":"dave1","password":"temp-password-1","email":"nope"}`:              422,
		`{"username":"dave1","password":"temp-password-1","email":"carla@example.org"}`: 409,
	} {
		req, _ := http.NewRequest("POST", ts.URL+"/api/admin/users", strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+owner)
		r, _ := http.DefaultClient.Do(req)
		if r.StatusCode != want {
			t.Errorf("%s = %d, want %d", body, r.StatusCode, want)
		}
		r.Body.Close()
	}
	var created int
	sqlDB.QueryRow(`SELECT COUNT(*) FROM auth_audit WHERE action = 'user_created'`).Scan(&created)
	if created != 1 {
		t.Errorf("user_created rows = %d", created)
	}
}

func TestAdminPatchUsersLastAdminAndDisable(t *testing.T) {
	ts, sqlDB := newLooseServer(t)
	owner := registerUser(t, ts.URL, "owner", "")
	bob := registerUser(t, ts.URL, "bobby", owner)
	var ownerID, bobID int64
	sqlDB.QueryRow(`SELECT id FROM users WHERE username = 'owner'`).Scan(&ownerID)
	sqlDB.QueryRow(`SELECT id FROM users WHERE username = 'bobby'`).Scan(&bobID)
	path := func(id int64) string { return "/api/admin/users/" + itoa(id) }
	code := func(r *http.Response) string {
		var e errBody
		decodeJSON(t, r, &e)
		return e.Error
	}
	// the only admin cannot be demoted
	if r := doJSON(t, "PATCH", ts.URL, path(ownerID), owner, map[string]any{"admin": false}); r.StatusCode != 409 || code(r) != "last_admin" {
		t.Errorf("demote only admin = %d", r.StatusCode)
	}
	// self-disable
	if r := doJSON(t, "PATCH", ts.URL, path(ownerID), owner, map[string]any{"disabled": true}); r.StatusCode != 409 || code(r) != "self_target" {
		t.Errorf("self disable = %d", r.StatusCode)
	}
	// mustChangePassword:false
	if r := doJSON(t, "PATCH", ts.URL, path(bobID), owner, map[string]any{"mustChangePassword": false}); r.StatusCode != 422 {
		t.Errorf("mustChangePassword:false = %d", r.StatusCode)
	}
	if r := doJSON(t, "PATCH", ts.URL, path(9999), owner, map[string]any{"admin": true}); r.StatusCode != 404 {
		t.Errorf("unknown id = %d", r.StatusCode)
	}
	// disable bob: his session is gone, login is 403 account_disabled
	var u adminUserBody
	decodeJSON(t, doJSON(t, "PATCH", ts.URL, path(bobID), owner, map[string]any{"disabled": true}), &u)
	if !u.Disabled {
		t.Fatalf("disable = %+v", u)
	}
	if r := doJSON(t, "GET", ts.URL, "/api/auth/me", bob, nil); r.StatusCode != 401 {
		t.Errorf("disabled user's token = %d, want 401", r.StatusCode)
	}
	if st, m := loginRaw(t, ts.URL, "bobby", "secret-pass-bobby"); st != 403 || m["error"] != "account_disabled" {
		t.Errorf("disabled login = %d %v", st, m)
	}
	// re-enable never resurrects the old token
	doJSON(t, "PATCH", ts.URL, path(bobID), owner, map[string]any{"disabled": false})
	if r := doJSON(t, "GET", ts.URL, "/api/auth/me", bob, nil); r.StatusCode != 401 {
		t.Errorf("old token after re-enable = %d, want 401", r.StatusCode)
	}
	// make bob admin, then owner can be demoted, then the last one cannot
	if r := doJSON(t, "PATCH", ts.URL, path(bobID), owner, map[string]any{"admin": true}); r.StatusCode != 200 {
		t.Fatalf("promote = %d", r.StatusCode)
	}
	if r := doJSON(t, "PATCH", ts.URL, path(ownerID), owner, map[string]any{"admin": false}); r.StatusCode != 200 {
		t.Errorf("demote self with another admin = %d", r.StatusCode)
	}
	bobTok := login(t, ts.URL, "bobby")
	if r := doJSON(t, "PATCH", ts.URL, path(bobID), bobTok, map[string]any{"admin": false}); r.StatusCode != 409 {
		t.Errorf("demote the last admin = %d, want 409", r.StatusCode)
	}
	// force a change: every session of the user goes
	second := login(t, ts.URL, "owner")
	if r := doJSON(t, "PATCH", ts.URL, path(ownerID), bobTok, map[string]any{"mustChangePassword": true}); r.StatusCode != 200 {
		t.Fatalf("force = %d", r.StatusCode)
	}
	for _, tok := range []string{owner, second} {
		if r := doJSON(t, "GET", ts.URL, "/api/auth/me", tok, nil); r.StatusCode != 401 {
			t.Errorf("session survived a forced change: %d", r.StatusCode)
		}
	}
	st, m := loginRaw(t, ts.URL, "owner", "secret-pass-owner")
	if st != 200 || m["status"] != "password_change_required" {
		t.Errorf("login after force = %d %v", st, m)
	}
	// revoke sessions
	var rev struct{ Revoked int }
	decodeJSON(t, doJSON(t, "POST", ts.URL, path(ownerID)+"/sessions/revoke", bobTok, nil), &rev)
	if rev.Revoked != 1 {
		t.Errorf("revoked = %d, want 1", rev.Revoked)
	}
	// list shape
	var list struct{ Users []adminUserBody }
	decodeJSON(t, doJSON(t, "GET", ts.URL, "/api/admin/users", bobTok, nil), &list)
	if len(list.Users) != 2 || list.Users[0].Username != "bobby" {
		t.Errorf("list = %+v", list.Users)
	}
	// matrix: a plain user
	plain := registerUser(t, ts.URL, "plainone", bobTok)
	for _, call := range [][2]string{{"GET", "/api/admin/users"}, {"POST", "/api/admin/users"}, {"GET", path(1)}, {"PATCH", path(1)}, {"POST", path(1) + "/sessions/revoke"}} {
		if r := doJSON(t, call[0], ts.URL, call[1], plain, map[string]any{}); r.StatusCode != 403 {
			t.Errorf("%v as user = %d, want 403", call, r.StatusCode)
		}
	}
}
