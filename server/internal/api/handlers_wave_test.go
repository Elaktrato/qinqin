package api_test

import (
	"strings"
	"testing"
	"time"
)

// waveEnv: bobby has an authenticator AND the email method, a verified address.
func waveEnv(t *testing.T) (*mailEnv, string, string) {
	e := newMailEnv(t, mailOpts{configure: true})
	setAuthSetting(t, e.db, "email_policy", "optional")
	bob := registerUser(t, e.ts.URL, "bobby", e.owner)
	e.db.Exec(`UPDATE users SET email = 'bobby@example.org', email_norm = 'bobby@example.org', email_verified_at = 't' WHERE username = 'bobby'`)
	secret, _ := e.enrolTOTP(t, bob, "secret-pass-bobby")
	e.db.Exec(`UPDATE users SET mfa_email = 1 WHERE username = 'bobby'`)
	e.clk.advance(30 * time.Second)
	return e, bob, secret
}

func hasMethod(body map[string]any, m string) bool {
	ms, _ := body["methods"].([]any)
	for _, x := range ms {
		if x == m {
			return true
		}
	}
	return false
}

// Fix 1+2: the exact PoC. reset-request -> link -> reset -> mfa_required: the
// mailbox that just proved the first factor must not also be the second.
func TestResetByMailNeverOffersTheEmailMethod(t *testing.T) {
	e, _, _ := waveEnv(t)
	if got := rawPost(t, e.ts.URL, "/api/auth/reset-request", map[string]any{"login": "bobby"}); got.status != 202 {
		t.Fatal(got)
	}
	m := e.waitMails(t, 1)[0]
	tok := resetLink.FindStringSubmatch(m.Body)[1]
	var body map[string]any
	r := doJSON(t, "POST", e.ts.URL, "/api/auth/reset", "", map[string]any{"token": tok, "password": "a-brand-new-password"})
	decodeJSON(t, r, &body)
	if body["status"] != "mfa_required" || hasMethod(body, "email") || body["emailHint"] != nil {
		t.Fatalf("reset answer = %v", body)
	}
	chal := body["challenge"].(string)
	r = doJSON(t, "POST", e.ts.URL, "/api/auth/login/mfa/email", "", map[string]any{"challenge": chal})
	if r.StatusCode != 409 {
		t.Errorf("mfa/email on a reset challenge = %d, want 409", r.StatusCode)
	}
	e.noMoreMails(t, 1)
	st, out := e.mfaStep(t, chal, "email", "123456")
	if st == 200 || out["token"] != nil {
		t.Errorf("email step on a reset challenge = %d %v", st, out)
	}
}

func TestEmailCodeSignInNeverOffersTheEmailMethodAsSecondStep(t *testing.T) {
	e, _, _ := waveEnv(t)
	setAuthSetting(t, e.db, "email_code_login", "1")
	_, start := e.emailStart(t, "bobby")
	m := e.waitMails(t, 1)[0]
	st, body := e.emailVerify(t, start["challenge"].(string), codeIn(t, m))
	if st != 200 || body["status"] != "mfa_required" || hasMethod(body, "email") {
		t.Fatalf("verify = %d %v", st, body)
	}
	if r := doJSON(t, "POST", e.ts.URL, "/api/auth/login/mfa/email", "", map[string]any{"challenge": body["challenge"]}); r.StatusCode != 409 {
		t.Errorf("mfa/email = %d, want 409", r.StatusCode)
	}
}

func TestPasswordSignInStillOffersEmailWhenOptedIn(t *testing.T) {
	e, _, _ := waveEnv(t)
	_, body := e.loginAs(t, "bobby")
	if !hasMethod(body, "email") {
		t.Fatalf("password sign-in lost the email method: %v", body)
	}
}

