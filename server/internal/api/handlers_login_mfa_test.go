package api_test

import (
	"strings"
	"testing"
	"time"
)

func (e *mailEnv) sessionCount(t *testing.T, user string) int {
	t.Helper()
	var n int
	e.db.QueryRow(`SELECT COUNT(*) FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ?)`, user).Scan(&n)
	return n
}

func (e *mailEnv) loginAs(t *testing.T, user string) (int, map[string]any) {
	t.Helper()
	return loginRaw(t, e.ts.URL, user, "secret-pass-"+user)
}

func (e *mailEnv) mfaStep(t *testing.T, challenge, method, code string) (int, map[string]any) {
	t.Helper()
	var out map[string]any
	r := doJSON(t, "POST", e.ts.URL, "/api/auth/login/mfa", "", map[string]any{"challenge": challenge, "method": method, "code": code})
	decodeJSON(t, r, &out)
	return r.StatusCode, out
}

// totpUser registers bob with an authenticator; the clock is then moved one
// step on so the next code is fresh.
func (e *mailEnv) totpUser(t *testing.T) (secret string, recovery []string) {
	t.Helper()
	bob := registerUser(t, e.ts.URL, "bobby", e.owner)
	secret, recovery = e.enrolTOTP(t, bob, "secret-pass-bobby")
	e.clk.advance(30 * time.Second)
	return
}

func TestLoginWithTOTPNeedsTheSecondStepAndCreatesNoSessionBeforeIt(t *testing.T) {
	e := newMailEnv(t, mailOpts{configure: true})
	secret, _ := e.totpUser(t)
	before := e.sessionCount(t, "bobby")
	st, body := e.loginAs(t, "bobby")
	if st != 200 || body["status"] != "mfa_required" || body["token"] != nil || body["challenge"] == "" {
		t.Fatalf("login = %d %v", st, body)
	}
	if got := e.sessionCount(t, "bobby"); got != before {
		t.Fatalf("a session row was created before the second step (%d -> %d)", before, got)
	}
	methods := body["methods"].([]any)
	if len(methods) != 2 || methods[0] != "totp" || methods[1] != "recovery" || body["emailHint"] != nil || body["expiresAt"] == nil {
		t.Errorf("body = %v", body)
	}
	chal := body["challenge"].(string)
	// the right code finishes it
	st, ok := e.mfaStep(t, chal, "totp", e.code(secret, 0))
	if st != 200 || ok["status"] != "ok" || ok["token"] == "" {
		t.Fatalf("second step = %d %v", st, ok)
	}
	if r := doJSON(t, "GET", e.ts.URL, "/api/workspaces", ok["token"].(string), nil); r.StatusCode != 200 {
		t.Errorf("token does not work: %d", r.StatusCode)
	}
	// the challenge is single use, and the same code is a replay
	if st, _ := e.mfaStep(t, chal, "totp", e.code(secret, 0)); st != 401 {
		t.Errorf("reused challenge = %d", st)
	}
	_, again := e.loginAs(t, "bobby")
	if st, _ := e.mfaStep(t, again["challenge"].(string), "totp", e.code(secret, 0)); st != 401 {
		t.Errorf("replayed code = %d, want 401", st)
	}
}

func TestSecondStepWrongCodesCountAndEndTheChallenge(t *testing.T) {
	e := newMailEnv(t, mailOpts{configure: true})
	secret, _ := e.totpUser(t)
	_, body := e.loginAs(t, "bobby")
	chal := body["challenge"].(string)
	for i := 1; i <= 4; i++ {
		st, er := e.mfaStep(t, chal, "totp", "000000")
		if st != 401 || er["error"] != "code_invalid" || int(er["attemptsLeft"].(float64)) != 5-i {
			t.Fatalf("attempt %d = %d %v", i, st, er)
		}
	}
	st, er := e.mfaStep(t, chal, "totp", "000000")
	if st != 401 || er["error"] != "challenge_expired" {
		t.Fatalf("fifth = %d %v", st, er)
	}
	// even the right code is refused now; a new login starts over
	if st, _ := e.mfaStep(t, chal, "totp", e.code(secret, 0)); st != 401 {
		t.Errorf("right code after exhaustion = %d", st)
	}
	if e.sessionCount(t, "bobby") != 1 { // only the enrolment-time session
		t.Errorf("sessions = %d", e.sessionCount(t, "bobby"))
	}
	// unknown challenge: the same answer as an expired one
	if st, er := e.mfaStep(t, "nope", "totp", "000000"); st != 401 || er["error"] != "challenge_expired" {
		t.Errorf("unknown challenge = %d %v", st, er)
	}
	if st, _ := e.mfaStep(t, chal, "banana", "000000"); st != 400 {
		t.Errorf("unknown method = %d", st)
	}
}

