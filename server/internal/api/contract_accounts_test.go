package api_test

import (
	"encoding/json"
	"strconv"
	"strings"
	"testing"

	"qinqin/internal/api"
)

// runCases decodes the fixture file and runs its cases in the given order
// against the server: status, key sets, JSON types and the error / status
// words must match; options values are compared too (they are deterministic).
func runCases(t *testing.T, file string, order []string, cases map[string]func() (int, any), exactValues bool) {
	t.Helper()
	fx := readFixture(t, file)
	for _, name := range order {
		raw, ok := fx[name]
		if !ok {
			t.Errorf("%s has no case %q", file, name)
			continue
		}
		var c fixtureCase
		if err := json.Unmarshal(raw, &c); err != nil {
			t.Fatalf("%s/%s: %v", file, name, err)
		}
		secretFree(t, file+"/"+name, c.Body)
		status, body := cases[name]()
		if status != c.Status {
			t.Errorf("%s/%s: status %d, fixture says %d (%v)", file, name, status, c.Status, body)
		}
		if c.Body == nil {
			if body != nil {
				t.Errorf("%s/%s: expected no body, got %v", file, name, body)
			}
			continue
		}
		sameShape(t, file+"/"+name, c.Body, body)
		if want, got := c.Body.(map[string]any), body.(map[string]any); exactValues || want["error"] != nil || want["status"] != nil {
			for k, wv := range want {
				if k == "message" && !exactValues {
					continue
				}
				if !exactValues && k != "error" && k != "status" {
					continue
				}
				if gv := got[k]; gv != wv {
					t.Errorf("%s/%s: %s = %v, fixture says %v", file, name, k, gv, wv)
				}
			}
		}
	}
	for n := range fx {
		if strings.HasPrefix(n, "_") {
			continue
		}
		found := false
		for _, o := range order {
			found = found || o == n
		}
		if !found {
			t.Errorf("%s: fixture %q is not exercised by any test", file, n)
		}
	}
}