// A challenge only accepts what it was issued with (a totp-only user has no email step).
func TestChallengeRefusesAMethodItWasNotIssuedWith(t *testing.T) {
	e := newMailEnv(t, mailOpts{configure: true})
	setAuthSetting(t, e.db, "email_policy", "optional")
	registerUser(t, e.ts.URL, "bobby", e.owner)
	e.db.Exec(`UPDATE users SET email = 'bobby@example.org', email_norm = 'bobby@example.org', email_verified_at = 't' WHERE username = 'bobby'`)
	secret, _ := e.enrolTOTP(t, login(t, e.ts.URL, "bobby"), "secret-pass-bobby")
	e.clk.advance(30 * time.Second)
	_, body := e.loginAs(t, "bobby") // totp only: email method off
	if hasMethod(body, "email") {
		t.Fatal(body)
	}
	chal := body["challenge"].(string)
	e.db.Exec(`UPDATE users SET mfa_email = 1`) // switched on AFTER the challenge was issued
	if r := doJSON(t, "POST", e.ts.URL, "/api/auth/login/mfa/email", "", map[string]any{"challenge": chal}); r.StatusCode != 409 {
		t.Errorf("mfa/email = %d", r.StatusCode)
	}
	if st, _ := e.mfaStep(t, chal, "email", "000000"); st != 409 {
		t.Errorf("method email = %d", st)
	}
	if st, ok := e.mfaStep(t, chal, "totp", e.code(secret, 0)); st != 200 || ok["status"] != "ok" {
		t.Errorf("totp = %d %v", st, ok)
	}
}

// Fix 3: enabling the email method.
func TestEnrolmentSessionIsPromotedOnlyAfterAnEmailCodeIsVerified(t *testing.T) {
	e := newMailEnv(t, mailOpts{configure: true})
	setAuthSetting(t, e.db, "email_policy", "optional")
	registerUser(t, e.ts.URL, "bobby", e.owner)
	e.db.Exec(`UPDATE users SET email = 'bobby@example.org', email_norm = 'bobby@example.org', email_verified_at = 't' WHERE username = 'bobby'`)
	setAuthSetting(t, e.db, "mfa_enforced", "1")
	_, body := e.loginAs(t, "bobby") // verified address + enforced: email challenge, not enrolment
	if body["status"] != "mfa_required" {
		t.Fatal(body)
	}
	// make an enrolment session by hand (as after a stale-address login)
	e.db.Exec(`UPDATE users SET email = NULL, email_norm = NULL, email_verified_at = NULL WHERE username = 'bobby'`)
	_, en := e.loginAs(t, "bobby")
	tok := en["token"].(string)
	e.db.Exec(`UPDATE users SET email = 'bobby@example.org', email_norm = 'bobby@example.org', email_verified_at = 't' WHERE username = 'bobby'`)
	r := doJSON(t, "POST", e.ts.URL, "/api/account/mfa/email", tok, map[string]any{"enabled": true})
	if r.StatusCode != 202 {
		var eb errBody
		decodeJSON(t, r, &eb)
		t.Fatalf("enable = %d %s", r.StatusCode, eb.Error)
	}
	if r := doJSON(t, "GET", e.ts.URL, "/api/workspaces", tok, nil); r.StatusCode != 403 {
		t.Fatalf("promoted on enable: %d", r.StatusCode)
	}
	code := codeIn(t, e.waitMails(t, 1)[0])
	if r := doJSON(t, "POST", e.ts.URL, "/api/account/mfa/email/confirm", tok, map[string]any{"code": "000000"}); r.StatusCode != 403 {
		t.Errorf("wrong code = %d", r.StatusCode)
	}
	if r := doJSON(t, "GET", e.ts.URL, "/api/workspaces", tok, nil); r.StatusCode != 403 {
		t.Fatal("promoted by a wrong code")
	}
	if r := doJSON(t, "POST", e.ts.URL, "/api/account/mfa/email/confirm", tok, map[string]any{"code": code}); r.StatusCode != 200 {
		t.Fatalf("confirm = %d", r.StatusCode)
	}
	if r := doJSON(t, "GET", e.ts.URL, "/api/workspaces", tok, nil); r.StatusCode != 200 {
		t.Errorf("after confirm = %d", r.StatusCode)
	}
}

