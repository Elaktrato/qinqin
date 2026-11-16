package api_test

import (
	"encoding/json"
	"testing"
	"time"
)

func TestMFAContractFixturesMatchTheServer(t *testing.T) {
	e := newMailEnv(t, mailOpts{configure: true})
	setAuthSetting(t, e.db, "email_policy", "optional")
	setAuthSetting(t, e.db, "email_code_login", "1")
	registerUser(t, e.ts.URL, "carol", e.owner)
	bob := registerUser(t, e.ts.URL, "bobby", e.owner)
	e.db.Exec(`UPDATE users SET email = 'bobby@example.org', email_norm = 'bobby@example.org', email_verified_at = 't' WHERE username = 'bobby'`)
	check := func(file, name string, status int, body any) {
		t.Helper()
		var c fixtureCase
		raw, ok := readFixture(t, file)[name]
		if !ok {
			t.Errorf("%s has no case %q", file, name)
			return
		}
		if err := json.Unmarshal(raw, &c); err != nil {
			t.Fatal(err)
		}
		secretFree(t, file+"/"+name, c.Body)
		if status != c.Status {
			t.Errorf("%s/%s: status %d, fixture says %d", file, name, status, c.Status)
		}
		sameShape(t, file+"/"+name, c.Body, body)
	}
	// setup and confirm (before TOTP is on, so enrolment runs through the fixtures)
	var setup map[string]any
	st, b := callJSON(t, e.ts, "POST", "/api/account/mfa/totp/setup", bob, map[string]any{"password": "secret-pass-bobby"})
	check("mfa-setup.json", "setup", st, b)
	setup = b.(map[string]any)
	st, b = callJSON(t, e.ts, "POST", "/api/account/mfa/totp/confirm", bob, map[string]any{"code": "000000"})
	check("mfa-setup.json", "confirm_wrong", st, b)
	code, _ := totpAt(setup["secret"].(string), e.clk.now())
	st, b = callJSON(t, e.ts, "POST", "/api/account/mfa/totp/confirm", bob, map[string]any{"code": code})
	check("mfa-setup.json", "confirm", st, b)
	e.clk.advance(30 * time.Second)

	st, b = callJSON(t, e.ts, "POST", "/api/auth/login", "", map[string]any{"username": "bobby", "password": "secret-pass-bobby"})
	check("mfa-login.json", "mfa_required", st, b)
	chal := b.(map[string]any)["challenge"].(string)
	st, b = callJSON(t, e.ts, "POST", "/api/auth/login/mfa", "", map[string]any{"challenge": chal, "method": "totp", "code": "000000"})
	check("mfa-login.json", "code_invalid", st, b)
	ok, _ := totpAt(setup["secret"].(string), e.clk.now())
	st, b = callJSON(t, e.ts, "POST", "/api/auth/login/mfa", "", map[string]any{"challenge": chal, "method": "totp", "code": ok})
	check("mfa-login.json", "second_step_ok", st, b)
	st, b = callJSON(t, e.ts, "POST", "/api/auth/login/mfa", "", map[string]any{"challenge": "chal_gone", "method": "totp", "code": "000000"})
	check("mfa-login.json", "challenge_expired", st, b)

	st, b = callJSON(t, e.ts, "POST", "/api/auth/email-login/start", "", map[string]any{"login": "bobby"})
	check("mfa-login.json", "email_login_start", st, b)
	setAuthSetting(t, e.db, "mfa_enforced", "1")
	// carol has no address: enforcement gives an enrolment session
	st, b = callJSON(t, e.ts, "POST", "/api/auth/login", "", map[string]any{"username": "carol", "password": "secret-pass-carol"})
	check("mfa-login.json", "mfa_enrollment_required", st, b)
	// enforced, a user without an authenticator who tries the emailed code
	e.db.Exec(`UPDATE users SET email = 'carol@example.org', email_norm = 'carol@example.org', email_verified_at = 't' WHERE username = 'carol'`)
	_, s2 := callJSON(t, e.ts, "POST", "/api/auth/email-login/start", "", map[string]any{"login": "carol"})
	mail := e.waitMails(t, 2)
	st, b = callJSON(t, e.ts, "POST", "/api/auth/email-login/verify", "", map[string]any{"challenge": s2.(map[string]any)["challenge"], "code": codeIn(t, mail[len(mail)-1])})
	check("mfa-login.json", "email_login_password_required", st, b)
}