func TestSecondStepBudgetSpansFreshChallenges(t *testing.T) {
	e := newMailEnv(t, mailOpts{configure: true})
	e.totpUser(t)
	got429 := false
	for i := 0; i < 12 && !got429; i++ {
		_, body := e.loginAs(t, "bobby")
		if body["challenge"] == nil {
			// the sign-in limiter itself may be hit: stop, the budget is tested via fresh challenges
			t.Fatalf("login %d: %v", i, body)
		}
		for j := 0; j < 3; j++ {
			if st, _ := e.mfaStep(t, body["challenge"].(string), "totp", "000000"); st == 429 {
				got429 = true
				break
			}
		}
	}
	if !got429 {
		t.Fatal("no 429 after many wrong codes across fresh challenges")
	}
}

func TestRecoveryCodeLogsInOnceAndIsAudited(t *testing.T) {
	e := newMailEnv(t, mailOpts{configure: true})
	_, recovery := e.totpUser(t)
	_, body := e.loginAs(t, "bobby")
	st, ok := e.mfaStep(t, body["challenge"].(string), "recovery", strings.ToLower(recovery[0]))
	if st != 200 || ok["status"] != "ok" {
		t.Fatalf("recovery = %d %v", st, ok)
	}
	var n int
	e.db.QueryRow(`SELECT COUNT(*) FROM auth_audit WHERE action = 'recovery_code_used'`).Scan(&n)
	if n != 1 {
		t.Errorf("audit rows = %d", n)
	}
	var detail string
	e.db.QueryRow(`SELECT detail FROM auth_audit WHERE action = 'recovery_code_used'`).Scan(&detail)
	for _, c := range recovery {
		if strings.Contains(detail, strings.ReplaceAll(c, "-", "")) {
			t.Error("the code is in the audit row")
		}
	}
	_, body = e.loginAs(t, "bobby")
	if st, _ := e.mfaStep(t, body["challenge"].(string), "recovery", recovery[0]); st != 401 {
		t.Errorf("second use = %d", st)
	}
}

func TestEmailMethodSecondStep(t *testing.T) {
	e := newMailEnv(t, mailOpts{configure: true})
	setAuthSetting(t, e.db, "email_policy", "optional")
	bob := registerUser(t, e.ts.URL, "bobby", e.owner)
	e.db.Exec(`UPDATE users SET email = 'bob@example.org', email_norm = 'bob@example.org', email_verified_at = 't' WHERE username = 'bobby'`)
	if r := doJSON(t, "POST", e.ts.URL, "/api/account/mfa/email", bob, map[string]any{"enabled": true, "password": "secret-pass-bobby"}); r.StatusCode != 200 {
		t.Fatal(r.StatusCode)
	}
	_, body := e.loginAs(t, "bobby")
	if body["status"] != "mfa_required" || body["emailHint"] != "b•••@e•••.org" {
		t.Fatalf("login = %v", body)
	}
	chal := body["challenge"].(string)
	if m := body["methods"].([]any); len(m) != 1 || m[0] != "email" {
		t.Fatalf("methods = %v", m)
	}
	e.noMoreMails(t, 0) // nothing is sent until the user asks
	r := doJSON(t, "POST", e.ts.URL, "/api/auth/login/mfa/email", "", map[string]any{"challenge": chal})
	if r.StatusCode != 202 {
		t.Fatalf("send = %d", r.StatusCode)
	}
	m := e.waitMails(t, 1)[0]
	if m.To != "bob@example.org" || strings.Contains(m.Subject, codeIn(t, m)) {
		t.Fatalf("mail = %+v", m)
	}
	if r := doJSON(t, "POST", e.ts.URL, "/api/auth/login/mfa/email", "", map[string]any{"challenge": chal}); r.StatusCode != 429 {
		t.Errorf("immediate resend = %d", r.StatusCode)
	}
	st, er := e.mfaStep(t, chal, "email", "000000")
	if st != 401 || er["error"] != "code_invalid" {
		t.Fatalf("wrong email code = %d %v", st, er)
	}
	st, ok := e.mfaStep(t, chal, "email", codeIn(t, m))
	if st != 200 || ok["status"] != "ok" {
		t.Fatalf("email code = %d %v", st, ok)
	}
}