func TestEmailMethodRefusedWhenThePolicyIsOffEvenWithAStaleVerifiedAddress(t *testing.T) {
	e := newMailEnv(t, mailOpts{configure: true})
	registerUser(t, e.ts.URL, "bobby", e.owner)
	e.db.Exec(`UPDATE users SET email = 'bobby@example.org', email_norm = 'bobby@example.org', email_verified_at = 't' WHERE username = 'bobby'`)
	setAuthSetting(t, e.db, "mfa_enforced", "1")
	st, body := e.loginAs(t, "bobby") // policy off: the address is dormant -> enrolment session
	if body["status"] != "mfa_enrollment_required" {
		t.Fatalf("login = %d %v", st, body)
	}
	tok := body["token"].(string)
	var eb errBody
	r := doJSON(t, "POST", e.ts.URL, "/api/account/mfa/email", tok, map[string]any{"enabled": true})
	decodeJSON(t, r, &eb)
	if r.StatusCode != 409 {
		t.Fatalf("enable with policy off = %d %s", r.StatusCode, eb.Error)
	}
	if r := doJSON(t, "GET", e.ts.URL, "/api/workspaces", tok, nil); r.StatusCode != 403 {
		t.Errorf("session was promoted: %d", r.StatusCode)
	}
	var flag int
	e.db.QueryRow(`SELECT mfa_email FROM users WHERE username = 'bobby'`).Scan(&flag)
	if flag != 0 {
		t.Error("the flag was set")
	}
}

// Fix 4: wrong sign-in codes must not drain the user's own second-step budget.
func TestEmailLoginGuessesDoNotLockTheRealUserOut(t *testing.T) {
	e, _, secret := waveEnv(t)
	setAuthSetting(t, e.db, "email_code_login", "1")
	for i := 0; i < 4; i++ {
		_, start := e.emailStart(t, "bobby")
		for j := 0; j < 4; j++ {
			e.emailVerify(t, start["challenge"].(string), "000000")
		}
	}
	_, body := e.loginAs(t, "bobby")
	st, ok := e.mfaStep(t, body["challenge"].(string), "totp", e.code(secret, 0))
	if st != 200 || ok["status"] != "ok" {
		t.Fatalf("the real user was locked out: %d %v", st, ok)
	}
}

// Fix 5.
func TestEmailCodeSignInForAnEmailOnlyUserNeedsThePassword(t *testing.T) {
	e := newMailEnv(t, mailOpts{configure: true})
	setAuthSetting(t, e.db, "email_policy", "optional")
	setAuthSetting(t, e.db, "email_code_login", "1")
	registerUser(t, e.ts.URL, "bobby", e.owner)
	e.db.Exec(`UPDATE users SET email = 'bobby@example.org', email_norm = 'bobby@example.org', email_verified_at = 't', mfa_email = 1 WHERE username = 'bobby'`)
	_, start := e.emailStart(t, "bobby")
	m := e.waitMails(t, 1)[0]
	st, body := e.emailVerify(t, start["challenge"].(string), codeIn(t, m))
	if st != 403 || body["error"] != "password_login_required" || body["token"] != nil {
		t.Fatalf("verify = %d %v", st, body)
	}
}

// Fix 6: fail closed.
func TestEmailOnlySecondStepFailsClosedWithoutMail(t *testing.T) {
	e := newMailEnv(t, mailOpts{configure: true})
	setAuthSetting(t, e.db, "email_policy", "optional")
	registerUser(t, e.ts.URL, "bobby", e.owner)
	registerUser(t, e.ts.URL, "carol", e.owner)
	e.db.Exec(`UPDATE users SET email = 'bobby@example.org', email_norm = 'bobby@example.org', email_verified_at = 't', mfa_email = 1 WHERE username = 'bobby'`)
	doJSON(t, "DELETE", e.ts.URL, "/api/admin/settings/smtp", e.owner, nil)
	before := e.sessionCount(t, "bobby")
	st, body := e.loginAs(t, "bobby")
	if st != 503 || body["error"] != "mail_outage" || body["token"] != nil {
		t.Fatalf("opted-in user without mail = %d %v", st, body)
	}
	if n := e.sessionCount(t, "bobby"); n != before {
		t.Error("a session was created")
	}
	if st, body := e.loginAs(t, "carol"); st != 200 || body["status"] != "ok" {
		t.Errorf("a user with no second factor is unaffected: %d %v", st, body)
	}
	// the admin sees the dependency
	var v struct {
		UsersDependOnMail int `json:"usersDependOnMail"`
	}
	decodeJSON(t, doJSON(t, "GET", e.ts.URL, "/api/admin/settings/smtp", e.owner, nil), &v)
	if v.UsersDependOnMail != 1 {
		t.Errorf("usersDependOnMail = %d", v.UsersDependOnMail)
	}
}

