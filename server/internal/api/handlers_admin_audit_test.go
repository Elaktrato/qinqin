package api_test

import (
	"io"
	"strings"
	"testing"
)

type auditPage struct {
	Events []struct {
		ID     int64                  `json:"id"`
		Action string                 `json:"action"`
		Actor  *struct{ Name string } `json:"actor"`
		Detail map[string]any         `json:"detail"`
	} `json:"events"`
	Next *int64 `json:"next"`
}

func TestAuditListPagesNewestFirst(t *testing.T) {
	ts, sqlDB := newLooseServer(t)
	owner := registerUser(t, ts.URL, "owner", "")
	user := registerUser(t, ts.URL, "bobby", owner)
	for i := 0; i < 7; i++ {
		doJSON(t, "POST", ts.URL, "/api/admin/invites", owner, map[string]any{"maxUses": i + 1})
	}
	var total int
	sqlDB.QueryRow(`SELECT COUNT(*) FROM auth_audit`).Scan(&total)
	var p1 auditPage
	decodeJSON(t, doJSON(t, "GET", ts.URL, "/api/admin/audit?limit=3", owner, nil), &p1)
	if len(p1.Events) != 3 || p1.Next == nil || p1.Events[0].ID <= p1.Events[1].ID || p1.Events[0].Actor == nil || p1.Events[0].Actor.Name != "owner" {
		t.Fatalf("page 1 = %+v", p1)
	}
	var p2 auditPage
	decodeJSON(t, doJSON(t, "GET", ts.URL, "/api/admin/audit?limit=3&before="+itoa(*p1.Next), owner, nil), &p2)
	if len(p2.Events) != 3 || p2.Events[0].ID >= *p1.Next {
		t.Errorf("page 2 = %+v", p2)
	}
	var all auditPage
	decodeJSON(t, doJSON(t, "GET", ts.URL, "/api/admin/audit", owner, nil), &all)
	if len(all.Events) != total || all.Next != nil {
		t.Errorf("default page: %d events, next %v, want %d and null", len(all.Events), all.Next, total)
	}
	for _, bad := range []string{"limit=0", "limit=101", "limit=x", "before=0", "before=x"} {
		if r := doJSON(t, "GET", ts.URL, "/api/admin/audit?"+bad, owner, nil); r.StatusCode != 400 {
			t.Errorf("?%s = %d, want 400", bad, r.StatusCode)
		}
	}
	if r := doJSON(t, "GET", ts.URL, "/api/admin/audit", user, nil); r.StatusCode != 403 {
		t.Errorf("non-admin = %d", r.StatusCode)
	}
}

// Every flow of this plan writes audit rows; none may carry a password,
// token or address.
func TestAuditHoldsNoSecrets(t *testing.T) {
	ts, sqlDB := newLooseServer(t)
	owner := registerUser(t, ts.URL, "owner", "")
	setAuthSetting(t, sqlDB, "registration", "open")
	setAuthSetting(t, sqlDB, "email_policy", "optional")
	var inv inviteCreated
	decodeJSON(t, doJSON(t, "POST", ts.URL, "/api/admin/invites", owner, map[string]any{}), &inv)
	regCode(t, ts, "", map[string]any{"username": "joiner", "password": "joiner-pass-secret", "invite": inv.Token, "email": "joiner@example.org"})
	doJSON(t, "POST", ts.URL, "/api/admin/users", owner, map[string]any{"username": "carla", "password": "carla-temp-secret", "email": "carla@example.org"})
	_, link, _ := issueReset(t, ts.URL, owner, userID(t, sqlDB, "carla"), map[string]any{})
	doJSON(t, "POST", ts.URL, "/api/auth/reset", "", map[string]any{"token": tokenOf(link.Path), "password": "carla-reset-secret"})
	doJSON(t, "PATCH", ts.URL, "/api/admin/users/"+itoa(userID(t, sqlDB, "joiner")), owner, map[string]any{"email": "other@example.org", "mustChangePassword": true})
	resp := doJSON(t, "GET", ts.URL, "/api/admin/audit?limit=100", owner, nil)
	raw, _ := io.ReadAll(resp.Body)
	body := string(raw)
	if len(body) < 100 {
		t.Fatalf("audit body too small: %s", body)
	}
	// "tokens" is the audit key counting revoked access tokens (a number,
	// never a token); any other "token" would be one.
	body = strings.ReplaceAll(body, `"tokens":`, "")
	for _, secret := range []string{"secret", "example.org", inv.Token, tokenOf(link.Path), "token", "password\"", "qq_pat_"} {
		if strings.Contains(body, secret) {
			t.Errorf("audit body contains %q", secret)
		}
	}
}
