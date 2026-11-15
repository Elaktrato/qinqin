package auth_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"qinqin/internal/api"
	"qinqin/internal/auth"
	"qinqin/internal/db"
)

// credentials is the request body of /api/auth/register and /api/auth/login.
type credentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// userJSON mirrors the API's serialized model.User.
type userJSON struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
	Admin    bool   `json:"admin"`
}

// newServer opens a fresh migrated database and serves the API on it.
func newServer(t *testing.T) (*httptest.Server, *sql.DB) {
	t.Helper()
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	ts := httptest.NewServer(api.New(sqlDB, t.TempDir(), nil))
	t.Cleanup(ts.Close)
	return ts, sqlDB
}

// post posts body as JSON (with an optional bearer token) and returns the
// response with its body still open.
func post(t *testing.T, url, bearer string, body any) *http.Response {
	t.Helper()
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(encoded))
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST %s: %v", url, err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}

// register registers a user via the API and returns the response.
func register(t *testing.T, ts *httptest.Server, bearer, username, password string) *http.Response {
	t.Helper()
	return post(t, ts.URL+"/api/auth/register", bearer, credentials{Username: username, Password: password})
}

// mustRegister registers a user and fails the test unless it answers 201.
func mustRegister(t *testing.T, ts *httptest.Server, bearer, username, password string) {
	t.Helper()
	if resp := register(t, ts, bearer, username, password); resp.StatusCode != http.StatusCreated {
		t.Fatalf("register %q: status = %d, want %d", username, resp.StatusCode, http.StatusCreated)
	}
}

// login logs in via the API and returns the response.
func login(t *testing.T, ts *httptest.Server, username, password string) *http.Response {
	t.Helper()
	return post(t, ts.URL+"/api/auth/login", "", credentials{Username: username, Password: password})
}

// loginToken logs in and returns the session token.
func loginToken(t *testing.T, ts *httptest.Server, username, password string) string {
	t.Helper()
	resp := login(t, ts, username, password)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("login %q: status = %d, want %d", username, resp.StatusCode, http.StatusOK)
	}
	var body struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode login response: %v", err)
	}
	if body.Token == "" {
		t.Fatal("login response has empty token")
	}
	return body.Token
}

// me fetches /api/auth/me with an optional bearer token and returns the
// response.
func me(t *testing.T, ts *httptest.Server, bearer string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, ts.URL+"/api/auth/me", nil)
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /api/auth/me: %v", err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}

func TestFirstUserBecomesAdminNoAuth(t *testing.T) {
	ts, _ := newServer(t)

	resp := register(t, ts, "", "alice", "secret-pass-1")
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("register first user: status = %d, want %d", resp.StatusCode, http.StatusCreated)
	}
	var u userJSON
	if err := json.NewDecoder(resp.Body).Decode(&u); err != nil {
		t.Fatalf("decode register response: %v", err)
	}
	if u.Username != "alice" {
		t.Errorf("username = %q, want %q", u.Username, "alice")
	}
	if !u.Admin {
		t.Error("first user is not admin, want admin")
	}
	if u.ID != 1 {
		t.Errorf("id = %d, want 1", u.ID)
	}
}

func TestSecondRegisterRejectedWithoutAdmin(t *testing.T) {
	ts, sqlDB := newServer(t)

	mustRegister(t, ts, "", "alice", "secret-pass-1")

	// Without an admin token, registration is forbidden.
	resp := register(t, ts, "", "bob", "secret-pass-1")
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("anonymous second register: status = %d, want %d", resp.StatusCode, http.StatusForbidden)
	}
	var count int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&count); err != nil {
		t.Fatalf("count users: %v", err)
	}
	if count != 1 {
		t.Errorf("users = %d after rejected register, want 1", count)
	}

	// A non-admin token is forbidden too.
	aliceToken := loginToken(t, ts, "alice", "secret-pass-1")
	if resp := register(t, ts, aliceToken, "bob", "secret-pass-1"); resp.StatusCode != http.StatusCreated {
		t.Fatalf("admin register bob: status = %d, want %d", resp.StatusCode, http.StatusCreated)
	}
	bobToken := loginToken(t, ts, "bob", "secret-pass-1")
	resp = register(t, ts, bobToken, "carol", "secret-pass-1")
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("non-admin second register: status = %d, want %d", resp.StatusCode, http.StatusForbidden)
	}

	// An admin token may create further (non-admin) users.
	resp = register(t, ts, aliceToken, "carol", "secret-pass-1")
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("admin register: status = %d, want %d", resp.StatusCode, http.StatusCreated)
	}
	var u userJSON
	if err := json.NewDecoder(resp.Body).Decode(&u); err != nil {
		t.Fatalf("decode register response: %v", err)
	}
	if u.Admin {
		t.Error("admin-created user is admin, want regular user")
	}
}

