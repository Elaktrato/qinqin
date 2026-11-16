package api_test

import (
	"strings"
	"testing"
	"time"

	"qinqin/internal/auth"
)

type setupResp struct {
	Secret     string `json:"secret"`
	OtpauthURI string `json:"otpauthUri"`
	ExpiresAt  string `json:"expiresAt"`
}

// enrolTOTP runs setup and confirm for token and returns the secret and codes.
func (e *mailEnv) enrolTOTP(t *testing.T, token, password string) (string, []string) {
	t.Helper()
	var s setupResp
	r := doJSON(t, "POST", e.ts.URL, "/api/account/mfa/totp/setup", token, map[string]any{"password": password})
	decodeJSON(t, r, &s)
	if r.StatusCode != 200 || s.Secret == "" {
		t.Fatalf("setup = %d", r.StatusCode)
	}
	code, _ := auth.TOTPCode(s.Secret, e.clk.now())
	var c struct {
		RecoveryCodes []string `json:"recoveryCodes"`
	}
	r = doJSON(t, "POST", e.ts.URL, "/api/account/mfa/totp/confirm", token, map[string]any{"code": code})
	decodeJSON(t, r, &c)
	if r.StatusCode != 200 || len(c.RecoveryCodes) != 10 {
		t.Fatalf("confirm = %d %v", r.StatusCode, c)
	}
	return s.Secret, c.RecoveryCodes
}

// code returns the TOTP code of secret at the server's clock plus d.
func (e *mailEnv) code(secret string, d time.Duration) string {
	c, _ := auth.TOTPCode(secret, e.clk.now().Add(d))
	return c
}

func TestTOTPSetupAndConfirm(t *testing.T) {
	e := newMailEnv(t, mailOpts{configure: true})
	bob := registerUser(t, e.ts.URL, "bobby", e.owner)
	// wrong password
	var eb errBody
	r := doJSON(t, "POST", e.ts.URL, "/api/account/mfa/totp/setup", bob, map[string]any{"password": "wrong-password-x"})
	decodeJSON(t, r, &eb)
	if r.StatusCode != 403 || eb.Error != "wrong_password" {
		t.Fatalf("wrong password = %d %s", r.StatusCode, eb.Error)
	}
	var s setupResp
	r = doJSON(t, "POST", e.ts.URL, "/api/account/mfa/totp/setup", bob, map[string]any{"password": "secret-pass-bobby"})
	decodeJSON(t, r, &s)
	if r.StatusCode != 200 || len(s.Secret) != 32 || r.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("setup = %d %+v", r.StatusCode, s)
	}
	for _, part := range []string{"otpauth://totp/", "secret=" + s.Secret, "issuer=qinqin", "algorithm=SHA1", "digits=6", "period=30", "bobby"} {
		if !strings.Contains(s.OtpauthURI, part) {
			t.Errorf("uri %q lacks %q", s.OtpauthURI, part)
		}
	}
	if !strings.Contains(s.OtpauthURI, "words.example.org") {
		t.Errorf("issuer lacks the site: %q", s.OtpauthURI)
	}
	// the secret is shown once: me never carries it
	me := readBody(t, doJSON(t, "GET", e.ts.URL, "/api/auth/me", bob, nil).Body)
	if strings.Contains(me, s.Secret) || !strings.Contains(me, `"mfa":{"totp":false,"email":false,"recoveryCodesLeft":0}`) {
		t.Errorf("me = %s", me)
	}
	// a wrong confirm code is 403 code_invalid
	r = doJSON(t, "POST", e.ts.URL, "/api/account/mfa/totp/confirm", bob, map[string]any{"code": "000000"})
	decodeJSON(t, r, &eb)
	if r.StatusCode != 403 || eb.Error != "code_invalid" {
		t.Fatalf("wrong confirm = %d %s", r.StatusCode, eb.Error)
	}
	code, _ := auth.TOTPCode(s.Secret, e.clk.now())
	var c struct{ RecoveryCodes []string }
	r = doJSON(t, "POST", e.ts.URL, "/api/account/mfa/totp/confirm", bob, map[string]any{"code": code})
	decodeJSON(t, r, &c)
	if r.StatusCode != 200 || len(c.RecoveryCodes) != 10 {
		t.Fatalf("confirm = %d", r.StatusCode)
	}
	me = readBody(t, doJSON(t, "GET", e.ts.URL, "/api/auth/me", bob, nil).Body)
	if !strings.Contains(me, `"totp":true`) || !strings.Contains(me, `"recoveryCodesLeft":10`) || strings.Contains(me, c.RecoveryCodes[0]) {
		t.Errorf("me after = %s", me)
	}
	// audit
	var n int
	e.db.QueryRow(`SELECT COUNT(*) FROM auth_audit WHERE action = 'mfa_enabled'`).Scan(&n)
	if n != 1 {
		t.Errorf("mfa_enabled rows = %d", n)
	}
	// a second setup needs a current code
	r = doJSON(t, "POST", e.ts.URL, "/api/account/mfa/totp/setup", bob, map[string]any{"password": "secret-pass-bobby"})
	decodeJSON(t, r, &eb)
	if r.StatusCode != 403 || eb.Error != "code_invalid" {
		t.Errorf("replacing without a code = %d %s", r.StatusCode, eb.Error)
	}
	e.clk.advance(30 * time.Second)
	r = doJSON(t, "POST", e.ts.URL, "/api/account/mfa/totp/setup", bob, map[string]any{"password": "secret-pass-bobby", "code": e.code(s.Secret, 0)})
	if r.StatusCode != 200 {
		t.Errorf("replacing with a code = %d", r.StatusCode)
	}
}

