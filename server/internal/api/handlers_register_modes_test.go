package api_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"qinqin/internal/api"
	"qinqin/internal/auth"
)

// newLooseServer is a server whose sign-in client bucket is large enough
// for a test that registers dozens of times from 127.0.0.1.
func newLooseServer(t *testing.T) (*httptest.Server, *sql.DB) {
	t.Helper()
	p := api.DefaultAuthPolicy()
	p.Client.Burst = 5000
	return newPolicyServer(t, api.WithAuthPolicy(p))
}

type errBody struct {
	Error   string `json:"error"`
	Message string `json:"message"`
}

// regRaw posts a register body and returns status and the raw body bytes.
func regRaw(t *testing.T, ts *httptest.Server, bearer string, body map[string]any) (int, []byte) {
	t.Helper()
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest("POST", ts.URL+"/api/auth/register", bytes.NewReader(b))
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var buf bytes.Buffer
	buf.ReadFrom(resp.Body)
	return resp.StatusCode, buf.Bytes()
}

func regCode(t *testing.T, ts *httptest.Server, bearer string, body map[string]any) (int, string) {
	t.Helper()
	status, raw := regRaw(t, ts, bearer, body)
	var e errBody
	json.Unmarshal(raw, &e)
	return status, e.Error
}

func setAuthSetting(t *testing.T, sqlDB *sql.DB, column, value string) {
	t.Helper()
	if _, err := sqlDB.Exec(`UPDATE auth_settings SET `+column+` = ?`, value); err != nil {
		t.Fatal(err)
	}
}

func mkInvite(t *testing.T, sqlDB *sql.DB, maxUses int) string {
	t.Helper()
	var admin int64
	sqlDB.QueryRow(`SELECT id FROM users ORDER BY id LIMIT 1`).Scan(&admin)
	_, tok, err := auth.CreateInvite(context.Background(), sqlDB, admin, maxUses, nil, "")
	if err != nil {
		t.Fatal(err)
	}
	return tok
}

func TestBootstrapWorksInEveryMode(t *testing.T) {
	for _, mode := range []string{"closed", "invite", "open"} {
		ts, sqlDB := newLooseServer(t)
		setAuthSetting(t, sqlDB, "registration", mode)
		if st, code := regCode(t, ts, "", map[string]any{"username": "firstone", "password": "long-enough-pw"}); st != 201 {
			t.Errorf("%s: bootstrap = %d %s", mode, st, code)
		}
		var admin bool
		sqlDB.QueryRow(`SELECT admin FROM users WHERE username = 'firstone'`).Scan(&admin)
		if !admin {
			t.Errorf("%s: first user is not admin", mode)
		}
	}
}