func TestRegisterLoginMe(t *testing.T) {
	ts, sqlDB := newServer(t)

	mustRegister(t, ts, "", "alice", "secret-pass-1")

	// The stored password is an argon2id hash, never plaintext.
	var hash string
	if err := sqlDB.QueryRow(`SELECT hash FROM users WHERE username = ?`, "alice").Scan(&hash); err != nil {
		t.Fatalf("read stored hash: %v", err)
	}
	if !strings.HasPrefix(hash, "$argon2id$") {
		t.Errorf("stored hash = %q, want argon2id-encoded", hash)
	}

	token := loginToken(t, ts, "alice", "secret-pass-1")

	resp := me(t, ts, token)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /api/auth/me: status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	var u userJSON
	if err := json.NewDecoder(resp.Body).Decode(&u); err != nil {
		t.Fatalf("decode me response: %v", err)
	}
	if u.Username != "alice" || !u.Admin || u.ID != 1 {
		t.Errorf("me = %+v, want alice admin id 1", u)
	}

	resp = me(t, ts, "")
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("me without token: status = %d, want %d", resp.StatusCode, http.StatusUnauthorized)
	}
}

func TestLoginWrongPassword(t *testing.T) {
	ts, _ := newServer(t)

	mustRegister(t, ts, "", "alice", "secret-pass-1")

	resp := login(t, ts, "alice", "wrong")
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("login wrong password: status = %d, want %d", resp.StatusCode, http.StatusUnauthorized)
	}
}

func TestHashVerify(t *testing.T) {
	h1, h2 := auth.Hash("secret-pass-1"), auth.Hash("secret-pass-1")
	if !strings.HasPrefix(h1, "$argon2id$") {
		t.Errorf("hash = %q, want argon2id-encoded", h1)
	}
	if h1 == h2 {
		t.Error("two hashes of the same password are identical, want per-password random salt")
	}
	if !auth.Verify(h1, "secret-pass-1") {
		t.Error("Verify(hash, correct password) = false, want true")
	}
	if auth.Verify(h1, "wrong") {
		t.Error("Verify(hash, wrong password) = true, want false")
	}
	if auth.Verify("not a hash", "secret-pass-1") {
		t.Error("Verify(malformed hash, ...) = true, want false")
	}
	if auth.Verify("$argon2id$v=19$m=65536,t=3,p=4$$", "secret-pass-1") {
		t.Error("Verify(hash with empty salt and key) = true, want false")
	}
	if auth.Verify("$argon2id$v=19$m=65536,t=0,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "secret-pass-1") {
		t.Error("Verify(hash with zero rounds) = true, want false")
	}
}

func TestRegisterDuplicateUsername(t *testing.T) {
	ts, sqlDB := newServer(t)

	if resp := register(t, ts, "", "alice", "secret-pass-1"); resp.StatusCode != http.StatusCreated {
		t.Fatalf("register alice: status = %d, want %d", resp.StatusCode, http.StatusCreated)
	}
	token := loginToken(t, ts, "alice", "secret-pass-1")
	resp := register(t, ts, token, "alice", "other")
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("duplicate username: status = %d, want %d", resp.StatusCode, http.StatusConflict)
	}
	var count int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&count); err != nil || count != 1 {
		t.Errorf("users = %d (err %v) after duplicate, want 1", count, err)
	}
}

func TestCreateFirstUserOnlyWhenEmpty(t *testing.T) {
	_, sqlDB := newServer(t)
	ctx := context.Background()

	u, err := auth.CreateFirstUser(ctx, sqlDB, "alice", "secret-pass-1")
	if err != nil || !u.Admin || u.Username != "alice" {
		t.Fatalf("first CreateFirstUser = %+v, %v; want admin alice", u, err)
	}
	if _, err := auth.CreateFirstUser(ctx, sqlDB, "bob", "secret-pass-1"); !errors.Is(err, auth.ErrNotFirst) {
		t.Errorf("second CreateFirstUser err = %v, want ErrNotFirst", err)
	}
	var count int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&count); err != nil || count != 1 {
		t.Errorf("users = %d (err %v), want 1", count, err)
	}
}

