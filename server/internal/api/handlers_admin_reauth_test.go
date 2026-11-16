package api_test

import (
	"database/sql"
	"net/http"
	"strconv"
	"testing"
	"time"
)

// adminReauthRoute is one destructive admin action: fresh() prepares a new
// target and returns the request, and ok is the success status.
type adminReauthRoute struct {
	name  string
	ok    int
	once  bool // a success cannot be repeated in the same test (rate limit, nothing left to remove)
	fresh func(t *testing.T, e *mailEnv, n int) (method, path string, body map[string]any)
}

func adminReauthRoutes() []adminReauthRoute {
	target := func(t *testing.T, e *mailEnv, n int) (string, string) {
		name := "target" + strconv.Itoa(n)
		registerUser(t, e.ts.URL, name, e.owner)
		return name, "/api/admin/users/" + userIDOf(t, e, name)
	}
	return []adminReauthRoute{
		{"grant admin", http.StatusOK, false, func(t *testing.T, e *mailEnv, n int) (string, string, map[string]any) {
			_, p := target(t, e, n)
			return "PATCH", p, map[string]any{"admin": true}
		}},
		{"create an administrator", http.StatusCreated, false, func(t *testing.T, e *mailEnv, n int) (string, string, map[string]any) {
			return "POST", "/api/admin/users", map[string]any{"username": "newadmin" + strconv.Itoa(n), "password": "temp-password-1", "admin": true}
		}},
		{"delete user", http.StatusNoContent, false, func(t *testing.T, e *mailEnv, n int) (string, string, map[string]any) {
			name, p := target(t, e, n)
			return "DELETE", p, map[string]any{"confirm": name}
		}},
		{"issue reset link", http.StatusCreated, false, func(t *testing.T, e *mailEnv, n int) (string, string, map[string]any) {
			_, p := target(t, e, n)
			return "POST", p + "/reset-link", map[string]any{}
		}},
		{"reset two-step sign-in", http.StatusNoContent, false, func(t *testing.T, e *mailEnv, n int) (string, string, map[string]any) {
			_, p := target(t, e, n)
			return "POST", p + "/mfa/reset", map[string]any{}
		}},
		{"change another user's email", http.StatusOK, false, func(t *testing.T, e *mailEnv, n int) (string, string, map[string]any) {
			setAuthSetting(t, e.db, "email_policy", "optional")
			_, p := target(t, e, n)
			return "PATCH", p, map[string]any{"email": "new" + strconv.Itoa(n) + "@example.org"}
		}},
		{"change one's own email through the admin route", http.StatusOK, false, func(t *testing.T, e *mailEnv, n int) (string, string, map[string]any) {
			setAuthSetting(t, e.db, "email_policy", "optional")
			return "PATCH", "/api/admin/users/" + userIDOf(t, e, "owner"), map[string]any{"email": "own" + strconv.Itoa(n) + "@example.org"}
		}},
		{"remove another user's email", http.StatusOK, false, func(t *testing.T, e *mailEnv, n int) (string, string, map[string]any) {
			setAuthSetting(t, e.db, "email_policy", "optional")
			name, p := target(t, e, n)
			e.db.Exec(`UPDATE users SET email = ?, email_norm = ?, email_verified_at = 't' WHERE username = ?`, name+"@example.org", name+"@example.org", name)
			return "PATCH", p, map[string]any{"email": nil}
		}},
		{"save the mail settings", http.StatusOK, false, func(t *testing.T, e *mailEnv, n int) (string, string, map[string]any) {
			p := e.smtpPayload()
			delete(p, "currentPassword")
			p["fromName"] = "qinqin " + strconv.Itoa(n)
			return "PUT", "/api/admin/settings/smtp", p
		}},
		{"remove the mail settings", http.StatusNoContent, true, func(t *testing.T, e *mailEnv, n int) (string, string, map[string]any) {
			return "DELETE", "/api/admin/settings/smtp", map[string]any{}
		}},
		{"server backup", http.StatusOK, true, func(t *testing.T, e *mailEnv, n int) (string, string, map[string]any) {
			return "POST", "/api/admin/backup", map[string]any{"include": []string{"books"}}
		}},
	}
}

func with(body map[string]any, kv ...any) map[string]any {
	out := map[string]any{}
	for k, v := range body {
		out[k] = v
	}
	for i := 0; i+1 < len(kv); i += 2 {
		out[kv[i].(string)] = kv[i+1]
	}
	return out
}

