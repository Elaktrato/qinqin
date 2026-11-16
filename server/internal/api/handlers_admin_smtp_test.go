package api_test

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"testing"

	"qinqin/internal/mail"
)

func readBody(t *testing.T, resp interface{ Read([]byte) (int, error) }) string {
	t.Helper()
	b, _ := io.ReadAll(resp)
	return string(b)
}

func TestSMTPSettingsNeverReturnThePassword(t *testing.T) {
	e := newMailEnv(t, mailOpts{})
	// before: defaults, not configured
	var v map[string]any
	decodeJSON(t, doJSON(t, "GET", e.ts.URL, "/api/admin/settings/smtp", e.owner, ownerReauth), &v)
	if v["configured"] != false || v["password"] != "none" || v["secret"] != "ok" || v["port"].(float64) != 587 || v["tls"] != "starttls" {
		t.Fatalf("defaults = %v", v)
	}
	put := doJSON(t, "PUT", e.ts.URL, "/api/admin/settings/smtp", e.owner, e.smtpPayload())
	putBody := readBody(t, put.Body)
	if put.StatusCode != 200 || strings.Contains(putBody, testSMTPPassword) {
		t.Fatalf("PUT = %d %s", put.StatusCode, putBody)
	}
	get := doJSON(t, "GET", e.ts.URL, "/api/admin/settings/smtp", e.owner, ownerReauth)
	body := readBody(t, get.Body)
	if strings.Contains(body, testSMTPPassword) || !strings.Contains(body, `"password":"set"`) || !strings.Contains(body, `"configured":true`) {
		t.Fatalf("GET = %s", body)
	}
	if get.Header.Get("Cache-Control") != "no-store" {
		t.Error("settings are cacheable")
	}
	// the password is not stored in clear text either
	var ct []byte
	e.db.QueryRow(`SELECT password_ct FROM smtp_settings`).Scan(&ct)
	if len(ct) == 0 || strings.Contains(string(ct), testSMTPPassword) {
		t.Error("password stored in clear text or missing")
	}
	// formatting the stored configuration never shows it
	p, err := e.svc.Store.PrepareStored(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range []string{"%v", "%+v", "%#v", "%s"} {
		if strings.Contains(fmt.Sprintf(f, p), testSMTPPassword) || strings.Contains(fmt.Sprintf(f, *p), testSMTPPassword) {
			t.Errorf("format %s leaks the password", f)
		}
	}
	j, _ := json.Marshal(p)
	if strings.Contains(string(j), testSMTPPassword) {
		t.Error("JSON leaks the password")
	}
	// the audit row names the field only
	var detail string
	e.db.QueryRow(`SELECT detail FROM auth_audit WHERE action='settings_changed' ORDER BY id DESC LIMIT 1`).Scan(&detail)
	if detail != `{"field":"smtp","to":"saved"}` {
		t.Errorf("audit detail = %s", detail)
	}
}

func TestSMTPPasswordKeepClearReplace(t *testing.T) {
	e := newMailEnv(t, mailOpts{configure: true})
	state := func() string {
		var v struct{ Password string }
		decodeJSON(t, doJSON(t, "GET", e.ts.URL, "/api/admin/settings/smtp", e.owner, ownerReauth), &v)
		return v.Password
	}
	// keep: password absent, same connection (only the from name changes)
	p := e.smtpPayload()
	delete(p, "password")
	p["fromName"] = "Other"
	if r := doJSON(t, "PUT", e.ts.URL, "/api/admin/settings/smtp", e.owner, p); r.StatusCode != 200 || state() != "set" {
		t.Fatalf("keep = %d %s", r.StatusCode, state())
	}
	// the kept password still works: a test mail authenticates
	if r := doJSON(t, "POST", e.ts.URL, "/api/admin/settings/smtp/test", e.owner, map[string]any{"to": "a@example.com"}); r.StatusCode != 200 {
		t.Fatalf("test after keep = %d", r.StatusCode)
	}
	// replace: a wrong one makes the test fail with auth/535
	p["password"] = "another-secret"
	doJSON(t, "PUT", e.ts.URL, "/api/admin/settings/smtp", e.owner, p)
	var f struct {
		Error, Category string
		SMTPCode        int `json:"smtpCode"`
	}
	r := doJSON(t, "POST", e.ts.URL, "/api/admin/settings/smtp/test", e.owner, map[string]any{"to": "a@example.com"})
	decodeJSON(t, r, &f)
	if r.StatusCode != 502 || f.Error != "smtp_test_failed" || f.Category != "auth" || f.SMTPCode != 535 {
		t.Fatalf("wrong password test = %d %+v", r.StatusCode, f)
	}
	// clear (needs a username-less config: otherwise password_required)
	p["password"] = ""
	if r := doJSON(t, "PUT", e.ts.URL, "/api/admin/settings/smtp", e.owner, p); r.StatusCode != 422 {
		t.Errorf("clearing the password with a user name = %d, want 422", r.StatusCode)
	}
	p["username"] = ""
	if r := doJSON(t, "PUT", e.ts.URL, "/api/admin/settings/smtp", e.owner, p); r.StatusCode != 200 || state() != "none" {
		t.Errorf("clear = %d %s", r.StatusCode, state())
	}
}

func TestSMTPPasswordNeverFollowsANewHost(t *testing.T) {
	e := newMailEnv(t, mailOpts{configure: true})
	for name, mut := range map[string]func(map[string]any){
		"host":     func(p map[string]any) { p["host"] = "other.example.org" },
		"port":     func(p map[string]any) { p["port"] = e.smtp.Port + 1 },
		"tls":      func(p map[string]any) { p["tls"] = "tls" },
		"username": func(p map[string]any) { p["username"] = "someone-else" },
		// reset links and sign-in mails carry the public URL: a new one is a new target too
		"publicUrl": func(p map[string]any) { p["publicUrl"] = "https://evil.attacker.test" },
	} {
		p := e.smtpPayload()
		delete(p, "password")
		mut(p)
		var er struct{ Error string }
		r := doJSON(t, "PUT", e.ts.URL, "/api/admin/settings/smtp", e.owner, p)
		decodeJSON(t, r, &er)
		if r.StatusCode != 422 || er.Error != "password_reentry_required" {
			t.Errorf("%s changed without the password: %d %s", name, r.StatusCode, er.Error)
		}
		// the same holds for a draft test: nothing is sent to the new target
		before := len(e.smtp.Messages())
		r = doJSON(t, "POST", e.ts.URL, "/api/admin/settings/smtp/test", e.owner, map[string]any{"to": "a@example.com", "draft": p})
		decodeJSON(t, r, &er)
		if r.StatusCode != 422 || er.Error != "password_reentry_required" || len(e.smtp.Messages()) != before {
			t.Errorf("%s draft test: %d %s", name, r.StatusCode, er.Error)
		}
	}
}

func TestSMTPValidation(t *testing.T) {
	e := newMailEnv(t, mailOpts{})
	cases := []struct {
		name string
		mut  func(map[string]any)
		code string
		st   int
	}{
		{"host with scheme", func(p map[string]any) { p["host"] = "smtp://mail.example.org" }, "invalid_host", 422},
		{"empty host", func(p map[string]any) { p["host"] = "" }, "invalid_host", 422},
		{"metadata ip", func(p map[string]any) { p["host"] = "169.254.169.254" }, "smtp_host_blocked", 422},
		{"port 0", func(p map[string]any) { p["port"] = 0 }, "invalid_port", 422},
		{"port 70000", func(p map[string]any) { p["port"] = 70000 }, "invalid_port", 422},
		{"tls mode", func(p map[string]any) { p["tls"] = "ssl" }, "invalid_tls", 422},
		{"none with user", func(p map[string]any) { p["tls"] = "none" }, "credentials_need_tls", 422},
		{"user without password", func(p map[string]any) { delete(p, "password") }, "password_required", 422},
		{"from header injection", func(p map[string]any) { p["fromAddress"] = "a@example.org\r\nBcc: x@y.z" }, "invalid_email", 422},
		{"from with name", func(p map[string]any) { p["fromAddress"] = "Q <a@example.org>" }, "invalid_email", 422},
		{"public url path", func(p map[string]any) { p["publicUrl"] = "https://x.example.org/app" }, "invalid_public_url", 422},
		{"public url userinfo", func(p map[string]any) { p["publicUrl"] = "https://u:p@x.example.org" }, "invalid_public_url", 422},
		{"public url scheme", func(p map[string]any) { p["publicUrl"] = "ftp://x.example.org" }, "invalid_public_url", 422},
		{"public url query", func(p map[string]any) { p["publicUrl"] = "https://x.example.org?a=1" }, "invalid_public_url", 422},
	}
	for _, c := range cases {
		p := e.smtpPayload()
		c.mut(p)
		var er struct{ Error string }
		r := doJSON(t, "PUT", e.ts.URL, "/api/admin/settings/smtp", e.owner, p)
		decodeJSON(t, r, &er)
		if r.StatusCode != c.st || er.Error != c.code {
			t.Errorf("%s: %d %q, want %d %q", c.name, r.StatusCode, er.Error, c.st, c.code)
		}
	}
	var n int
	e.db.QueryRow(`SELECT COUNT(*) FROM smtp_settings`).Scan(&n)
	if n != 0 {
		t.Error("an invalid body was saved")
	}
	// unknown key is a 400
	p := e.smtpPayload()
	p["bogus"] = 1
	if r := doJSON(t, "PUT", e.ts.URL, "/api/admin/settings/smtp", e.owner, p); r.StatusCode != 400 {
		t.Errorf("unknown key = %d", r.StatusCode)
	}
}

func TestSMTPWithoutSecretStoresNoPassword(t *testing.T) {
	e := newMailEnv(t, mailOpts{noSecret: true, smtp: smtpNoAuth()})
	var er struct{ Error string }
	r := doJSON(t, "PUT", e.ts.URL, "/api/admin/settings/smtp", e.owner, e.smtpPayload())
	decodeJSON(t, r, &er)
	if r.StatusCode != 409 || er.Error != "secret_unavailable" {
		t.Fatalf("password without secret = %d %s", r.StatusCode, er.Error)
	}
	p := e.smtpPayload()
	delete(p, "password")
	p["username"] = ""
	p["tls"] = "none"
	if r := doJSON(t, "PUT", e.ts.URL, "/api/admin/settings/smtp", e.owner, p); r.StatusCode != 200 {
		t.Fatalf("unauthenticated relay = %d", r.StatusCode)
	}
	var v struct{ Secret string }
	decodeJSON(t, doJSON(t, "GET", e.ts.URL, "/api/admin/settings/smtp", e.owner, ownerReauth), &v)
	if v.Secret != "missing" {
		t.Errorf("secret = %q", v.Secret)
	}
}

func TestSMTPTestMailSendsExactlyOne(t *testing.T) {
	e := newMailEnv(t, mailOpts{configure: true})
	r := doJSON(t, "POST", e.ts.URL, "/api/admin/settings/smtp/test", e.owner, map[string]any{"to": "bob@example.com"})
	if r.StatusCode != 200 {
		t.Fatalf("test = %d", r.StatusCode)
	}
	m := e.smtp.Messages()
	if len(m) != 1 || m[0].To[0] != "bob@example.com" || m[0].From != "qinqin@example.org" || !strings.Contains(m[0].Data, "words.example.org") {
		t.Fatalf("messages = %+v", m)
	}
	// no recipient and no email on the account
	var er struct{ Error string }
	r = doJSON(t, "POST", e.ts.URL, "/api/admin/settings/smtp/test", e.owner, map[string]any{})
	decodeJSON(t, r, &er)
	if r.StatusCode != 422 || er.Error != "recipient_required" {
		t.Errorf("no recipient = %d %s", r.StatusCode, er.Error)
	}
	// injected recipient
	r = doJSON(t, "POST", e.ts.URL, "/api/admin/settings/smtp/test", e.owner, map[string]any{"to": "a@example.com\r\nRCPT TO:<x@y.z>"})
	if r.StatusCode != 422 {
		t.Errorf("injected recipient = %d", r.StatusCode)
	}
	if len(e.smtp.Messages()) != 1 {
		t.Error("an extra message was sent")
	}
}

func TestSMTPTestFailureCategoriesAndSecrecy(t *testing.T) {
	e := newMailEnv(t, mailOpts{smtp: smtpWith(func(o *mailOptsAlias) { o.RejectRcpt = true; o.GreetingText = "internal-banner.corp" })})
	e.configure(t)
	r := doJSON(t, "POST", e.ts.URL, "/api/admin/settings/smtp/test", e.owner, map[string]any{"to": "bob@example.com"})
	body := readBody(t, r.Body)
	if r.StatusCode != 502 || !strings.Contains(body, `"category":"recipient"`) || !strings.Contains(body, `"smtpCode":550`) {
		t.Fatalf("recipient failure = %d %s", r.StatusCode, body)
	}
	for _, leak := range []string{"internal-banner", "no such user", testSMTPPassword} {
		if strings.Contains(body, leak) {
			t.Errorf("response leaks %q", leak)
		}
	}
	// a blocked target never connects: draft with a metadata address
	p := e.smtpPayload()
	p["host"] = "169.254.169.254"
	if r := doJSON(t, "POST", e.ts.URL, "/api/admin/settings/smtp/test", e.owner, map[string]any{"to": "a@example.com", "draft": p}); r.StatusCode != 422 {
		t.Errorf("metadata draft = %d", r.StatusCode)
	}
}

func TestSMTPDeleteAndAuthorization(t *testing.T) {
	e := newMailEnv(t, mailOpts{configure: true})
	user := registerUser(t, e.ts.URL, "plainuser", e.owner)
	for _, c := range [][2]string{{"GET", "/api/admin/settings/smtp"}, {"PUT", "/api/admin/settings/smtp"}, {"DELETE", "/api/admin/settings/smtp"}, {"POST", "/api/admin/settings/smtp/test"}} {
		for _, tok := range []string{"", user} {
			if r := doJSON(t, c[0], e.ts.URL, c[1], tok, map[string]any{}); r.StatusCode != 403 {
				t.Errorf("%s %s with token %q = %d, want 403", c[0], c[1], tok, r.StatusCode)
			}
		}
	}
	if r := doJSON(t, "DELETE", e.ts.URL, "/api/admin/settings/smtp", e.owner, ownerReauth); r.StatusCode != 204 {
		t.Fatalf("delete = %d", r.StatusCode)
	}
	var v struct {
		Configured bool
		Password   string
	}
	decodeJSON(t, doJSON(t, "GET", e.ts.URL, "/api/admin/settings/smtp", e.owner, ownerReauth), &v)
	if v.Configured || v.Password != "none" {
		t.Errorf("after delete = %+v", v)
	}
	var d string
	e.db.QueryRow(`SELECT detail FROM auth_audit WHERE action='settings_changed' ORDER BY id DESC LIMIT 1`).Scan(&d)
	if d != `{"field":"smtp","to":"removed"}` {
		t.Errorf("audit = %s", d)
	}
}

func TestSMTPTestIsRateLimited(t *testing.T) {
	e := newMailEnv(t, mailOpts{configure: true})
	var last int
	for i := 0; i < 11; i++ {
		r := doJSON(t, "POST", e.ts.URL, "/api/admin/settings/smtp/test", e.owner, map[string]any{"to": "bob@example.com"})
		last = r.StatusCode
	}
	if last != 429 {
		t.Errorf("11th test = %d, want 429", last)
	}
	if n := len(e.smtp.Messages()); n != 10 {
		t.Errorf("sent %d mails, want 10", n)
	}
}

var _ = mail.ModeNone

func TestOptionsFollowTheMailConfiguration(t *testing.T) {
	e := newMailEnv(t, mailOpts{})
	opts := func() (reset, code bool) {
		var o struct {
			PasswordReset  bool `json:"passwordReset"`
			EmailCodeLogin bool `json:"emailCodeLogin"`
		}
		decodeJSON(t, doJSON(t, "GET", e.ts.URL, "/api/auth/options", "", nil), &o)
		return o.PasswordReset, o.EmailCodeLogin
	}
	if r, _ := opts(); r {
		t.Fatal("passwordReset is on without SMTP")
	}
	e.configure(t)
	if r, _ := opts(); !r {
		t.Fatal("passwordReset is off with SMTP")
	}
	var st struct{ Mail struct{ Configured bool } }
	decodeJSON(t, doJSON(t, "GET", e.ts.URL, "/api/admin/settings/auth", e.owner, nil), &st)
	if !st.Mail.Configured {
		t.Error("settings/auth does not report mail configured")
	}
	if r := doJSON(t, "PATCH", e.ts.URL, "/api/admin/settings/auth", e.owner, map[string]any{"emailCodeLogin": true, "currentPassword": "secret-pass-owner"}); r.StatusCode != 200 {
		t.Errorf("emailCodeLogin with mail = %d", r.StatusCode)
	}
	if _, c := opts(); !c {
		t.Error("emailCodeLogin option not on")
	}
	doJSON(t, "DELETE", e.ts.URL, "/api/admin/settings/smtp", e.owner, ownerReauth)
	if r, c := opts(); r || c {
		t.Errorf("after removing SMTP: reset=%v code=%v", r, c)
	}
}