// TestConcurrentFirstRegisterCreatesOneAdmin races first-ever
// registrations: exactly one wins and becomes the only admin.
func TestConcurrentFirstRegisterCreatesOneAdmin(t *testing.T) {
	// Eight racers all hash: give the gate room so none answers 503.
	p := api.DefaultAuthPolicy()
	p.Hashes, p.HashWait = 8, 30*time.Second
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	ts := httptest.NewServer(api.New(sqlDB, t.TempDir(), nil, api.WithAuthPolicy(p)))
	t.Cleanup(ts.Close)

	const racers = 8
	statuses := make([]int, racers)
	var wg sync.WaitGroup
	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			encoded, _ := json.Marshal(credentials{Username: fmt.Sprintf("user%d", i), Password: "secret-pass-1"})
			resp, err := http.Post(ts.URL+"/api/auth/register", "application/json", bytes.NewReader(encoded))
			if err != nil {
				return
			}
			resp.Body.Close()
			statuses[i] = resp.StatusCode
		}()
	}
	wg.Wait()

	created := 0
	for _, s := range statuses {
		if s == http.StatusCreated {
			created++
		} else if s != http.StatusForbidden {
			t.Errorf("racer status = %d, want 201 or 403", s)
		}
	}
	if created != 1 {
		t.Errorf("%d registrations created users, want exactly 1 (statuses %v)", created, statuses)
	}
	var users, admins int
	if err := sqlDB.QueryRow(`SELECT COUNT(*), COALESCE(SUM(admin), 0) FROM users`).Scan(&users, &admins); err != nil {
		t.Fatalf("count users: %v", err)
	}
	if users != 1 || admins != 1 {
		t.Errorf("users = %d, admins = %d, want 1 and 1", users, admins)
	}
}

// TestLoginUnknownUserStillVerifies pins the timing equalisation at its
// seam instead of measuring time: an unknown username must run the password
// verifier once, against a well-formed hash, exactly like a wrong password.
func TestLoginUnknownUserStillVerifies(t *testing.T) {
	_, sqlDB := newServer(t)
	ctx := context.Background()
	if _, err := auth.CreateUser(ctx, sqlDB, "alice", "secret-pass-1", true); err != nil {
		t.Fatalf("create user: %v", err)
	}
	var hashes []string
	restore := auth.SetVerifierForTest(func(hash, password string) bool {
		hashes = append(hashes, hash)
		return auth.Verify(hash, password)
	})
	defer restore()

	for _, username := range []string{"alice", "nobody"} {
		hashes = nil
		if _, err := auth.Login(ctx, sqlDB, username, "wrong"); !errors.Is(err, auth.ErrBadCredentials) {
			t.Fatalf("login %q err = %v, want ErrBadCredentials", username, err)
		}
		if len(hashes) != 1 || !strings.HasPrefix(hashes[0], "$argon2id$") {
			t.Errorf("login %q verified %v, want exactly one argon2id hash", username, hashes)
		}
	}
}

func TestRegisterAppliesPolicy(t *testing.T) {
	ts, sqlDB := newServer(t)
	cases := []struct {
		user, pw string
		status   int
		code     string
	}{
		{"alice", "short", 422, "weak_password"},
		{"alice", "alice", 422, "weak_password"},
		{"a@b.example", "long-enough-pw", 422, "invalid_username"},
		{"ab", "long-enough-pw", 422, "invalid_username"},
	}
	for _, c := range cases {
		resp := register(t, ts, "", c.user, c.pw)
		if resp.StatusCode != c.status {
			t.Errorf("%q/%q: status %d, want %d", c.user, c.pw, resp.StatusCode, c.status)
			continue
		}
		var body struct{ Error, Message string }
		json.NewDecoder(resp.Body).Decode(&body)
		if body.Error != c.code || body.Message == "" {
			t.Errorf("%q/%q: body %+v, want code %s with a message", c.user, c.pw, body, c.code)
		}
	}
	var n int
	sqlDB.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&n)
	if n != 0 {
		t.Errorf("users = %d after rejected registrations", n)
	}
	if resp := register(t, ts, "", "alice", "long-enough-pw"); resp.StatusCode != 201 {
		t.Fatalf("valid register: %d", resp.StatusCode)
	}
	token := loginToken(t, ts, "alice", "long-enough-pw")
	if resp := register(t, ts, token, "ALICE", "long-enough-pw"); resp.StatusCode != 409 {
		t.Errorf("case-variant duplicate: %d, want 409", resp.StatusCode)
	}
}

