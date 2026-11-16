package api_test

import (
	"net/http"
	"strings"
	"testing"
)

type authSettingsBody struct {
	Registration   string `json:"registration"`
	EmailPolicy    string `json:"emailPolicy"`
	MFAEnforced    bool   `json:"mfaEnforced"`
	EmailCodeLogin bool   `json:"emailCodeLogin"`
	Mail           struct {
		Configured bool `json:"configured"`
	} `json:"mail"`
}

func TestAuthSettingsDefaultsPatchAndAudit(t *testing.T) {
	ts, sqlDB := newServer(t)
	owner := registerUser(t, ts.URL, "owner", "")
	user := registerUser(t, ts.URL, "plain-user", owner)

	var got authSettingsBody
	resp := doJSON(t, "GET", ts.URL, "/api/admin/settings/auth", owner, nil)
	decodeJSON(t, resp, &got)
	if resp.StatusCode != 200 || got.Registration != "closed" || got.EmailPolicy != "off" || got.MFAEnforced || got.Mail.Configured {
		t.Fatalf("defaults = %d %+v", resp.StatusCode, got)
	}
	resp = doJSON(t, "PATCH", ts.URL, "/api/admin/settings/auth", owner, map[string]any{"registration": "invite", "emailPolicy": "optional", "currentPassword": "secret-pass-owner"})
	decodeJSON(t, resp, &got)
	if resp.StatusCode != 200 || got.Registration != "invite" || got.EmailPolicy != "optional" {
		t.Fatalf("patch = %d %+v", resp.StatusCode, got)
	}
	for _, bad := range []map[string]any{{"registration": "everyone"}, {"emailPolicy": "maybe"}} {
		if r := doJSON(t, "PATCH", ts.URL, "/api/admin/settings/auth", owner, bad); r.StatusCode != 422 {
			t.Errorf("PATCH %v = %d, want 422", bad, r.StatusCode)
		}
	}
	// Without a mail service the switches that need mail are refused.
	for _, k := range []string{"mfaEnforced", "emailCodeLogin"} {
		r := doJSON(t, "PATCH", ts.URL, "/api/admin/settings/auth", owner, map[string]any{k: true})
		var e struct{ Error string }
		decodeJSON(t, r, &e)
		if r.StatusCode != 409 || e.Error != "mail_unavailable" {
			t.Errorf("PATCH %s:true = %d %q, want 409 mail_unavailable", k, r.StatusCode, e.Error)
		}
	}
	// Switching them off needs no mail.
	if r := doJSON(t, "PATCH", ts.URL, "/api/admin/settings/auth", owner, map[string]any{"mfaEnforced": false}); r.StatusCode != 200 {
		t.Errorf("PATCH mfaEnforced:false = %d", r.StatusCode)
	}
	if r := doJSON(t, "PATCH", ts.URL, "/api/admin/settings/auth", owner, map[string]any{"nope": 1}); r.StatusCode != 400 {
		t.Errorf("unknown key = %d, want 400", r.StatusCode)
	}
	for _, method := range []string{"GET", "PATCH"} {
		if r := doJSON(t, method, ts.URL, "/api/admin/settings/auth", user, map[string]any{}); r.StatusCode != 403 {
			t.Errorf("%s as user = %d, want 403", method, r.StatusCode)
		}
	}
	var n int
	sqlDB.QueryRow(`SELECT COUNT(*) FROM auth_audit WHERE action = 'settings_changed'`).Scan(&n)
	if n != 2 {
		t.Errorf("settings_changed rows = %d, want 2", n)
	}
}

func TestAuthOptionsArePublicAndTrackBootstrap(t *testing.T) {
	ts, _ := newServer(t)
	type options struct {
		Bootstrap         bool   `json:"bootstrap"`
		Registration      string `json:"registration"`
		EmailPolicy       string `json:"emailPolicy"`
		PasswordReset     bool   `json:"passwordReset"`
		EmailCodeLogin    bool   `json:"emailCodeLogin"`
		PasswordMinLength int    `json:"passwordMinLength"`
	}
	var o options
	resp := doJSON(t, "GET", ts.URL, "/api/auth/options", "", nil)
	decodeJSON(t, resp, &o)
	if resp.StatusCode != 200 || !o.Bootstrap || o.Registration != "closed" || o.PasswordMinLength != 10 || o.PasswordReset || o.EmailCodeLogin {
		t.Fatalf("empty db options = %d %+v", resp.StatusCode, o)
	}
	owner := registerUser(t, ts.URL, "owner", "")
	doJSON(t, "PATCH", ts.URL, "/api/admin/settings/auth", owner, map[string]any{"registration": "open", "currentPassword": "secret-pass-owner"})
	resp = doJSON(t, "GET", ts.URL, "/api/auth/options", "", nil)
	decodeJSON(t, resp, &o)
	if o.Bootstrap || o.Registration != "open" {
		t.Errorf("options after first user = %+v", o)
	}
	if !strings.HasPrefix(resp.Header.Get("Content-Type"), "application/json") {
		t.Error("options is not JSON")
	}
	if cc := resp.Header.Get("Cache-Control"); cc != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", cc)
	}
	_ = http.StatusOK
}

func TestMeHidesStoredEmailWhilePolicyIsOff(t *testing.T) {
	ts, sqlDB := newServer(t)
	owner := registerUser(t, ts.URL, "owner", "")
	if _, err := sqlDB.Exec(`UPDATE users SET email = 'a@example.org', email_norm = 'a@example.org'`); err != nil {
		t.Fatal(err)
	}
	var me struct {
		Email *string `json:"email"`
	}
	decodeJSON(t, doJSON(t, "GET", ts.URL, "/api/auth/me", owner, nil), &me)
	if me.Email != nil {
		t.Errorf("email shown while policy off: %q", *me.Email)
	}
	doJSON(t, "PATCH", ts.URL, "/api/admin/settings/auth", owner, map[string]any{"emailPolicy": "optional"})
	decodeJSON(t, doJSON(t, "GET", ts.URL, "/api/auth/me", owner, nil), &me)
	if me.Email == nil || *me.Email != "a@example.org" {
		t.Errorf("email not shown with policy optional: %v", me.Email)
	}
}