func TestAccountsContractFixturesMatchTheServer(t *testing.T) {
	p := api.DefaultAuthPolicy()
	p.Client.Burst = 1000
	ts, sqlDB := newPolicyServer(t, api.WithAuthPolicy(p))
	get := func(path string) func() (int, any) {
		return func() (int, any) { return callJSON(t, ts, "GET", path, "", nil) }
	}
	// options: the four states of one instance, in the order it goes through them
	var alice string
	setMode := func(reg, email string) {
		sqlDB.Exec(`UPDATE auth_settings SET registration = ?, email_policy = ?`, reg, email)
	}
	runCases(t, "options.json", []string{"bootstrap", "closed", "invite", "open"}, map[string]func() (int, any){
		"bootstrap": get("/api/auth/options"),
		"closed": func() (int, any) {
			alice = registerUser(t, ts.URL, "alice", "")
			setMode("closed", "off")
			return get("/api/auth/options")()
		},
		"invite": func() (int, any) { setMode("invite", "optional"); return get("/api/auth/options")() },
		"open":   func() (int, any) { setMode("open", "required"); return get("/api/auth/options")() },
	}, true)
	setMode("invite", "off")

	// invites
	var inviteToken string
	var inviteID int64
	runCases(t, "invites.json", []string{"create", "list", "check_ok", "revoke", "check_invalid"}, map[string]func() (int, any){
		"create": func() (int, any) {
			st, body := callJSON(t, ts, "POST", "/api/admin/invites", alice, map[string]any{"maxUses": 5, "expiresInDays": 7, "note": "class of 2026"})
			if m, ok := body.(map[string]any); ok {
				inviteToken, _ = m["token"].(string)
				inviteID = int64(m["invite"].(map[string]any)["id"].(float64))
				m["token"] = "tok_example" // the fixture's obvious fake
			}
			return st, body
		},
		"list": func() (int, any) {
			// A second invite without expiry shows the null shape first.
			callJSON(t, ts, "POST", "/api/admin/invites", alice, map[string]any{"expiresInDays": nil})
			st, body := callJSON(t, ts, "GET", "/api/admin/invites", alice, nil)
			if m, ok := body.(map[string]any); ok {
				l := m["invites"].([]any)
				m["invites"] = []any{l[0]} // newest first: the no-expiry one
			}
			return st, body
		},
		"check_ok": func() (int, any) {
			return callJSON(t, ts, "POST", "/api/auth/invite/check", "", map[string]any{"invite": inviteToken})
		},
		"revoke": func() (int, any) {
			return callJSON(t, ts, "DELETE", "/api/admin/invites/"+strconv.FormatInt(inviteID, 10), alice, nil)
		},
		"check_invalid": func() (int, any) {
			return callJSON(t, ts, "POST", "/api/auth/invite/check", "", map[string]any{"invite": inviteToken})
		},
	}, false)

	// users
	bobTok := registerUser(t, ts.URL, "bobby", alice)
	_ = bobTok
	var carlaID int64
	var aliceID = userID(t, sqlDB, "alice")
	id := func() string { return strconv.FormatInt(carlaID, 10) }
	var resetToken string
	runCases(t, "admin-users.json", []string{"list", "create", "patch", "last_admin", "self_target", "reset_link", "sessions_revoke", "deletion_preview", "confirm_mismatch", "delete"}, map[string]func() (int, any){
		"list": func() (int, any) {
			st, body := callJSON(t, ts, "GET", "/api/admin/users", alice, nil)
			if m, ok := body.(map[string]any); ok {
				m["users"] = m["users"].([]any)[:1]
				m["users"].([]any)[0].(map[string]any)["lastSeenAt"] = "2026-11-15T12:30:00Z"
			}
			return st, body
		},
		"create": func() (int, any) {
			st, body := callJSON(t, ts, "POST", "/api/admin/users", alice, map[string]any{"username": "carla", "password": "temp-password-1"})
			if m, ok := body.(map[string]any); ok {
				carlaID = int64(m["id"].(float64))
			}
			return st, body
		},
		"patch": func() (int, any) {
			return callJSON(t, ts, "PATCH", "/api/admin/users/"+id(), alice, map[string]any{"admin": true})
		},
		"last_admin": func() (int, any) {
			// alice and carla are admins now: demote carla, then alice alone is last
			callJSON(t, ts, "PATCH", "/api/admin/users/"+id(), alice, map[string]any{"admin": false})
			return callJSON(t, ts, "PATCH", "/api/admin/users/"+strconv.FormatInt(aliceID, 10), alice, map[string]any{"admin": false})
		},
		"self_target": func() (int, any) {
			return callJSON(t, ts, "PATCH", "/api/admin/users/"+strconv.FormatInt(aliceID, 10), alice, map[string]any{"disabled": true})
		},
		"reset_link": func() (int, any) {
			st, body := callJSON(t, ts, "POST", "/api/admin/users/"+id()+"/reset-link", alice, map[string]any{"expiresInHours": 24})
			if m, ok := body.(map[string]any); ok {
				resetToken = strings.TrimPrefix(m["path"].(string), "/reset#t=")
			}
			return st, body
		},
		"sessions_revoke": func() (int, any) {
			return callJSON(t, ts, "POST", "/api/admin/users/"+id()+"/sessions/revoke", alice, nil)
		},
		"deletion_preview": func() (int, any) {
			return callJSON(t, ts, "GET", "/api/admin/users/"+id()+"/deletion-preview", alice, nil)
		},
		"confirm_mismatch": func() (int, any) {
			return callJSON(t, ts, "DELETE", "/api/admin/users/"+id(), alice, map[string]any{"confirm": "nope"})
		},
		"delete": func() (int, any) {
			return callJSON(t, ts, "DELETE", "/api/admin/users/"+id(), alice, map[string]any{"confirm": "carla"})
		},
	}, false)
	_ = resetToken

	// reset: a fresh link for bobby
	var tok string
	issue := func() {
		_, body := callJSON(t, ts, "POST", "/api/admin/users/"+strconv.FormatInt(userID(t, sqlDB, "bobby"), 10)+"/reset-link", alice, map[string]any{})
		tok = strings.TrimPrefix(body.(map[string]any)["path"].(string), "/reset#t=")
	}
	runCases(t, "reset.json", []string{"check", "use", "token_invalid"}, map[string]func() (int, any){
		"check": func() (int, any) {
			issue()
			return callJSON(t, ts, "POST", "/api/auth/reset/check", "", map[string]any{"token": tok})
		},
		"use": func() (int, any) {
			st, body := callJSON(t, ts, "POST", "/api/auth/reset", "", map[string]any{"token": tok, "password": "brand-new-password"})
			if m, ok := body.(map[string]any); ok {
				m["token"] = "tok_example"
			}
			return st, body
		},
		"token_invalid": func() (int, any) {
			return callJSON(t, ts, "POST", "/api/auth/reset", "", map[string]any{"token": tok, "password": "brand-new-password"})
		},
	}, false)
}