// rawLogin posts a login body and decodes the answer.
func rawLogin(t *testing.T, ts *httptest.Server, ua string, body map[string]any) (int, map[string]any) {
	t.Helper()
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/auth/login", bytes.NewReader(b))
	if ua != "" {
		req.Header.Set("User-Agent", ua)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Errorf("login answer content type %q, want JSON", ct)
	}
	var out map[string]any
	json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out
}

func TestLoginStatusesAndDevice(t *testing.T) {
	ts, sqlDB := newServer(t)
	mustRegister(t, ts, "", "alice", "secret-pass-1")

	code, out := rawLogin(t, ts, "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
		map[string]any{"username": "alice", "password": "secret-pass-1"})
	user, _ := out["user"].(map[string]any)
	if code != 200 || out["status"] != "ok" || len(out["token"].(string)) != 64 || user["username"] != "alice" {
		t.Fatalf("login = %d %v", code, out)
	}
	if user["mustChangePassword"] != false || user["emailVerified"] != false || user["email"] != nil || user["createdAt"] == "" {
		t.Errorf("user object = %v", user)
	}
	var device string
	sqlDB.QueryRow(`SELECT device FROM sessions ORDER BY id DESC LIMIT 1`).Scan(&device)
	if device != "Firefox on Linux" {
		t.Errorf("device from User-Agent = %q", device)
	}

	code, out = rawLogin(t, ts, "curl/8", map[string]any{"username": "alice", "password": "secret-pass-1", "deviceName": "qinqin Android \x07· Pixel 8"})
	if code != 200 {
		t.Fatalf("login with deviceName = %d", code)
	}
	sqlDB.QueryRow(`SELECT device FROM sessions ORDER BY id DESC LIMIT 1`).Scan(&device)
	if device != "qinqin Android · Pixel 8" {
		t.Errorf("device from deviceName = %q", device)
	}

	// A forced change still signs in, with its own status word.
	sqlDB.Exec(`UPDATE users SET must_change_password = 1, must_change_set_at = '2000-01-01T00:00:00Z' WHERE username = 'alice'`)
	code, out = rawLogin(t, ts, "", map[string]any{"username": "alice", "password": "secret-pass-1"})
	user, _ = out["user"].(map[string]any)
	if code != 200 || out["status"] != "password_change_required" || out["token"] == "" || user["mustChangePassword"] != true {
		t.Errorf("forced-change login = %d %v", code, out)
	}
}

func TestLoginDisabledAnswersOnlyAfterTheCorrectPassword(t *testing.T) {
	ts, sqlDB := newServer(t)
	mustRegister(t, ts, "", "alice", "secret-pass-1")
	sqlDB.Exec(`UPDATE users SET disabled_at = '2026-01-01T00:00:00Z'`)

	code, out := rawLogin(t, ts, "", map[string]any{"username": "alice", "password": "wrong-password"})
	if code != 401 || out["error"] != "bad_credentials" {
		t.Errorf("disabled + wrong password = %d %v, want 401 bad_credentials", code, out)
	}
	code, out = rawLogin(t, ts, "", map[string]any{"username": "alice", "password": "secret-pass-1"})
	if code != 403 || out["error"] != "account_disabled" || out["message"] == "" || out["token"] != nil {
		t.Errorf("disabled + right password = %d %v, want 403 account_disabled and no token", code, out)
	}
	var n int
	sqlDB.QueryRow(`SELECT COUNT(*) FROM sessions`).Scan(&n)
	if n != 0 {
		t.Errorf("a disabled login created %d sessions", n)
	}
}

func TestLoginRunsExactlyOneArgon2ForEveryOutcome(t *testing.T) {
	_, sqlDB := newServer(t)
	ctx := context.Background()
	if _, err := auth.CreateUser(ctx, sqlDB, "alice", "secret-pass-1", false); err != nil {
		t.Fatal(err)
	}
	if _, err := auth.CreateUser(ctx, sqlDB, "dora", "secret-pass-1", false); err != nil {
		t.Fatal(err)
	}
	sqlDB.Exec(`UPDATE users SET disabled_at = 't' WHERE username = 'dora'`)
	calls := 0
	restore := auth.SetVerifierForTest(func(h, p string) bool { calls++; return auth.Verify(h, p) })
	defer restore()
	cases := []struct {
		user, pw string
		want     error
	}{
		{"nobody", "whatever-pw", auth.ErrBadCredentials},
		{"alice", "wrong-pw-here", auth.ErrBadCredentials},
		{"dora", "wrong-pw-here", auth.ErrBadCredentials},
		{"dora", "secret-pass-1", auth.ErrAccountDisabled},
		{"alice", "secret-pass-1", nil},
	}
	for _, c := range cases {
		calls = 0
		_, err := auth.LoginWith(ctx, sqlDB, c.user, c.pw, auth.LoginOptions{})
		if !errors.Is(err, c.want) || (c.want == nil && err != nil) {
			t.Errorf("%s/%s: err = %v, want %v", c.user, c.pw, err, c.want)
		}
		if calls != 1 {
			t.Errorf("%s/%s: %d verifications, want exactly 1", c.user, c.pw, calls)
		}
	}
}