// Fix 7.
func TestChangingTheEmailNeedsTheAuthenticatorDropsResetLinksAndNotifiesTheOldAddress(t *testing.T) {
	e, bob, secret := waveEnv(t)
	issue := doJSON(t, "POST", e.ts.URL, "/api/admin/users/"+userIDOf(t, e, "bobby")+"/reset-link", e.owner, map[string]any{"currentPassword": "secret-pass-owner"})
	var link struct{ Path string }
	decodeJSON(t, issue, &link)
	tok := strings.TrimPrefix(link.Path, "/reset#t=")
	body := map[string]any{"email": "new@example.org", "currentPassword": "secret-pass-bobby"}
	var eb errBody
	r := doJSON(t, "PUT", e.ts.URL, "/api/account/email", bob, body)
	decodeJSON(t, r, &eb)
	if r.StatusCode != 403 || eb.Error != "code_invalid" {
		t.Fatalf("without a code = %d %s", r.StatusCode, eb.Error)
	}
	e.noMoreMails(t, 0)
	e.clk.advance(30 * time.Second)
	body["code"] = e.code(secret, 0)
	if r := doJSON(t, "PUT", e.ts.URL, "/api/account/email", bob, body); r.StatusCode != 200 {
		t.Fatalf("with a code = %d", r.StatusCode)
	}
	mails := e.waitMails(t, 2)
	var notice, verify bool
	for _, m := range mails {
		if m.To == "bobby@example.org" && strings.Contains(m.Body, "was changed") {
			notice = true
		}
		if m.To == "new@example.org" {
			verify = true
		}
	}
	if !notice || !verify {
		t.Errorf("mails = %+v", mails)
	}
	if r := doJSON(t, "POST", e.ts.URL, "/api/auth/reset/check", "", map[string]any{"token": tok}); r.StatusCode != 400 {
		t.Errorf("the pending reset link survived: %d", r.StatusCode)
	}
}

// Fix 8 (handler half): one client cannot trigger unlimited mail.
func TestMailTriggeringRequestsHaveAPerClientCap(t *testing.T) {
	e := emailLoginEnv(t)
	var last int
	for i := 0; i < 14; i++ {
		got := rawPost(t, e.ts.URL, "/api/auth/reset-request", map[string]any{"login": "user-" + string(rune('a'+i))})
		last = got.status
	}
	if last != 429 {
		t.Errorf("14th reset-request from one client = %d, want 429", last)
	}
}

// Fix 9.
func TestAnonymousResetRequestDoesNotRevokeAnAdminLink(t *testing.T) {
	e, _, _ := waveEnv(t)
	issue := doJSON(t, "POST", e.ts.URL, "/api/admin/users/"+userIDOf(t, e, "bobby")+"/reset-link", e.owner, map[string]any{"currentPassword": "secret-pass-owner"})
	var link struct{ Path string }
	decodeJSON(t, issue, &link)
	tok := strings.TrimPrefix(link.Path, "/reset#t=")
	rawPost(t, e.ts.URL, "/api/auth/reset-request", map[string]any{"login": "bobby"})
	e.waitMails(t, 1)
	if r := doJSON(t, "POST", e.ts.URL, "/api/auth/reset/check", "", map[string]any{"token": tok}); r.StatusCode != 200 {
		t.Fatalf("the admin's link was revoked by an anonymous request: %d", r.StatusCode)
	}
	// and a second self-service request replaces the first self-service link only
	rawPost(t, e.ts.URL, "/api/auth/reset-request", map[string]any{"login": "bobby"})
	e.waitMails(t, 2)
	if r := doJSON(t, "POST", e.ts.URL, "/api/auth/reset/check", "", map[string]any{"token": tok}); r.StatusCode != 200 {
		t.Errorf("admin link gone after the second request: %d", r.StatusCode)
	}
}