func TestEnforcementWithAVerifiedEmailAsksForAnEmailCode(t *testing.T) {
	e := newMailEnv(t, mailOpts{configure: true})
	setAuthSetting(t, e.db, "email_policy", "optional")
	registerUser(t, e.ts.URL, "bobby", e.owner)
	e.db.Exec(`UPDATE users SET email = 'bob@example.org', email_norm = 'bob@example.org', email_verified_at = 't' WHERE username = 'bobby'`)
	setAuthSetting(t, e.db, "mfa_enforced", "1")
	_, body := e.loginAs(t, "bobby")
	if body["status"] != "mfa_required" || body["emailHint"] == nil {
		t.Fatalf("login = %v", body)
	}
	if m := body["methods"].([]any); len(m) != 1 || m[0] != "email" {
		t.Errorf("methods = %v", m)
	}
}

func TestEnforcementWithoutEmailGivesAnEnrolmentSession(t *testing.T) {
	e := newMailEnv(t, mailOpts{configure: true})
	setAuthSetting(t, e.db, "email_policy", "optional")
	registerUser(t, e.ts.URL, "bobby", e.owner)
	setAuthSetting(t, e.db, "mfa_enforced", "1")
	st, body := e.loginAs(t, "bobby")
	if st != 200 || body["status"] != "mfa_enrollment_required" || body["token"] == "" {
		t.Fatalf("login = %d %v", st, body)
	}
	if m := body["methods"].([]any); len(m) != 2 {
		t.Errorf("methods = %v", m)
	}
	tok := body["token"].(string)
	var eb errBody
	r := doJSON(t, "GET", e.ts.URL, "/api/workspaces", tok, nil)
	decodeJSON(t, r, &eb)
	if r.StatusCode != 403 || eb.Error != "mfa_enrollment_required" {
		t.Fatalf("workspaces = %d %s", r.StatusCode, eb.Error)
	}
	var me struct{ Restriction string }
	decodeJSON(t, doJSON(t, "GET", e.ts.URL, "/api/auth/me", tok, nil), &me)
	if me.Restriction != "mfa_enrollment" {
		t.Errorf("restriction = %q", me.Restriction)
	}
	// enrol: the same token now works
	e.enrolTOTP(t, tok, "")
	if r := doJSON(t, "GET", e.ts.URL, "/api/workspaces", tok, nil); r.StatusCode != 200 {
		t.Errorf("after enrolment = %d", r.StatusCode)
	}
}

func TestEnablingEnforcementLeavesLiveSessionsUnlessAsked(t *testing.T) {
	e := newMailEnv(t, mailOpts{configure: true})
	bob := registerUser(t, e.ts.URL, "bobby", e.owner)
	ownerTwo := login(t, e.ts.URL, "owner")
	if r := doJSON(t, "PATCH", e.ts.URL, "/api/admin/settings/auth", e.owner, map[string]any{"mfaEnforced": true}); r.StatusCode != 200 {
		t.Fatal(r.StatusCode)
	}
	if r := doJSON(t, "GET", e.ts.URL, "/api/workspaces", bob, nil); r.StatusCode != 200 {
		t.Errorf("a live session was cut: %d", r.StatusCode)
	}
	doJSON(t, "PATCH", e.ts.URL, "/api/admin/settings/auth", e.owner, map[string]any{"mfaEnforced": false})
	var v struct{ MFAEnforced, MFAEnforcedEffective bool }
	r := doJSON(t, "PATCH", e.ts.URL, "/api/admin/settings/auth", e.owner, map[string]any{"mfaEnforced": true, "signOutOthers": true})
	decodeJSON(t, r, &v)
	if r.StatusCode != 200 || !v.MFAEnforced || !v.MFAEnforcedEffective {
		t.Fatalf("patch = %d %+v", r.StatusCode, v)
	}
	if r := doJSON(t, "GET", e.ts.URL, "/api/workspaces", bob, nil); r.StatusCode != 401 {
		t.Errorf("another user's session survived: %d", r.StatusCode)
	}
	if r := doJSON(t, "GET", e.ts.URL, "/api/auth/me", ownerTwo, nil); r.StatusCode != 401 {
		t.Errorf("the admin's other session survived: %d", r.StatusCode)
	}
	if r := doJSON(t, "GET", e.ts.URL, "/api/auth/me", e.owner, nil); r.StatusCode != 200 {
		t.Errorf("the acting session was cut: %d", r.StatusCode)
	}
}

func TestMustChangeComesAfterTheSecondStep(t *testing.T) {
	e := newMailEnv(t, mailOpts{configure: true})
	secret, _ := e.totpUser(t)
	e.db.Exec(`UPDATE users SET must_change_password = 1, must_change_after = 0 WHERE username = 'bobby'`)
	_, body := e.loginAs(t, "bobby")
	if body["status"] != "mfa_required" || body["token"] != nil {
		t.Fatalf("login = %v", body)
	}
	st, ok := e.mfaStep(t, body["challenge"].(string), "totp", e.code(secret, 0))
	if st != 200 || ok["status"] != "password_change_required" || ok["token"] == "" {
		t.Fatalf("second step = %d %v", st, ok)
	}
}