func TestTOTPDisableRegenerateAndRecovery(t *testing.T) {
	e := newMailEnv(t, mailOpts{configure: true})
	bob := registerUser(t, e.ts.URL, "bobby", e.owner)
	secret, codes := e.enrolTOTP(t, bob, "secret-pass-bobby")
	pw := "secret-pass-bobby"
	var eb errBody
	// a wrong code on disable and regenerate is 403 code_invalid, never 401
	e.clk.advance(30 * time.Second)
	for _, c := range []struct{ method, path string }{{"DELETE", "/api/account/mfa/totp"}, {"POST", "/api/account/mfa/recovery-codes"}} {
		r := doJSON(t, c.method, e.ts.URL, c.path, bob, map[string]any{"password": pw, "code": "000000"})
		decodeJSON(t, r, &eb)
		if r.StatusCode != 403 || eb.Error != "code_invalid" {
			t.Errorf("%s wrong code = %d %s", c.path, r.StatusCode, eb.Error)
		}
		r = doJSON(t, c.method, e.ts.URL, c.path, bob, map[string]any{"password": "wrong-password-x", "code": e.code(secret, 0)})
		decodeJSON(t, r, &eb)
		if r.StatusCode != 403 || eb.Error != "wrong_password" {
			t.Errorf("%s wrong password = %d %s", c.path, r.StatusCode, eb.Error)
		}
	}
	// regenerate with a recovery code as the second factor; the old set is dead
	var fresh struct{ RecoveryCodes []string }
	r := doJSON(t, "POST", e.ts.URL, "/api/account/mfa/recovery-codes", bob, map[string]any{"password": pw, "code": codes[0]})
	decodeJSON(t, r, &fresh)
	if r.StatusCode != 200 || len(fresh.RecoveryCodes) != 10 {
		t.Fatalf("regenerate = %d", r.StatusCode)
	}
	r = doJSON(t, "DELETE", e.ts.URL, "/api/account/mfa/totp", bob, map[string]any{"password": pw, "code": codes[1]})
	if r.StatusCode != 403 {
		t.Errorf("an old recovery code worked: %d", r.StatusCode)
	}
	// disable with the TOTP code
	e.clk.advance(30 * time.Second)
	r = doJSON(t, "DELETE", e.ts.URL, "/api/account/mfa/totp", bob, map[string]any{"password": pw, "code": e.code(secret, 0)})
	if r.StatusCode != 204 {
		t.Fatalf("disable = %d", r.StatusCode)
	}
	var n int
	e.db.QueryRow(`SELECT COUNT(*) FROM mfa_totp`).Scan(&n)
	var m int
	e.db.QueryRow(`SELECT COUNT(*) FROM mfa_recovery_codes`).Scan(&m)
	if n != 0 || m != 0 {
		t.Errorf("rows left: totp=%d recovery=%d", n, m)
	}
	e.db.QueryRow(`SELECT COUNT(*) FROM auth_audit WHERE action = 'mfa_disabled'`).Scan(&n)
	if n != 1 {
		t.Errorf("mfa_disabled rows = %d", n)
	}
}