func TestRegisterAndLoginErrorsAreJSON(t *testing.T) {
	ts, _ := newServer(t)
	mustRegister(t, ts, "", "alice", "secret-pass-1")
	for name, c := range map[string]struct {
		path string
		body string
	}{
		"login bad json":     {"/api/auth/login", "{"},
		"login empty":        {"/api/auth/login", `{"username":"","password":""}`},
		"login wrong":        {"/api/auth/login", `{"username":"alice","password":"nope-nope-1"}`},
		"register bad json":  {"/api/auth/register", "{"},
		"register anonymous": {"/api/auth/register", `{"username":"bob1","password":"secret-pass-2"}`},
	} {
		resp, err := http.Post(ts.URL+c.path, "application/json", strings.NewReader(c.body))
		if err != nil {
			t.Fatal(err)
		}
		var e struct{ Error, Message string }
		json.NewDecoder(resp.Body).Decode(&e)
		resp.Body.Close()
		if !strings.HasPrefix(resp.Header.Get("Content-Type"), "application/json") || e.Error == "" || e.Message == "" {
			t.Errorf("%s: %d %q %+v, want a JSON {error,message}", name, resp.StatusCode, resp.Header.Get("Content-Type"), e)
		}
	}
}

func TestMeReturnsTheWholeUser(t *testing.T) {
	ts, _ := newServer(t)
	mustRegister(t, ts, "", "alice", "secret-pass-1")
	token := loginToken(t, ts, "alice", "secret-pass-1")
	resp := me(t, ts, token)
	var u map[string]any
	json.NewDecoder(resp.Body).Decode(&u)
	for _, k := range []string{"id", "username", "admin", "email", "emailVerified", "mustChangePassword", "createdAt", "restriction"} {
		if _, ok := u[k]; !ok {
			t.Errorf("me lacks %q: %v", k, u)
		}
	}
	if resp := me(t, ts, "no-such-token"); resp.StatusCode != 401 {
		t.Errorf("unknown token = %d", resp.StatusCode)
	}
}

func TestLogoutEndsOnlyTheCurrentSession(t *testing.T) {
	ts, sqlDB := newServer(t)
	mustRegister(t, ts, "", "alice", "secret-pass-1")
	phone := loginToken(t, ts, "alice", "secret-pass-1")
	laptop := loginToken(t, ts, "alice", "secret-pass-1")

	if resp := post(t, ts.URL+"/api/auth/logout", "", struct{}{}); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("anonymous logout = %d, want 401", resp.StatusCode)
	}
	resp := post(t, ts.URL+"/api/auth/logout", phone, struct{}{})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("logout = %d, want 204", resp.StatusCode)
	}
	if got := me(t, ts, phone).StatusCode; got != http.StatusUnauthorized {
		t.Errorf("token after logout: me = %d, want 401", got)
	}
	if got := me(t, ts, laptop).StatusCode; got != http.StatusOK {
		t.Errorf("other session after logout: me = %d, want 200", got)
	}
	var n int
	sqlDB.QueryRow(`SELECT COUNT(*) FROM sessions`).Scan(&n)
	if n != 1 {
		t.Errorf("sessions left = %d, want 1", n)
	}
}

func TestLogoutWorksForRestrictedSessions(t *testing.T) {
	ts, sqlDB := newServer(t)
	mustRegister(t, ts, "", "alice", "secret-pass-1")
	sqlDB.Exec(`UPDATE users SET must_change_password = 1`)
	tok := loginToken(t, ts, "alice", "secret-pass-1")
	if resp := post(t, ts.URL+"/api/auth/logout", tok, struct{}{}); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("logout of a restricted session = %d, want 204 (it is the way out)", resp.StatusCode)
	}
	if got := me(t, ts, tok).StatusCode; got != http.StatusUnauthorized {
		t.Errorf("me after logout = %d", got)
	}
}
