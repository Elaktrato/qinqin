package api_test

import (
	"sort"
	"strings"
	"testing"
	"time"
)

func emailLoginEnv(t *testing.T) *mailEnv {
	e := newMailEnv(t, mailOpts{configure: true})
	setAuthSetting(t, e.db, "email_policy", "optional")
	setAuthSetting(t, e.db, "email_code_login", "1")
	for _, n := range []string{"bobby", "davey"} {
		registerUser(t, e.ts.URL, n, e.owner)
		e.db.Exec(`UPDATE users SET email = ?, email_norm = ?, email_verified_at = 't' WHERE username = ?`, n+"@example.org", n+"@example.org", n)
	}
	e.db.Exec(`UPDATE users SET disabled_at = 't' WHERE username = 'davey'`)
	return e
}

func (e *mailEnv) emailStart(t *testing.T, login string) (int, map[string]any) {
	t.Helper()
	var out map[string]any
	r := doJSON(t, "POST", e.ts.URL, "/api/auth/email-login/start", "", map[string]any{"login": login})
	decodeJSON(t, r, &out)
	return r.StatusCode, out
}

func (e *mailEnv) emailVerify(t *testing.T, chal, code string) (int, map[string]any) {
	t.Helper()
	var out map[string]any
	r := doJSON(t, "POST", e.ts.URL, "/api/auth/email-login/verify", "", map[string]any{"challenge": chal, "code": code})
	decodeJSON(t, r, &out)
	return r.StatusCode, out
}

func keysOf(m map[string]any) string {
	var k []string
	for key := range m {
		k = append(k, key)
	}
	sort.Strings(k)
	return strings.Join(k, ",")
}

func TestEmailLoginStartLooksTheSameForEveryone(t *testing.T) {
	e := emailLoginEnv(t)
	var shape string
	for i, login := range []string{"bobby", "ghost", "davey", "bobby@example.org", "nobody@example.org"} {
		st, body := e.emailStart(t, login)
		if st != 202 || body["challenge"] == "" || body["resendAfter"].(float64) != 60 || body["expiresAt"] == nil {
			t.Fatalf("%s: %d %v", login, st, body)
		}
		if i == 0 {
			shape = keysOf(body)
		} else if keysOf(body) != shape {
			t.Errorf("%s: keys %s differ from %s", login, keysOf(body), shape)
		}
	}
	// mails: bobby by name and by address only (the disabled and unknown ones get none)
	mails := e.waitMails(t, 2)
	e.noMoreMails(t, 2)
	for _, m := range mails {
		if m.To != "bobby@example.org" {
			t.Errorf("mail to %s", m.To)
		}
	}
	// every start stored a challenge row, known or not
	var n int
	e.db.QueryRow(`SELECT COUNT(*) FROM auth_challenges WHERE kind = 'email_login'`).Scan(&n)
	if n != 5 {
		t.Errorf("challenge rows = %d, want 5", n)
	}
}

func TestEmailLoginHappyPath(t *testing.T) {
	e := emailLoginEnv(t)
	_, start := e.emailStart(t, "bobby")
	m := e.waitMails(t, 1)[0]
	if strings.Contains(m.Subject, codeIn(t, m)) {
		t.Error("code in the subject")
	}
	st, er := e.emailVerify(t, start["challenge"].(string), "000000")
	if st != 401 || er["error"] != "code_invalid" || er["attemptsLeft"].(float64) != 4 {
		t.Fatalf("wrong code = %d %v", st, er)
	}
	st, ok := e.emailVerify(t, start["challenge"].(string), codeIn(t, m))
	if st != 200 || ok["status"] != "ok" || ok["token"] == "" {
		t.Fatalf("verify = %d %v", st, ok)
	}
	if r := doJSON(t, "GET", e.ts.URL, "/api/workspaces", ok["token"].(string), nil); r.StatusCode != 200 {
		t.Errorf("session = %d", r.StatusCode)
	}
	if st, _ := e.emailVerify(t, start["challenge"].(string), codeIn(t, m)); st != 401 {
		t.Errorf("the code worked twice: %d", st)
	}
}