func TestMFAWrongCodesAreBudgetedPerUser(t *testing.T) {
	e := newMailEnv(t, mailOpts{configure: true})
	bob := registerUser(t, e.ts.URL, "bobby", e.owner)
	e.enrolTOTP(t, bob, "secret-pass-bobby")
	var last int
	for i := 0; i < 12; i++ {
		r := doJSON(t, "POST", e.ts.URL, "/api/account/mfa/recovery-codes", bob, map[string]any{"password": "secret-pass-bobby", "code": "000000"})
		last = r.StatusCode
	}
	if last != 429 {
		t.Errorf("12th wrong code = %d, want 429", last)
	}
}

func TestMFAEmailMethod(t *testing.T) {
	e := newMailEnv(t, mailOpts{configure: true})
	setAuthSetting(t, e.db, "email_policy", "optional")
	bob := registerUser(t, e.ts.URL, "bobby", e.owner)
	pw := "secret-pass-bobby"
	var eb errBody
	r := doJSON(t, "POST", e.ts.URL, "/api/account/mfa/email", bob, map[string]any{"enabled": true, "password": pw})
	decodeJSON(t, r, &eb)
	if r.StatusCode != 409 || eb.Error != "email_unverified" {
		t.Fatalf("without a verified address = %d %s", r.StatusCode, eb.Error)
	}
	e.db.Exec(`UPDATE users SET email = 'b@example.org', email_norm = 'b@example.org', email_verified_at = 't' WHERE username = 'bobby'`)
	r = doJSON(t, "POST", e.ts.URL, "/api/account/mfa/email", bob, map[string]any{"enabled": true, "password": "wrong-password-x"})
	decodeJSON(t, r, &eb)
	if r.StatusCode != 403 || eb.Error != "wrong_password" {
		t.Fatalf("wrong password = %d %s", r.StatusCode, eb.Error)
	}
	if r := doJSON(t, "POST", e.ts.URL, "/api/account/mfa/email", bob, map[string]any{"enabled": true, "password": pw}); r.StatusCode != 200 {
		t.Fatalf("enable = %d", r.StatusCode)
	}
	me := readBody(t, doJSON(t, "GET", e.ts.URL, "/api/auth/me", bob, nil).Body)
	if !strings.Contains(me, `"email":true`) {
		t.Errorf("me = %s", me)
	}
	// enforcement: the only method cannot be switched off
	setAuthSetting(t, e.db, "mfa_enforced", "1")
	r = doJSON(t, "POST", e.ts.URL, "/api/account/mfa/email", bob, map[string]any{"enabled": false, "password": pw})
	decodeJSON(t, r, &eb)
	if r.StatusCode != 409 || eb.Error != "mfa_required" {
		t.Errorf("disable under enforcement = %d %s", r.StatusCode, eb.Error)
	}
}

func TestMFAEnrolmentSessionBecomesFull(t *testing.T) {
	e := newMailEnv(t, mailOpts{configure: true})
	bob := registerUser(t, e.ts.URL, "bobby", e.owner)
	e.db.Exec(`UPDATE sessions SET level = 'enroll' WHERE user_id = (SELECT id FROM users WHERE username = 'bobby')`)
	var eb errBody
	r := doJSON(t, "GET", e.ts.URL, "/api/workspaces", bob, nil)
	decodeJSON(t, r, &eb)
	if r.StatusCode != 403 || eb.Error != "mfa_enrollment_required" {
		t.Fatalf("workspaces in an enrolment session = %d %s", r.StatusCode, eb.Error)
	}
	// no password asked in an enrolment session
	var s setupResp
	r = doJSON(t, "POST", e.ts.URL, "/api/account/mfa/totp/setup", bob, map[string]any{})
	decodeJSON(t, r, &s)
	if r.StatusCode != 200 {
		t.Fatalf("setup = %d", r.StatusCode)
	}
	// the restricted routes stay closed: disable, regenerate, password
	for _, c := range [][2]string{{"DELETE", "/api/account/mfa/totp"}, {"POST", "/api/account/mfa/recovery-codes"}} {
		r := doJSON(t, c[0], e.ts.URL, c[1], bob, map[string]any{})
		decodeJSON(t, r, &eb)
		if r.StatusCode != 403 || eb.Error != "mfa_enrollment_required" {
			t.Errorf("%s %s in an enrolment session = %d %s", c[0], c[1], r.StatusCode, eb.Error)
		}
	}
	code, _ := auth.TOTPCode(s.Secret, e.clk.now())
	if r := doJSON(t, "POST", e.ts.URL, "/api/account/mfa/totp/confirm", bob, map[string]any{"code": code}); r.StatusCode != 200 {
		t.Fatalf("confirm = %d", r.StatusCode)
	}
	if r := doJSON(t, "GET", e.ts.URL, "/api/workspaces", bob, nil); r.StatusCode != 200 {
		t.Errorf("same token after confirm = %d, want 200", r.StatusCode)
	}
}