func TestRegistrationModes(t *testing.T) {
	ts, sqlDB := newLooseServer(t)
	owner := registerUser(t, ts.URL, "owner", "")
	reg := func(extra map[string]any) (int, string) {
		body := map[string]any{"username": "newcomer", "password": "long-enough-pw"}
		for k, v := range extra {
			body[k] = v
		}
		return regCode(t, ts, "", body)
	}
	// closed (default)
	if st, code := reg(nil); st != 403 || code != "registration_closed" {
		t.Errorf("closed = %d %s", st, code)
	}
	// An invite does not work while closed either.
	setAuthSetting(t, sqlDB, "registration", "invite")
	good := mkInvite(t, sqlDB, 5)
	// Five kinds of bad invite, one body.
	expired := mkInvite(t, sqlDB, 5)
	sqlDB.Exec(`UPDATE invites SET expires_at = '2000-01-01T00:00:00Z' WHERE token_hash = ?`, tokHash(expired))
	usedUp := mkInvite(t, sqlDB, 1)
	sqlDB.Exec(`UPDATE invites SET uses = 1 WHERE token_hash = ?`, tokHash(usedUp))
	revoked := mkInvite(t, sqlDB, 5)
	sqlDB.Exec(`UPDATE invites SET revoked_at = '2020-01-01T00:00:00Z' WHERE token_hash = ?`, tokHash(revoked))
	var bodies [][]byte
	for _, extra := range []map[string]any{nil, {"invite": "unknown-token"}, {"invite": expired}, {"invite": usedUp}, {"invite": revoked}} {
		b, _ := json.Marshal(map[string]any{"username": "newcomer", "password": "long-enough-pw"})
		var m map[string]any
		json.Unmarshal(b, &m)
		for k, v := range extra {
			m[k] = v
		}
		st, raw := regRaw(t, ts, "", m)
		if st != 403 {
			t.Errorf("bad invite %v = %d", extra, st)
		}
		bodies = append(bodies, raw)
	}
	for i, b := range bodies {
		var e errBody
		json.Unmarshal(b, &e)
		if e.Error != "invite_invalid" || !bytes.Equal(b, bodies[0]) {
			t.Errorf("bad invite %d body %s differs from %s", i, b, bodies[0])
		}
	}
	if st, _ := reg(map[string]any{"invite": good}); st != 201 {
		t.Errorf("good invite = %d", st)
	}
	var uses int
	sqlDB.QueryRow(`SELECT uses FROM invites WHERE token_hash = ?`, tokHash(good)).Scan(&uses)
	if uses != 1 {
		t.Errorf("uses = %d, want 1", uses)
	}
	// open: anyone, and an invite is accepted too and counts a use.
	setAuthSetting(t, sqlDB, "registration", "open")
	if st, code := regCode(t, ts, "", map[string]any{"username": "walkin", "password": "long-enough-pw"}); st != 201 {
		t.Errorf("open = %d %s", st, code)
	}
	if st, _ := regCode(t, ts, "", map[string]any{"username": "withinvite", "password": "long-enough-pw", "invite": good}); st != 201 {
		t.Errorf("open + invite = %d", st)
	}
	sqlDB.QueryRow(`SELECT uses FROM invites WHERE token_hash = ?`, tokHash(good)).Scan(&uses)
	if uses != 2 {
		t.Errorf("uses after open+invite = %d, want 2", uses)
	}
	// open mode: a non-admin bearer registers by policy instead of getting 403.
	plain := registerUser(t, ts.URL, "plainuser", owner)
	if st, code := regCode(t, ts, plain, map[string]any{"username": "viabearer", "password": "long-enough-pw"}); st != 201 {
		t.Errorf("non-admin bearer in open mode = %d %s", st, code)
	}
	// closed again: the non-admin bearer is refused.
	setAuthSetting(t, sqlDB, "registration", "closed")
	if st, code := regCode(t, ts, plain, map[string]any{"username": "viabearer2", "password": "long-enough-pw"}); st != 403 || code != "registration_closed" {
		t.Errorf("non-admin bearer in closed mode = %d %s", st, code)
	}
	// Legacy path: an admin bearer creates a user without a forced change.
	if st, code := regCode(t, ts, owner, map[string]any{"username": "legacyone", "password": "long-enough-pw"}); st != 201 {
		t.Errorf("legacy admin register = %d %s", st, code)
	}
	var must bool
	sqlDB.QueryRow(`SELECT must_change_password FROM users WHERE username = 'legacyone'`).Scan(&must)
	if must {
		t.Error("legacy admin register forced a password change")
	}
}

