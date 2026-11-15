package auth_test

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"database/sql"
	"encoding/json"
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

	resp := register(t, ts, "", "alice", "secret")
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

	register(t, ts, "", "alice", "secret")

	// Without an admin token, registration is forbidden.
	resp := register(t, ts, "", "bob", "secret")
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
	aliceToken := loginToken(t, ts, "alice", "secret")
	if resp := register(t, ts, aliceToken, "bob", "secret"); resp.StatusCode != http.StatusCreated {
		t.Fatalf("admin register bob: status = %d, want %d", resp.StatusCode, http.StatusCreated)
	}
	bobToken := loginToken(t, ts, "bob", "secret")
	resp = register(t, ts, bobToken, "carol", "secret")
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("non-admin second register: status = %d, want %d", resp.StatusCode, http.StatusForbidden)
	}

	// An admin token may create further (non-admin) users.
	resp = register(t, ts, aliceToken, "carol", "secret")
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

	register(t, ts, "", "alice", "secret")

	// The stored password is an argon2id hash, never plaintext.
	var hash string
	if err := sqlDB.QueryRow(`SELECT hash FROM users WHERE username = ?`, "alice").Scan(&hash); err != nil {
		t.Fatalf("read stored hash: %v", err)
	}
	if !strings.HasPrefix(hash, "$argon2id$") {
		t.Errorf("stored hash = %q, want argon2id-encoded", hash)
	}

	token := loginToken(t, ts, "alice", "secret")

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

	register(t, ts, "", "alice", "secret")

	resp := login(t, ts, "alice", "wrong")
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("login wrong password: status = %d, want %d", resp.StatusCode, http.StatusUnauthorized)
	}
}

func TestHashVerify(t *testing.T) {
	h1, h2 := auth.Hash("secret"), auth.Hash("secret")
	if !strings.HasPrefix(h1, "$argon2id$") {
		t.Errorf("hash = %q, want argon2id-encoded", h1)
	}
	if h1 == h2 {
		t.Error("two hashes of the same password are identical, want per-password random salt")
	}
	if !auth.Verify(h1, "secret") {
		t.Error("Verify(hash, correct password) = false, want true")
	}
	if auth.Verify(h1, "wrong") {
		t.Error("Verify(hash, wrong password) = true, want false")
	}
	if auth.Verify("not a hash", "secret") {
		t.Error("Verify(malformed hash, ...) = true, want false")
	}
	if auth.Verify("$argon2id$v=19$m=65536,t=3,p=4$$", "secret") {
		t.Error("Verify(hash with empty salt and key) = true, want false")
	}
	if auth.Verify("$argon2id$v=19$m=65536,t=0,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "secret") {
		t.Error("Verify(hash with zero rounds) = true, want false")
	}
}

func TestRegisterDuplicateUsername(t *testing.T) {
	ts, sqlDB := newServer(t)

	if resp := register(t, ts, "", "alice", "secret"); resp.StatusCode != http.StatusCreated {
		t.Fatalf("register alice: status = %d, want %d", resp.StatusCode, http.StatusCreated)
	}
	token := loginToken(t, ts, "alice", "secret")
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

	u, err := auth.CreateFirstUser(ctx, sqlDB, "alice", "secret")
	if err != nil || !u.Admin || u.Username != "alice" {
		t.Fatalf("first CreateFirstUser = %+v, %v; want admin alice", u, err)
	}
	if _, err := auth.CreateFirstUser(ctx, sqlDB, "bob", "secret"); !errors.Is(err, auth.ErrNotFirst) {
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
	ts, sqlDB := newServer(t)

	const racers = 8
	statuses := make([]int, racers)
	var wg sync.WaitGroup
	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			encoded, _ := json.Marshal(credentials{Username: fmt.Sprintf("user%d", i), Password: "secret"})
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

// TestLoginUnknownUserCostsAnArgonRun pins the timing equalisation: an
// unknown username must spend about as long as a wrong password.
func TestLoginUnknownUserCostsAnArgonRun(t *testing.T) {
	_, sqlDB := newServer(t)
	ctx := context.Background()
	if _, err := auth.CreateUser(ctx, sqlDB, "alice", "secret", true); err != nil {
		t.Fatalf("create user: %v", err)
	}
	fastest := func(username string) time.Duration {
		best := time.Hour
		for i := 0; i < 3; i++ {
			start := time.Now()
			if _, err := auth.Login(ctx, sqlDB, username, "wrong"); !errors.Is(err, auth.ErrBadCredentials) {
				t.Fatalf("login %q err = %v, want ErrBadCredentials", username, err)
			}
			if d := time.Since(start); d < best {
				best = d
			}
		}
		return best
	}
	known, unknown := fastest("alice"), fastest("nobody")
	if unknown < known/2 {
		t.Errorf("unknown-user login took %v vs %v for a wrong password: username enumeration by timing", unknown, known)
	}
}