func TestMFAWithoutSecretIsUnavailable(t *testing.T) {
	e := newMailEnv(t, mailOpts{noSecret: true, smtp: smtpNoAuth()})
	bob := registerUser(t, e.ts.URL, "bobby", e.owner)
	var eb errBody
	r := doJSON(t, "POST", e.ts.URL, "/api/account/mfa/totp/setup", bob, map[string]any{"password": "secret-pass-bobby"})
	decodeJSON(t, r, &eb)
	if r.StatusCode != 409 || eb.Error != "secret_unavailable" {
		t.Fatalf("= %d %s", r.StatusCode, eb.Error)
	}
	var o struct {
		TotpAvailable bool `json:"totpAvailable"`
	}
	decodeJSON(t, doJSON(t, "GET", e.ts.URL, "/api/auth/options", "", nil), &o)
	if o.TotpAvailable {
		t.Error("options claim TOTP is available")
	}
}

func TestMFARoutesRefusePasswordChangeSessionsAndAnonymous(t *testing.T) {
	e := newMailEnv(t, mailOpts{configure: true})
	bob := registerUser(t, e.ts.URL, "bobby", e.owner)
	e.db.Exec(`UPDATE users SET must_change_password = 1 WHERE username = 'bobby'`)
	for _, c := range [][2]string{{"POST", "/api/account/mfa/totp/setup"}, {"POST", "/api/account/mfa/totp/confirm"}, {"DELETE", "/api/account/mfa/totp"},
		{"POST", "/api/account/mfa/recovery-codes"}, {"POST", "/api/account/mfa/email"}} {
		var eb errBody
		r := doJSON(t, c[0], e.ts.URL, c[1], bob, map[string]any{})
		decodeJSON(t, r, &eb)
		if r.StatusCode != 403 || eb.Error != "password_change_required" {
			t.Errorf("%s %s with PwC = %d %s", c[0], c[1], r.StatusCode, eb.Error)
		}
		if r := doJSON(t, c[0], e.ts.URL, c[1], "", map[string]any{}); r.StatusCode != 401 {
			t.Errorf("%s %s anonymous = %d", c[0], c[1], r.StatusCode)
		}
	}
}

func TestAdminUserListShowsWhichFactorsNotSecrets(t *testing.T) {
	e := newMailEnv(t, mailOpts{configure: true})
	bob := registerUser(t, e.ts.URL, "bobby", e.owner)
	secret, codes := e.enrolTOTP(t, bob, "secret-pass-bobby")
	body := readBody(t, doJSON(t, "GET", e.ts.URL, "/api/admin/users", e.owner, nil).Body)
	if !strings.Contains(body, `"mfa":{"totp":true,"email":false}`) || strings.Contains(body, secret) || strings.Contains(body, codes[0]) {
		t.Errorf("admin list = %s", body)
	}
}