func TestRegistrationEmailPolicy(t *testing.T) {
	ts, sqlDB := newLooseServer(t)
	registerUser(t, ts.URL, "owner", "")
	setAuthSetting(t, sqlDB, "registration", "open")
	reg := func(name string, email any) (int, string) {
		body := map[string]any{"username": name, "password": "long-enough-pw"}
		if email != nil {
			body["email"] = email
		}
		return regCode(t, ts, "", body)
	}
	if st, code := reg("mailer1", "a@example.org"); st != 422 || code != "email_disabled" {
		t.Errorf("off with email = %d %s", st, code)
	}
	setAuthSetting(t, sqlDB, "email_policy", "required")
	if st, code := reg("mailer1", nil); st != 422 || code != "email_required" {
		t.Errorf("required without = %d %s", st, code)
	}
	if st, code := reg("mailer1", "not-an-address"); st != 422 || code != "invalid_email" {
		t.Errorf("invalid = %d %s", st, code)
	}
	if st, code := reg("mailer1", "Mixed.Case@Example.org"); st != 201 {
		t.Errorf("required with = %d %s", st, code)
	}
	if st, code := reg("mailer2", "mixed.case@example.ORG"); st != 409 || code != "email_taken" {
		t.Errorf("taken (case-insensitive) = %d %s", st, code)
	}
	setAuthSetting(t, sqlDB, "email_policy", "optional")
	if st, code := reg("mailer3", nil); st != 201 {
		t.Errorf("optional without = %d %s", st, code)
	}
	var email string
	var verified sql.NullString
	sqlDB.QueryRow(`SELECT email, email_verified_at FROM users WHERE username = 'mailer1'`).Scan(&email, &verified)
	if email != "Mixed.Case@Example.org" || verified.Valid {
		t.Errorf("stored %q verified %v: the display form is kept and a self-entered address is unverified", email, verified)
	}
}

func TestInviteRaceOneUseOneUser(t *testing.T) {
	ts, sqlDB := newLooseServer(t)
	registerUser(t, ts.URL, "owner", "")
	setAuthSetting(t, sqlDB, "registration", "invite")
	tok := mkInvite(t, sqlDB, 1)
	var wg sync.WaitGroup
	var mu sync.Mutex
	got := map[int]int{}
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			st, _ := regCode(t, ts, "", map[string]any{"username": "racer" + string(rune('a'+i)), "password": "long-enough-pw", "invite": tok})
			mu.Lock()
			got[st]++
			mu.Unlock()
		}()
	}
	wg.Wait()
	if got[201] != 1 || got[403] != 7 {
		t.Errorf("statuses = %v, want one 201 and seven 403", got)
	}
	var uses, users int
	sqlDB.QueryRow(`SELECT uses FROM invites WHERE token_hash = ?`, tokHash(tok)).Scan(&uses)
	sqlDB.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&users)
	if uses != 1 || users != 2 {
		t.Errorf("uses = %d users = %d, want 1 and 2", uses, users)
	}
}

func TestInviteUseRollsBackOnUsernameClash(t *testing.T) {
	ts, sqlDB := newLooseServer(t)
	registerUser(t, ts.URL, "owner", "")
	setAuthSetting(t, sqlDB, "registration", "invite")
	tok := mkInvite(t, sqlDB, 3)
	// The pre-check catches a plain clash; force the insert-time clash by
	// calling the store directly with a taken name.
	_, err := auth.RegisterWithInvite(context.Background(), sqlDB, tok, auth.NewUser{Username: "owner", Hash: "x"})
	if err != auth.ErrUsernameTaken {
		t.Fatalf("err = %v, want ErrUsernameTaken", err)
	}
	var uses int
	sqlDB.QueryRow(`SELECT uses FROM invites WHERE token_hash = ?`, tokHash(tok)).Scan(&uses)
	if uses != 0 {
		t.Errorf("uses = %d after a failed registration, want 0", uses)
	}
	if st, code := regCode(t, ts, "", map[string]any{"username": "owner", "password": "long-enough-pw", "invite": tok}); st != 409 || code != "username_taken" {
		t.Errorf("clash over HTTP = %d %s", st, code)
	}
	sqlDB.QueryRow(`SELECT uses FROM invites WHERE token_hash = ?`, tokHash(tok)).Scan(&uses)
	if uses != 0 {
		t.Errorf("uses = %d after the HTTP clash, want 0", uses)
	}
}

// tokHash is the stored form of an invite, reset or session token.
func tokHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
