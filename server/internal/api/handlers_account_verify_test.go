package api_test

import (
	"strings"
	"testing"
)

type verifyResp struct {
	Email         *string `json:"email"`
	EmailVerified bool    `json:"emailVerified"`
	Verification  string  `json:"verification"`
}

func TestEmailVerificationFlow(t *testing.T) {
	e := newMailEnv(t, mailOpts{configure: true})
	setAuthSetting(t, e.db, "email_policy", "optional")
	bob := registerUser(t, e.ts.URL, "bobby", e.owner)
	put := func(tok string, body map[string]any) (int, verifyResp, errBody) {
		r := doJSON(t, "PUT", e.ts.URL, "/api/account/email", tok, body)
		var v verifyResp
		var eb errBody
		b := readBody(t, r.Body)
		decodeString(t, b, &v)
		decodeString(t, b, &eb)
		return r.StatusCode, v, eb
	}
	st, v, _ := put(bob, map[string]any{"email": "b@example.org", "currentPassword": "secret-pass-bobby"})
	if st != 200 || v.Verification != "sent" || v.EmailVerified {
		t.Fatalf("put = %d %+v", st, v)
	}
	mails := e.waitMails(t, 1)
	if mails[0].To != "b@example.org" || strings.Contains(mails[0].Subject, codeIn(t, mails[0])) {
		t.Fatalf("mail = %+v", mails[0])
	}
	code := codeIn(t, mails[0])
	wrong := "000000"
	if code == wrong {
		wrong = "111111"
	}
	r := doJSON(t, "POST", e.ts.URL, "/api/account/email/verify", bob, map[string]any{"code": wrong})
	var eb struct {
		Error        string
		AttemptsLeft int
	}
	decodeJSON(t, r, &eb)
	if r.StatusCode != 403 || eb.Error != "code_invalid" || eb.AttemptsLeft != 4 {
		t.Fatalf("wrong code = %d %+v (an authenticated route never answers 401)", r.StatusCode, eb)
	}
	if r := doJSON(t, "POST", e.ts.URL, "/api/account/email/verify", bob, map[string]any{"code": code}); r.StatusCode != 200 {
		t.Fatalf("right code = %d", r.StatusCode)
	}
	var me struct{ EmailVerified bool }
	decodeJSON(t, doJSON(t, "GET", e.ts.URL, "/api/auth/me", bob, nil), &me)
	if !me.EmailVerified {
		t.Error("not verified after the right code")
	}
	// the code works once
	if r := doJSON(t, "POST", e.ts.URL, "/api/account/email/verify", bob, map[string]any{"code": code}); r.StatusCode != 403 {
		t.Errorf("reuse = %d", r.StatusCode)
	}
	// a verified address that is saved again stays verified and sends nothing
	st, v, _ = put(bob, map[string]any{"email": "B@example.org", "currentPassword": "secret-pass-bobby"})
	if st != 200 || !v.EmailVerified || v.Verification != "none" {
		t.Errorf("re-save = %d %+v", st, v)
	}
	// changing it clears the verification
	st, v, _ = put(bob, map[string]any{"email": "other@example.org", "currentPassword": "secret-pass-bobby"})
	if st != 200 || v.EmailVerified || v.Verification != "sent" {
		t.Errorf("change = %d %+v", st, v)
	}
	e.waitMails(t, 3) // the code for the new address and the notice to the old one
	// wrong password: nothing is sent
	if st, _, eb := put(bob, map[string]any{"email": "third@example.org", "currentPassword": "nope-nope-nope"}); st != 403 || eb.Error != "wrong_password" {
		t.Errorf("wrong password = %d %s", st, eb.Error)
	}
	e.noMoreMails(t, 3)
}