func TestAdminResetsAUsersTwoFactor(t *testing.T) {
	e := newMailEnv(t, mailOpts{configure: true})
	bob := registerUser(t, e.ts.URL, "bobby", e.owner)
	secret, _ := e.enrolTOTP(t, bob, "secret-pass-bobby")
	e.db.Exec(`UPDATE users SET mfa_email = 1 WHERE username = 'bobby'`)
	id := userIDOf(t, e, "bobby")
	path := "/api/admin/users/" + id + "/mfa/reset"
	// the admin's own password is needed; a user is refused
	var eb errBody
	r := doJSON(t, "POST", e.ts.URL, path, e.owner, map[string]any{})
	decodeJSON(t, r, &eb)
	if r.StatusCode != 422 || eb.Error != "password_required" {
		t.Fatalf("without a password = %d %s", r.StatusCode, eb.Error)
	}
	if r := doJSON(t, "POST", e.ts.URL, path, e.owner, map[string]any{"currentPassword": "wrong-password-x"}); r.StatusCode != 403 {
		t.Fatalf("wrong password = %d", r.StatusCode)
	}
	if r := doJSON(t, "POST", e.ts.URL, path, bob, map[string]any{"currentPassword": "secret-pass-bobby"}); r.StatusCode != 403 {
		t.Fatalf("as a user = %d", r.StatusCode)
	}
	if r := doJSON(t, "POST", e.ts.URL, path, "", map[string]any{}); r.StatusCode != 403 {
		t.Fatalf("anonymous = %d", r.StatusCode)
	}
	// self is refused
	if r := doJSON(t, "POST", e.ts.URL, "/api/admin/users/"+userIDOf(t, e, "owner")+"/mfa/reset", e.owner, map[string]any{"currentPassword": "secret-pass-owner"}); r.StatusCode != 409 {
		t.Fatalf("self = %d", r.StatusCode)
	}
	if r := doJSON(t, "POST", e.ts.URL, path, e.owner, map[string]any{"currentPassword": "secret-pass-owner"}); r.StatusCode != 204 {
		t.Fatalf("reset = %d", r.StatusCode)
	}
	var totp, codes, flag int
	e.db.QueryRow(`SELECT COUNT(*) FROM mfa_totp`).Scan(&totp)
	e.db.QueryRow(`SELECT COUNT(*) FROM mfa_recovery_codes`).Scan(&codes)
	e.db.QueryRow(`SELECT mfa_email FROM users WHERE username = 'bobby'`).Scan(&flag)
	if totp != 0 || codes != 0 || flag != 0 || e.sessionCount(t, "bobby") != 0 {
		t.Errorf("after reset: totp=%d codes=%d mfa_email=%d sessions=%d", totp, codes, flag, e.sessionCount(t, "bobby"))
	}
	var n int
	e.db.QueryRow(`SELECT COUNT(*) FROM auth_audit WHERE action = 'mfa_reset'`).Scan(&n)
	if n != 1 {
		t.Errorf("audit rows = %d", n)
	}
	// the old token and the old secret are worthless; a plain password login works
	if r := doJSON(t, "GET", e.ts.URL, "/api/auth/me", bob, nil); r.StatusCode != 401 {
		t.Errorf("old session = %d", r.StatusCode)
	}
	if st, body := e.loginAs(t, "bobby"); st != 200 || body["status"] != "ok" {
		t.Errorf("login after reset = %d %v", st, body)
	}
	_ = secret
	if r := doJSON(t, "POST", e.ts.URL, "/api/admin/users/9999/mfa/reset", e.owner, map[string]any{"currentPassword": "secret-pass-owner"}); r.StatusCode != 404 {
		t.Errorf("unknown user = %d", r.StatusCode)
	}
}

func TestAdminMFAResetAsksAnAdminWithTwoFactorForTheCode(t *testing.T) {
	e := newMailEnv(t, mailOpts{configure: true})
	bob := registerUser(t, e.ts.URL, "bobby", e.owner)
	e.enrolTOTP(t, bob, "secret-pass-bobby")
	secret, _ := e.enrolTOTP(t, e.owner, "secret-pass-owner")
	e.clk.advance(31 * time.Second) // the enrolment's code is spent for its step
	path := "/api/admin/users/" + userIDOf(t, e, "bobby") + "/mfa/reset"
	bobHasTOTP := func() bool {
		var n int
		e.db.QueryRow(`SELECT COUNT(*) FROM mfa_totp t JOIN users u ON u.id = t.user_id WHERE u.username = 'bobby'`).Scan(&n)
		return n == 1
	}
	var eb errBody
	r := doJSON(t, "POST", e.ts.URL, path, e.owner, map[string]any{"currentPassword": "secret-pass-owner"})
	decodeJSON(t, r, &eb)
	if r.StatusCode != 403 || eb.Error != "code_invalid" || !bobHasTOTP() {
		t.Fatalf("without a code = %d %+v (bob keeps totp: %v)", r.StatusCode, eb, bobHasTOTP())
	}
	r = doJSON(t, "POST", e.ts.URL, path, e.owner, map[string]any{"currentPassword": "secret-pass-owner", "code": "000000"})
	decodeJSON(t, r, &eb)
	if r.StatusCode != 403 || eb.Error != "code_invalid" || !bobHasTOTP() {
		t.Fatalf("wrong code = %d %+v", r.StatusCode, eb)
	}
	// the code does not replace the password
	r = doJSON(t, "POST", e.ts.URL, path, e.owner, map[string]any{"currentPassword": "wrong-password-x", "code": e.code(secret, 0)})
	decodeJSON(t, r, &eb)
	if r.StatusCode != 403 || eb.Error != "wrong_password" || !bobHasTOTP() {
		t.Fatalf("wrong password with a right code = %d %+v", r.StatusCode, eb)
	}
	if r := doJSON(t, "POST", e.ts.URL, path, e.owner, map[string]any{"currentPassword": "secret-pass-owner", "code": e.code(secret, 0)}); r.StatusCode != 204 {
		t.Fatalf("with the right code = %d", r.StatusCode)
	}
	if bobHasTOTP() || e.sessionCount(t, "bobby") != 0 {
		t.Errorf("after reset: totp %v, sessions %d", bobHasTOTP(), e.sessionCount(t, "bobby"))
	}
}