func TestEmailLoginForATOTPUserStillAsksForTOTP(t *testing.T) {
	e := emailLoginEnv(t)
	bob := login(t, e.ts.URL, "bobby")
	secret, _ := e.enrolTOTP(t, bob, "secret-pass-bobby")
	e.clk.advance(30 * time.Second)
	_, start := e.emailStart(t, "bobby")
	m := e.waitMails(t, 1)[0]
	before := e.sessionCount(t, "bobby")
	st, body := e.emailVerify(t, start["challenge"].(string), codeIn(t, m))
	if st != 200 || body["status"] != "mfa_required" || body["token"] != nil {
		t.Fatalf("verify = %d %v", st, body)
	}
	if e.sessionCount(t, "bobby") != before {
		t.Error("a session was created before the second step")
	}
	if ms := body["methods"].([]any); len(ms) != 2 || ms[0] != "totp" || ms[1] != "recovery" {
		t.Errorf("methods = %v (an emailed code must not stand in for the second factor)", ms)
	}
	st, ok := e.mfaStep(t, body["challenge"].(string), "totp", e.code(secret, 0))
	if st != 200 || ok["status"] != "ok" {
		t.Fatalf("totp = %d %v", st, ok)
	}
}

func TestEmailLoginUnderEnforcementNeedsThePasswordWithoutTOTP(t *testing.T) {
	e := emailLoginEnv(t)
	setAuthSetting(t, e.db, "mfa_enforced", "1")
	_, start := e.emailStart(t, "bobby")
	m := e.waitMails(t, 1)[0]
	st, body := e.emailVerify(t, start["challenge"].(string), codeIn(t, m))
	if st != 403 || body["error"] != "password_login_required" || body["token"] != nil {
		t.Fatalf("verify = %d %v", st, body)
	}
}

func TestEmailLoginSwitchOffAndWithoutMail(t *testing.T) {
	e := emailLoginEnv(t)
	setAuthSetting(t, e.db, "email_code_login", "0")
	for _, path := range []string{"/api/auth/email-login/start", "/api/auth/email-login/verify"} {
		var eb errBody
		r := doJSON(t, "POST", e.ts.URL, path, "", map[string]any{"login": "bobby", "challenge": "x", "code": "000000"})
		decodeJSON(t, r, &eb)
		if r.StatusCode != 409 || eb.Error != "email_login_unavailable" {
			t.Errorf("%s with the switch off = %d %s", path, r.StatusCode, eb.Error)
		}
	}
	setAuthSetting(t, e.db, "email_code_login", "1")
	doJSON(t, "DELETE", e.ts.URL, "/api/admin/settings/smtp", e.owner, ownerReauth)
	if st, _ := e.emailStart(t, "bobby"); st != 409 {
		t.Errorf("without mail = %d", st)
	}
}

func TestEmailLoginWrongCodesShareTheUserBudgetWithMFA(t *testing.T) {
	e := emailLoginEnv(t)
	hit429 := false
	for i := 0; i < 5 && !hit429; i++ {
		st, start := e.emailStart(t, "bobby")
		if st != 202 {
			t.Fatalf("start %d = %d", i, st)
		}
		for j := 0; j < 3; j++ {
			if st, _ := e.emailVerify(t, start["challenge"].(string), "000000"); st == 429 {
				hit429 = true
				break
			}
		}
	}
	if !hit429 {
		t.Fatal("no 429 across fresh challenges")
	}
}

func TestEmailLoginUnknownIdentifierBudgetMatchesKnown(t *testing.T) {
	e := emailLoginEnv(t)
	count := func(login string) int {
		for i := 0; i < 20; i++ {
			st, start := e.emailStart(t, login)
			if st != 202 {
				return -1
			}
			for j := 0; j < 5; j++ {
				if st, _ := e.emailVerify(t, start["challenge"].(string), "000000"); st == 429 {
					return i*5 + j
				}
			}
			e.clk.advance(0)
			// the ident limiter (5/hour) would stop the start itself; reset its clock
			e.clk.advance(13 * time.Minute)
		}
		return -2
	}
	known, unknown := count("bobby"), count("ghost-user")
	if known <= 0 || known != unknown {
		t.Errorf("wrong codes before 429: known=%d unknown=%d (must match so the budget does not tell them apart)", known, unknown)
	}
}