func TestEmailVerificationAttemptsResendAndLimits(t *testing.T) {
	e := newMailEnv(t, mailOpts{configure: true})
	setAuthSetting(t, e.db, "email_policy", "optional")
	bob := registerUser(t, e.ts.URL, "bobby", e.owner)
	doJSON(t, "PUT", e.ts.URL, "/api/account/email", bob, map[string]any{"email": "b@example.org", "currentPassword": "secret-pass-bobby"})
	code := codeIn(t, e.waitMails(t, 1)[0])
	// resend is refused inside the 60 seconds
	r := doJSON(t, "POST", e.ts.URL, "/api/account/email/resend", bob, nil)
	if r.StatusCode != 429 || r.Header.Get("Retry-After") == "" {
		t.Fatalf("immediate resend = %d", r.StatusCode)
	}
	// five wrong codes end the challenge; the right one is then refused too
	wrong := "000000"
	if code == wrong {
		wrong = "111111"
	}
	var last string
	for i := 0; i < 5; i++ {
		var eb errBody
		rr := doJSON(t, "POST", e.ts.URL, "/api/account/email/verify", bob, map[string]any{"code": wrong})
		decodeJSON(t, rr, &eb)
		last = eb.Error
	}
	if last != "challenge_expired" {
		t.Errorf("fifth wrong code = %q, want challenge_expired", last)
	}
	if r := doJSON(t, "POST", e.ts.URL, "/api/account/email/verify", bob, map[string]any{"code": code}); r.StatusCode != 403 {
		t.Errorf("right code after exhaustion = %d", r.StatusCode)
	}
	// a resend now starts a fresh challenge
	if r := doJSON(t, "POST", e.ts.URL, "/api/account/email/resend", bob, nil); r.StatusCode != 202 {
		t.Fatalf("resend after exhaustion = %d", r.StatusCode)
	}
	fresh := codeIn(t, e.waitMails(t, 2)[1])
	if r := doJSON(t, "POST", e.ts.URL, "/api/account/email/verify", bob, map[string]any{"code": fresh}); r.StatusCode != 200 {
		t.Errorf("fresh code = %d", r.StatusCode)
	}
	if r := doJSON(t, "POST", e.ts.URL, "/api/account/email/resend", bob, nil); r.StatusCode != 409 {
		t.Errorf("resend for a verified address = %d, want 409", r.StatusCode)
	}
}

func TestEmailVerificationUnavailableWithoutMail(t *testing.T) {
	e := newMailEnv(t, mailOpts{}) // no SMTP saved
	setAuthSetting(t, e.db, "email_policy", "optional")
	bob := registerUser(t, e.ts.URL, "bobby", e.owner)
	r := doJSON(t, "PUT", e.ts.URL, "/api/account/email", bob, map[string]any{"email": "b@example.org", "currentPassword": "secret-pass-bobby"})
	var v verifyResp
	decodeJSON(t, r, &v)
	if r.StatusCode != 200 || v.Verification != "unavailable" || v.EmailVerified {
		t.Fatalf("no mail = %d %+v", r.StatusCode, v)
	}
	if r := doJSON(t, "POST", e.ts.URL, "/api/account/email/resend", bob, nil); r.StatusCode != 409 {
		t.Errorf("resend without mail = %d", r.StatusCode)
	}
	e.noMoreMails(t, 0)
}

func TestEmailRoutesInEnrolmentSession(t *testing.T) {
	e := newMailEnv(t, mailOpts{configure: true})
	setAuthSetting(t, e.db, "email_policy", "optional")
	bob := registerUser(t, e.ts.URL, "bobby", e.owner)
	e.db.Exec(`UPDATE sessions SET level = 'enroll' WHERE user_id = (SELECT id FROM users WHERE username = 'bobby')`)
	// no password asked for an enrolment session
	r := doJSON(t, "PUT", e.ts.URL, "/api/account/email", bob, map[string]any{"email": "b@example.org"})
	if r.StatusCode != 200 {
		t.Fatalf("enrolment put = %d", r.StatusCode)
	}
	code := codeIn(t, e.waitMails(t, 1)[0])
	if r := doJSON(t, "POST", e.ts.URL, "/api/account/email/verify", bob, map[string]any{"code": code}); r.StatusCode != 200 {
		t.Errorf("enrolment verify = %d", r.StatusCode)
	}
	// a full session still needs the password
	e.db.Exec(`UPDATE sessions SET level = 'full'`)
	var eb errBody
	r = doJSON(t, "PUT", e.ts.URL, "/api/account/email", bob, map[string]any{"email": "c@example.org"})
	decodeJSON(t, r, &eb)
	if r.StatusCode != 403 || eb.Error != "current_password_required" {
		t.Errorf("full session without password = %d %s", r.StatusCode, eb.Error)
	}
}

func TestEmailPolicyStillApplies(t *testing.T) {
	e := newMailEnv(t, mailOpts{configure: true})
	bob := registerUser(t, e.ts.URL, "bobby", e.owner)
	var eb errBody
	r := doJSON(t, "PUT", e.ts.URL, "/api/account/email", bob, map[string]any{"email": "b@example.org", "currentPassword": "secret-pass-bobby"})
	decodeJSON(t, r, &eb)
	if r.StatusCode != 422 || eb.Error != "email_disabled" {
		t.Errorf("policy off = %d %s", r.StatusCode, eb.Error)
	}
	setAuthSetting(t, e.db, "email_policy", "required")
	r = doJSON(t, "PUT", e.ts.URL, "/api/account/email", bob, map[string]any{"email": nil, "currentPassword": "secret-pass-bobby"})
	decodeJSON(t, r, &eb)
	if r.StatusCode != 422 || eb.Error != "email_required" {
		t.Errorf("required + null = %d %s", r.StatusCode, eb.Error)
	}
}