func TestResetOfATOTPUserStillAsksForTheSecondStep(t *testing.T) {
	e := newMailEnv(t, mailOpts{configure: true})
	secret, _ := e.totpUser(t)
	var rl struct{ Path string }
	r := doJSON(t, "POST", e.ts.URL, "/api/admin/users/"+userIDOf(t, e, "bobby")+"/reset-link", e.owner, map[string]any{"currentPassword": "secret-pass-owner"})
	decodeJSON(t, r, &rl)
	token := strings.TrimPrefix(rl.Path, "/reset#t=")
	r = doJSON(t, "POST", e.ts.URL, "/api/auth/reset", "", map[string]any{"token": token, "password": "a-brand-new-password"})
	var body map[string]any
	decodeJSON(t, r, &body)
	if r.StatusCode != 200 || body["status"] != "mfa_required" || body["token"] != nil {
		t.Fatalf("reset = %d %v", r.StatusCode, body)
	}
	if got := e.sessionCount(t, "bobby"); got != 0 {
		t.Errorf("sessions after reset = %d (reset deletes them; none may be created)", got)
	}
	st, ok := e.mfaStep(t, body["challenge"].(string), "totp", e.code(secret, 0))
	if st != 200 || ok["status"] != "ok" {
		t.Fatalf("second step after reset = %d %v", st, ok)
	}
}

func userIDOf(t *testing.T, e *mailEnv, name string) string {
	t.Helper()
	var id string
	e.db.QueryRow(`SELECT CAST(id AS TEXT) FROM users WHERE username = ?`, name).Scan(&id)
	return id
}

func TestRemovingMailMakesEnforcementInactiveButTOTPStays(t *testing.T) {
	e := newMailEnv(t, mailOpts{configure: true})
	secret, _ := e.totpUser(t)
	registerUser(t, e.ts.URL, "carol", e.owner)
	doJSON(t, "PATCH", e.ts.URL, "/api/admin/settings/auth", e.owner, map[string]any{"mfaEnforced": true})
	doJSON(t, "DELETE", e.ts.URL, "/api/admin/settings/smtp", e.owner, nil)
	var v struct{ MFAEnforced, MFAEnforcedEffective bool }
	decodeJSON(t, doJSON(t, "GET", e.ts.URL, "/api/admin/settings/auth", e.owner, nil), &v)
	if !v.MFAEnforced || v.MFAEnforcedEffective {
		t.Errorf("settings = %+v", v)
	}
	st, body := e.loginAs(t, "carol")
	if st != 200 || body["status"] != "ok" {
		t.Errorf("carol without mail = %d %v", st, body)
	}
	_, body = e.loginAs(t, "bobby")
	if body["status"] != "mfa_required" {
		t.Fatalf("bobby = %v", body)
	}
	if st, ok := e.mfaStep(t, body["challenge"].(string), "totp", e.code(secret, 0)); st != 200 || ok["status"] != "ok" {
		t.Errorf("totp without mail = %d %v", st, ok)
	}
}

func TestDeleteAccountNeedsACodeForTOTPUsers(t *testing.T) {
	e := newMailEnv(t, mailOpts{configure: true})
	secret, _ := e.totpUser(t)
	_, body := e.loginAs(t, "bobby")
	_, ok := e.mfaStep(t, body["challenge"].(string), "totp", e.code(secret, 0))
	bob := ok["token"].(string)
	var eb errBody
	r := doJSON(t, "DELETE", e.ts.URL, "/api/account", bob, map[string]any{"password": "secret-pass-bobby", "confirm": "bobby"})
	decodeJSON(t, r, &eb)
	if r.StatusCode != 403 || eb.Error != "code_invalid" {
		t.Fatalf("without a code = %d %s", r.StatusCode, eb.Error)
	}
	e.clk.advance(30 * time.Second)
	r = doJSON(t, "DELETE", e.ts.URL, "/api/account", bob, map[string]any{"password": "secret-pass-bobby", "confirm": "bobby", "code": e.code(secret, 0)})
	if r.StatusCode != 204 {
		t.Fatalf("with a code = %d", r.StatusCode)
	}
	var n int
	e.db.QueryRow(`SELECT COUNT(*) FROM mfa_totp`).Scan(&n)
	if n != 0 {
		t.Error("totp row survived the deletion")
	}
}
