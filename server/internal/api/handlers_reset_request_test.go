package api_test

import (
	"database/sql"
	"io"
	"net/http"
	"strings"
	"testing"
)

type rawResp struct {
	status  int
	body    string
	headers http.Header
}

func rawPost(t *testing.T, base, path string, body map[string]any) rawResp {
	t.Helper()
	r := doJSON(t, "POST", base, path, "", body)
	b, _ := io.ReadAll(r.Body)
	h := r.Header.Clone()
	h.Del("Date")
	return rawResp{r.StatusCode, string(b), h}
}

func resetEnv(t *testing.T) (*mailEnv, string) {
	e := newMailEnv(t, mailOpts{configure: true})
	setAuthSetting(t, e.db, "email_policy", "optional")
	// bob has a verified address; carol an unverified one; dave is disabled
	for _, n := range []string{"bobby", "carol", "davey"} {
		registerUser(t, e.ts.URL, n, e.owner)
	}
	e.db.Exec(`UPDATE users SET email = 'bob@example.org', email_norm = 'bob@example.org', email_verified_at = 't' WHERE username = 'bobby'`)
	e.db.Exec(`UPDATE users SET email = 'carol@example.org', email_norm = 'carol@example.org' WHERE username = 'carol'`)
	e.db.Exec(`UPDATE users SET email = 'dave@example.org', email_norm = 'dave@example.org', email_verified_at = 't', disabled_at = 't' WHERE username = 'davey'`)
	return e, "secret-pass-bobby"
}

func TestResetRequestAnswersTheSameForEveryone(t *testing.T) {
	e, _ := resetEnv(t)
	var first rawResp
	for i, login := range []string{"bobby", "nobody-here", "carol", "davey", "bob@example.org", "BOB@EXAMPLE.ORG", "ghost@example.org"} {
		got := rawPost(t, e.ts.URL, "/api/auth/reset-request", map[string]any{"login": login})
		if got.status != 202 || strings.TrimSpace(got.body) != "{}" {
			t.Fatalf("%s: %d %q", login, got.status, got.body)
		}
		if i == 0 {
			first = got
		} else if got.headers.Get("Content-Type") != first.headers.Get("Content-Type") || len(got.headers) != len(first.headers) {
			t.Errorf("%s: headers differ: %v vs %v", login, got.headers, first.headers)
		}
	}
	// exactly one mail per eligible request: bobby, bob@example.org twice (the e-mail forms)
	mails := e.waitMails(t, 3)
	e.noMoreMails(t, 3)
	for _, m := range mails {
		if m.To != "bob@example.org" {
			t.Errorf("a mail went to %s", m.To)
		}
	}
}

func TestResetRequestMailWorksWithTheResetRoutes(t *testing.T) {
	e, _ := resetEnv(t)
	if got := rawPost(t, e.ts.URL, "/api/auth/reset-request", map[string]any{"login": "bobby"}); got.status != 202 {
		t.Fatal(got)
	}
	m := e.waitMails(t, 1)[0]
	g := resetLink.FindStringSubmatch(m.Body)
	if g == nil || !strings.Contains(m.Body, "https://words.example.org/reset#t=") {
		t.Fatalf("no link under the public URL in %q", m.Body)
	}
	if strings.Contains(m.Subject, g[1]) {
		t.Error("token in the subject")
	}
	var chk struct{ Username string }
	r := doJSON(t, "POST", e.ts.URL, "/api/auth/reset/check", "", map[string]any{"token": g[1]})
	decodeJSON(t, r, &chk)
	if r.StatusCode != 200 || chk.Username != "bobby" {
		t.Fatalf("check = %d %+v", r.StatusCode, chk)
	}
	var lr struct{ Status, Token string }
	r = doJSON(t, "POST", e.ts.URL, "/api/auth/reset", "", map[string]any{"token": g[1], "password": "a-brand-new-password"})
	decodeJSON(t, r, &lr)
	if r.StatusCode != 200 || lr.Status != "ok" || lr.Token == "" {
		t.Fatalf("reset = %d %+v", r.StatusCode, lr)
	}
	// the link expires in an hour: stored with a 1 h window and no admin as issuer
	var created sqlNullInt
	e.db.QueryRow(`SELECT created_by FROM password_resets ORDER BY id DESC LIMIT 1`).Scan(&created.v)
	if created.v.Valid {
		t.Errorf("created_by = %v, want NULL", created.v)
	}
}

func TestResetRequestLimitsAreTheSameForUnknownIdentifiers(t *testing.T) {
	e, _ := resetEnv(t)
	for _, login := range []string{"bobby", "nobody-here"} {
		var last int
		var retry string
		for i := 0; i < 6; i++ {
			got := rawPost(t, e.ts.URL, "/api/auth/reset-request", map[string]any{"login": login})
			last, retry = got.status, got.headers.Get("Retry-After")
		}
		if last != 429 || retry == "" {
			t.Errorf("%s: 6th request = %d retry=%q, want 429 with Retry-After", login, last, retry)
		}
	}
}

func TestResetMailBudgetPerUserIsSilent(t *testing.T) {
	e, _ := resetEnv(t)
	// five requests pass the ident limiter (5/hour); only three mails go out (reset-mail 3/hour)
	for i := 0; i < 5; i++ {
		if got := rawPost(t, e.ts.URL, "/api/auth/reset-request", map[string]any{"login": "bobby"}); got.status != 202 {
			t.Fatalf("request %d = %d", i, got.status)
		}
	}
	e.waitMails(t, 3)
	e.noMoreMails(t, 3)
}

func TestResetRequestWithoutMailIsAnInstanceLevelConflict(t *testing.T) {
	e := newMailEnv(t, mailOpts{})
	var eb errBody
	r := doJSON(t, "POST", e.ts.URL, "/api/auth/reset-request", "", map[string]any{"login": "owner"})
	decodeJSON(t, r, &eb)
	if r.StatusCode != 409 || eb.Error != "mail_unavailable" {
		t.Fatalf("= %d %s", r.StatusCode, eb.Error)
	}
	e.noMoreMails(t, 0)
}

func TestResetRequestPolicyOffKeepsStoredAddressesDormant(t *testing.T) {
	e, _ := resetEnv(t)
	setAuthSetting(t, e.db, "email_policy", "off")
	if got := rawPost(t, e.ts.URL, "/api/auth/reset-request", map[string]any{"login": "bobby"}); got.status != 202 {
		t.Fatal(got)
	}
	e.noMoreMails(t, 0)
}

type sqlNullInt struct{ v sql.NullInt64 }