// Every destructive admin action asks for the acting administrator's own
// password and, from an administrator with an authenticator, a code: a
// stolen admin session alone (or with a phished password) is not enough.
func TestDestructiveAdminActionsAskAnAdminWithTwoFactorForACode(t *testing.T) {
	for _, rt := range adminReauthRoutes() {
		t.Run(rt.name, func(t *testing.T) {
			e := newMailEnv(t, mailOpts{configure: true})
			secret, recovery := e.enrolTOTP(t, e.owner, "secret-pass-owner")
			e.clk.advance(31 * time.Second) // the enrolment's code is spent for its step
			expect := func(label string, r *http.Response, status int, code string) {
				t.Helper()
				var eb errBody
				if code != "" {
					decodeJSON(t, r, &eb)
				}
				if r.StatusCode != status || eb.Error != code {
					t.Errorf("%s = %d %q, want %d %q", label, r.StatusCode, eb.Error, status, code)
				}
			}
			m, p, b := rt.fresh(t, e, 1)
			expect("no password", doJSON(t, m, e.ts.URL, p, e.owner, b), 422, "password_required")
			expect("no code", doJSON(t, m, e.ts.URL, p, e.owner, with(b, "currentPassword", "secret-pass-owner")), 403, "code_invalid")
			expect("wrong code", doJSON(t, m, e.ts.URL, p, e.owner, with(b, "currentPassword", "secret-pass-owner", "code", "000000")), 403, "code_invalid")
			expect("wrong password, right code", doJSON(t, m, e.ts.URL, p, e.owner, with(b, "currentPassword", "wrong-password-x", "code", e.code(secret, 0))), 403, "wrong_password")
			expect("recovery code", doJSON(t, m, e.ts.URL, p, e.owner, with(b, "currentPassword", "secret-pass-owner", "code", recovery[0])), rt.ok, "")
			if rt.once {
				return // the backup: one per minute (its authenticator code: TestAdminServerBackupAsksAnAdminWithTwoFactorForTheCode); the mail settings: removed
			}
			m, p, b = rt.fresh(t, e, 2)
			expect("used recovery code", doJSON(t, m, e.ts.URL, p, e.owner, with(b, "currentPassword", "secret-pass-owner", "code", recovery[0])), 403, "code_invalid")
			code := e.code(secret, 0)
			expect("authenticator code", doJSON(t, m, e.ts.URL, p, e.owner, with(b, "currentPassword", "secret-pass-owner", "code", code)), rt.ok, "")
			m, p, b = rt.fresh(t, e, 3)
			expect("the same authenticator code again", doJSON(t, m, e.ts.URL, p, e.owner, with(b, "currentPassword", "secret-pass-owner", "code", code)), 403, "code_invalid")
		})
	}
}

// An administrator without an authenticator confirms with the password alone.
func TestDestructiveAdminActionsNeedOnlyThePasswordWithoutAnAuthenticator(t *testing.T) {
	for _, rt := range adminReauthRoutes() {
		t.Run(rt.name, func(t *testing.T) {
			e := newMailEnv(t, mailOpts{configure: true})
			m, p, b := rt.fresh(t, e, 1)
			if r := doJSON(t, m, e.ts.URL, p, e.owner, b); r.StatusCode != 422 {
				t.Errorf("no password = %d", r.StatusCode)
			}
			if r := doJSON(t, m, e.ts.URL, p, e.owner, with(b, "currentPassword", "secret-pass-owner")); r.StatusCode != rt.ok {
				t.Errorf("password = %d, want %d", r.StatusCode, rt.ok)
			}
		})
	}
}

// The review's probe: with nothing but a stolen admin session, mint a second
// administrator and use it to strip the owner's authenticator. The first
// step must fail and leave no account behind.
func TestAStolenAdminSessionAloneCannotMintAnAdministrator(t *testing.T) {
	e := newMailEnv(t, mailOpts{configure: true})
	var eb errBody
	r := doJSON(t, "POST", e.ts.URL, "/api/admin/users", e.owner, map[string]any{"username": "mallory", "password": "temp-password-1", "admin": true})
	decodeJSON(t, r, &eb)
	if r.StatusCode != 422 || eb.Error != "password_required" {
		t.Fatalf("create admin with a session only = %d %q", r.StatusCode, eb.Error)
	}
	var n int
	e.db.QueryRow(`SELECT COUNT(*) FROM users WHERE username = 'mallory'`).Scan(&n)
	if n != 0 {
		t.Fatal("the refused administrator exists")
	}
	// a plain user still needs no re-authentication
	if r := doJSON(t, "POST", e.ts.URL, "/api/admin/users", e.owner, map[string]any{"username": "plainuser", "password": "temp-password-1"}); r.StatusCode != 201 {
		t.Errorf("create a plain user = %d", r.StatusCode)
	}
}

// The review's takeover chain: with only a stolen admin session, point an
// account's address (another user's, or the administrator's own, which would
// then also hand over the re-authentication password) at the attacker and
// ask for a reset link. The address change must be refused and nothing mailed.
func TestAStolenAdminSessionCannotRedirectAnAccountsResetMail(t *testing.T) {
	for _, who := range []string{"owner", "bobby"} {
		t.Run(who, func(t *testing.T) {
			e := newMailEnv(t, mailOpts{configure: true})
			setAuthSetting(t, e.db, "email_policy", "optional")
			registerUser(t, e.ts.URL, "bobby", e.owner)
			var eb errBody
			r := doJSON(t, "PATCH", e.ts.URL, "/api/admin/users/"+userIDOf(t, e, who), e.owner, map[string]any{"email": "evil@attacker.test"})
			decodeJSON(t, r, &eb)
			if r.StatusCode != 422 || eb.Error != "password_required" {
				t.Fatalf("address change with a session only = %d %q", r.StatusCode, eb.Error)
			}
			var stored sql.NullString
			e.db.QueryRow(`SELECT email FROM users WHERE username = ?`, who).Scan(&stored)
			if stored.Valid {
				t.Fatalf("address stored: %q", stored.String)
			}
			doJSON(t, "POST", e.ts.URL, "/api/auth/reset-request", "", map[string]any{"login": who})
			e.noMoreMails(t, 0)
		})
	}
}