func totpAt(secret string, at time.Time) (string, error) { return auth.TOTPCode(secret, at) }

// The reset leaves no trace of a second step: a pending (unconfirmed)
// authenticator setup, an open second-step challenge, personal access
// tokens, and it answers for oneself before any password is looked at.
func TestAdminMFAResetRemovesPendingSetupChallengesAndTokens(t *testing.T) {
	e := newMailEnv(t, mailOpts{configure: true})
	setAuthSetting(t, e.db, "email_policy", "optional")
	bob := registerUser(t, e.ts.URL, "bobby", e.owner)
	var tk struct {
		Token string `json:"token"`
	}
	r := doJSON(t, "POST", e.ts.URL, "/api/account/tokens", bob, map[string]any{"name": "phone", "scope": "read", "expiresInDays": 30, "currentPassword": "secret-pass-bobby"})
	decodeJSON(t, r, &tk)
	if r.StatusCode != 201 || tk.Token == "" {
		t.Fatalf("create token = %d", r.StatusCode)
	}
	if r := doJSON(t, "GET", e.ts.URL, "/api/workspaces", tk.Token, nil); r.StatusCode != 200 {
		t.Fatalf("token before reset = %d", r.StatusCode)
	}
	// emailed codes as the second step, and an authenticator setup begun but not confirmed
	e.db.Exec(`UPDATE users SET email = 'bobby@example.org', email_norm = 'bobby@example.org', email_verified_at = 't', mfa_email = 1 WHERE username = 'bobby'`)
	if r := doJSON(t, "POST", e.ts.URL, "/api/account/mfa/totp/setup", bob, map[string]any{"password": "secret-pass-bobby"}); r.StatusCode != 200 {
		t.Fatalf("setup = %d", r.StatusCode)
	}
	if st, body := e.loginAs(t, "bobby"); st != 200 || body["status"] != "mfa_required" {
		t.Fatalf("login = %d %v", st, body)
	}
	count := func(q string) int {
		var n int
		e.db.QueryRow(q).Scan(&n)
		return n
	}
	const pending = `SELECT COUNT(*) FROM mfa_totp WHERE user_id = (SELECT id FROM users WHERE username = 'bobby')`
	const challenges = `SELECT COUNT(*) FROM auth_challenges WHERE kind = 'mfa' AND user_id = (SELECT id FROM users WHERE username = 'bobby')`
	if count(pending) != 1 || count(challenges) == 0 {
		t.Fatalf("before: setup rows %d, challenges %d", count(pending), count(challenges))
	}
	// one's own id is refused before the password is checked
	var eb errBody
	r = doJSON(t, "POST", e.ts.URL, "/api/admin/users/"+userIDOf(t, e, "owner")+"/mfa/reset", e.owner, map[string]any{"currentPassword": "wrong-password-x"})
	decodeJSON(t, r, &eb)
	if r.StatusCode != 409 || eb.Error != "self_target" {
		t.Errorf("self with a wrong password = %d %q, want 409 self_target", r.StatusCode, eb.Error)
	}
	if r := doJSON(t, "POST", e.ts.URL, "/api/admin/users/"+userIDOf(t, e, "bobby")+"/mfa/reset", e.owner, map[string]any{"currentPassword": "secret-pass-owner"}); r.StatusCode != 204 {
		t.Fatalf("reset = %d", r.StatusCode)
	}
	if count(pending) != 0 || count(challenges) != 0 {
		t.Errorf("after: setup rows %d, challenges %d", count(pending), count(challenges))
	}
	if r := doJSON(t, "GET", e.ts.URL, "/api/workspaces", tk.Token, nil); r.StatusCode != 401 {
		t.Errorf("token after reset = %d, want 401", r.StatusCode)
	}
	// the audit row says how much was revoked (counts only, never a secret)
	var detail string
	e.db.QueryRow(`SELECT detail FROM auth_audit WHERE action = 'mfa_reset'`).Scan(&detail)
	if detail != `{"revoked":1,"tokens":1}` {
		t.Errorf("audit detail = %s", detail)
	}
}
