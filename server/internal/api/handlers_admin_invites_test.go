package api_test

import (
	"net/http"
	"sort"
	"strings"
	"testing"
)

type inviteCreated struct {
	Invite map[string]any `json:"invite"`
	Token  string         `json:"token"`
	Path   string         `json:"path"`
}

func TestInviteCreateListRevokeCheck(t *testing.T) {
	ts, sqlDB := newLooseServer(t)
	owner := registerUser(t, ts.URL, "owner", "")
	user := registerUser(t, ts.URL, "plainuser", owner)
	var c inviteCreated
	resp := doJSON(t, "POST", ts.URL, "/api/admin/invites", owner, map[string]any{"maxUses": 3, "expiresInDays": 7, "note": "for the class"})
	decodeJSON(t, resp, &c)
	if resp.StatusCode != 201 || len(c.Token) != 43 || c.Path != "/register#invite="+c.Token {
		t.Fatalf("create = %d token len %d path %q", resp.StatusCode, len(c.Token), c.Path)
	}
	// The database holds the hash only.
	var stored string
	sqlDB.QueryRow(`SELECT token_hash FROM invites`).Scan(&stored)
	if stored == c.Token || stored != tokHash(c.Token) {
		t.Errorf("stored %q is not the SHA-256 of the token", stored)
	}
	if c.Invite["state"] != "inactive" { // registration is closed
		t.Errorf("state while closed = %v, want inactive", c.Invite["state"])
	}
	// The list never carries a token; assert the key set.
	var list struct {
		Invites []map[string]any `json:"invites"`
	}
	decodeJSON(t, doJSON(t, "GET", ts.URL, "/api/admin/invites", owner, nil), &list)
	if len(list.Invites) != 1 {
		t.Fatalf("list = %v", list)
	}
	var keys []string
	for k := range list.Invites[0] {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	if got := strings.Join(keys, ","); got != "createdAt,createdBy,expiresAt,id,maxUses,note,state,uses" {
		t.Errorf("invite keys = %s", got)
	}
	doJSON(t, "PATCH", ts.URL, "/api/admin/settings/auth", owner, map[string]any{"registration": "invite", "currentPassword": "secret-pass-owner"})
	decodeJSON(t, doJSON(t, "GET", ts.URL, "/api/admin/invites", owner, nil), &list)
	if list.Invites[0]["state"] != "active" {
		t.Errorf("state = %v, want active", list.Invites[0]["state"])
	}
	// check
	var chk struct {
		ExpiresAt   *string `json:"expiresAt"`
		EmailPolicy string  `json:"emailPolicy"`
	}
	resp = doJSON(t, "POST", ts.URL, "/api/auth/invite/check", "", map[string]any{"invite": c.Token})
	decodeJSON(t, resp, &chk)
	if resp.StatusCode != 200 || chk.ExpiresAt == nil || chk.EmailPolicy != "off" {
		t.Errorf("check = %d %+v", resp.StatusCode, chk)
	}
	// revoke
	id := int64(list.Invites[0]["id"].(float64))
	if r := doJSON(t, "DELETE", ts.URL, "/api/admin/invites/"+itoa(id), owner, nil); r.StatusCode != 204 {
		t.Errorf("revoke = %d", r.StatusCode)
	}
	if r := doJSON(t, "DELETE", ts.URL, "/api/admin/invites/"+itoa(id), owner, nil); r.StatusCode != 404 {
		t.Errorf("revoke twice = %d, want 404", r.StatusCode)
	}
	if r := doJSON(t, "POST", ts.URL, "/api/auth/invite/check", "", map[string]any{"invite": c.Token}); r.StatusCode != 403 {
		t.Errorf("check after revoke = %d", r.StatusCode)
	}
	// validation
	for _, bad := range []map[string]any{{"maxUses": 0}, {"maxUses": 101}, {"expiresInDays": 0}, {"expiresInDays": 91}, {"note": strings.Repeat("é", 101)}} {
		if r := doJSON(t, "POST", ts.URL, "/api/admin/invites", owner, bad); r.StatusCode != 422 {
			t.Errorf("create %v = %d, want 422", bad, r.StatusCode)
		}
	}
	// defaults: one use, seven days; explicit null: no expiry
	var d inviteCreated
	decodeJSON(t, doJSON(t, "POST", ts.URL, "/api/admin/invites", owner, map[string]any{}), &d)
	if d.Invite["maxUses"] != float64(1) || d.Invite["expiresAt"] == nil {
		t.Errorf("defaults = %v", d.Invite)
	}
	decodeJSON(t, doJSON(t, "POST", ts.URL, "/api/admin/invites", owner, map[string]any{"expiresInDays": nil}), &d)
	if d.Invite["expiresAt"] != nil {
		t.Errorf("explicit null expiry = %v", d.Invite["expiresAt"])
	}
	// authorization
	for _, call := range [][2]string{{"GET", "/api/admin/invites"}, {"POST", "/api/admin/invites"}, {"DELETE", "/api/admin/invites/1"}} {
		if r := doJSON(t, call[0], ts.URL, call[1], user, map[string]any{}); r.StatusCode != http.StatusForbidden {
			t.Errorf("%v as user = %d", call, r.StatusCode)
		}
	}
	// audit
	for _, action := range []string{"invite_created", "invite_revoked"} {
		var n int
		sqlDB.QueryRow(`SELECT COUNT(*) FROM auth_audit WHERE action = ?`, action).Scan(&n)
		if n == 0 {
			t.Errorf("no %s audit row", action)
		}
	}
	// invite_used after a registration
	doJSON(t, "POST", ts.URL, "/api/admin/invites", owner, nil)
	tok := mkInvite(t, sqlDB, 1)
	if st, _ := regCode(t, ts, "", map[string]any{"username": "joiner", "password": "long-enough-pw", "invite": tok}); st != 201 {
		t.Fatal("register by invite failed")
	}
	var n int
	sqlDB.QueryRow(`SELECT COUNT(*) FROM auth_audit WHERE action = 'invite_used'`).Scan(&n)
	if n != 1 {
		t.Errorf("invite_used rows = %d", n)
	}
}
