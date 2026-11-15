package api_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"qinqin/internal/api"
	"qinqin/internal/auth"
	"qinqin/internal/db"
	"qinqin/internal/model"
	"qinqin/internal/ratelimit"
)

// limitClock is a settable test clock.
type limitClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *limitClock) now() time.Time { c.mu.Lock(); defer c.mu.Unlock(); return c.t }
func (c *limitClock) advance(d time.Duration) {
	c.mu.Lock()
	c.t = c.t.Add(d)
	c.mu.Unlock()
}

// fastLogin is a login hook without argon2: "right" is the only good
// password; it counts every call.
type fastLogin struct{ calls atomic.Int64 }

func (f *fastLogin) login(ctx context.Context, _ *sql.DB, user, pass string) (string, error) {
	f.calls.Add(1)
	if pass == "right" {
		return "tok_example", nil
	}
	return "", auth.ErrBadCredentials
}

// newLimitServer serves the API on a fresh database. Requests from the
// 127.0.0.1 test peer are trusted proxies, so X-Forwarded-For picks the
// client address.
func newLimitServer(t *testing.T, opts ...api.Option) (*httptest.Server, *sql.DB, *limitClock) {
	t.Helper()
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	clk := &limitClock{t: time.Date(2026, 11, 15, 12, 0, 0, 0, time.UTC)}
	opts = append([]api.Option{api.WithClock(clk.now)}, opts...)
	ts := httptest.NewServer(api.New(sqlDB, t.TempDir(), nil, opts...))
	t.Cleanup(ts.Close)
	return ts, sqlDB, clk
}

type authResp struct {
	Status     int
	RetryAfter string
	Body       string
	Err, Msg   string
}

// authCall posts JSON {username,password} to path from the client address
// xff and returns status, header and the decoded error body.
func authCall(t *testing.T, ts *httptest.Server, path, xff, user, pass string) authResp {
	t.Helper()
	b, _ := json.Marshal(map[string]string{"username": user, "password": pass})
	return authRaw(t, ts, path, xff, "", bytes.NewReader(b))
}

func authRaw(t *testing.T, ts *httptest.Server, path, xff, bearer string, body io.Reader) authResp {
	t.Helper()
	req, _ := http.NewRequest(http.MethodPost, ts.URL+path, body)
	if xff != "" {
		req.Header.Set("X-Forwarded-For", xff)
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST %s: %v", path, err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	out := authResp{Status: resp.StatusCode, RetryAfter: resp.Header.Get("Retry-After"), Body: string(raw)}
	var j struct{ Error, Message string }
	if json.Unmarshal(raw, &j) == nil {
		out.Err, out.Msg = j.Error, j.Message
	}
	if ct := resp.Header.Get("Content-Type"); resp.StatusCode >= 400 && !strings.HasPrefix(ct, "application/json") {
		t.Errorf("%s status %d content type %q, want JSON", path, resp.StatusCode, ct)
	}
	return out
}

func login1(t *testing.T, ts *httptest.Server, xff, user, pass string) authResp {
	t.Helper()
	return authCall(t, ts, "/api/auth/login", xff, user, pass)
}

func TestAuthLimitClientBucket(t *testing.T) {
	h := &fastLogin{}
	ts, _, _ := newLimitServer(t, api.WithAuthHooks(api.AuthHooks{Login: h.login}))
	for i := 0; i < 10; i++ {
		r := login1(t, ts, "198.51.100.1", fmt.Sprintf("user%d", i), "wrong")
		if r.Status != 401 || r.Err != "bad_credentials" {
			t.Fatalf("attempt %d: %d %q, want 401 bad_credentials", i+1, r.Status, r.Err)
		}
	}
	r := login1(t, ts, "198.51.100.1", "user11", "wrong")
	if r.Status != 429 || r.Err != "rate_limited" || r.RetryAfter != "6" ||
		r.Msg != "Too many sign-in attempts. Try again in 6 seconds." {
		t.Fatalf("11th = %+v, want 429 rate_limited, Retry-After 6", r)
	}
	if got := h.calls.Load(); got != 10 {
		t.Fatalf("hook calls = %d, want 10 (the refused one never hashed)", got)
	}
	// another client is unaffected
	if r := login1(t, ts, "198.51.100.2", "user1", "wrong"); r.Status != 401 {
		t.Fatalf("other client = %d", r.Status)
	}
}

func TestAuthLimitClientIPSources(t *testing.T) {
	h := &fastLogin{}
	ts, _, _ := newLimitServer(t, api.WithAuthHooks(api.AuthHooks{Login: h.login}))
	for i := 0; i < 10; i++ {
		login1(t, ts, "198.51.100.1", fmt.Sprintf("u%d", i), "wrong")
	}
	// a forged leading entry does not give a fresh bucket: the right-most
	// untrusted address counts
	if r := login1(t, ts, "9.9.9.9, 198.51.100.1", "x", "wrong"); r.Status != 429 {
		t.Fatalf("forged left entry = %d, want 429", r.Status)
	}
}

func TestAuthLimitTrustedProxiesNone(t *testing.T) {
	h := &fastLogin{}
	ts, _, _ := newLimitServer(t, api.WithAuthHooks(api.AuthHooks{Login: h.login}), api.WithTrustedProxies([]netip.Prefix{}))
	for i := 0; i < 10; i++ {
		login1(t, ts, fmt.Sprintf("198.51.100.%d", i+1), fmt.Sprintf("u%d", i), "wrong")
	}
	if r := login1(t, ts, "198.51.100.99", "x", "wrong"); r.Status != 429 {
		t.Fatalf("header must be ignored with none: %d", r.Status)
	}
}

func TestAuthLimitPairLockBeforeVerify(t *testing.T) {
	h := &fastLogin{}
	ts, _, clk := newLimitServer(t, api.WithAuthHooks(api.AuthHooks{Login: h.login}))
	for i := 1; i <= 6; i++ {
		if r := login1(t, ts, "198.51.100.1", "owner", "wrong"); r.Status != 401 {
			t.Fatalf("failure %d = %d, want 401", i, r.Status)
		}
	}
	before := h.calls.Load()
	r := login1(t, ts, "198.51.100.1", "owner", "right")
	if r.Status != 429 || r.RetryAfter != "60" {
		t.Fatalf("right password during lock = %+v, want 429 Retry-After 60", r)
	}
	if h.calls.Load() != before {
		t.Fatal("a locked pair still ran the hash")
	}
	// the lock is per pair: the same username from another client is fine
	if r := login1(t, ts, "198.51.100.2", "owner", "right"); r.Status != 200 {
		t.Fatalf("other client = %d, want 200", r.Status)
	}
	clk.advance(61 * time.Second)
	if r := login1(t, ts, "198.51.100.1", "owner", "right"); r.Status != 200 || !strings.Contains(r.Body, "tok_example") {
		t.Fatalf("after the lock = %+v, want 200", r)
	}
	// the failure count is cleared: five more failures are free again
	clk.advance(time.Minute) // refill L1
	for i := 0; i < 6; i++ {
		if r := login1(t, ts, "198.51.100.1", "owner", "wrong"); r.Status != 401 {
			t.Fatalf("post-success failure %d = %d", i+1, r.Status)
		}
	}
}

func TestAuthLimitAccountAcrossClients(t *testing.T) {
	h := &fastLogin{}
	ts, _, _ := newLimitServer(t, api.WithAuthHooks(api.AuthHooks{Login: h.login}))
	// the owner's usual address becomes known-good
	if r := login1(t, ts, "203.0.113.50", "owner", "right"); r.Status != 200 {
		t.Fatalf("owner login = %d", r.Status)
	}
	for i := 0; i < 20; i++ {
		if r := login1(t, ts, fmt.Sprintf("198.51.100.%d", i+1), "owner", "wrong"); r.Status != 401 {
			t.Fatalf("distributed failure %d = %d, want 401", i+1, r.Status)
		}
	}
	r := login1(t, ts, "198.51.100.200", "owner", "wrong")
	if r.Status != 429 || r.Err != "rate_limited" {
		t.Fatalf("21st address = %+v, want 429", r)
	}
	before := h.calls.Load()
	if r := login1(t, ts, "198.51.100.201", "owner", "right"); r.Status != 429 {
		t.Fatalf("new address with the right password = %d, want 429 (never verified)", r.Status)
	}
	if h.calls.Load() != before {
		t.Fatal("a refused account still hashed")
	}
	if r := login1(t, ts, "203.0.113.50", "owner", "right"); r.Status != 200 {
		t.Fatalf("known-good address = %+v, want 200", r)
	}
}

func TestAuthLimitConcurrentFailuresBounded(t *testing.T) {
	h := &fastLogin{}
	ts, _, _ := newLimitServer(t, api.WithAuthHooks(api.AuthHooks{Login: h.login}))
	var wg sync.WaitGroup
	var ok401, ok429 atomic.Int64
	for i := 0; i < 30; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r := login1(t, ts, fmt.Sprintf("198.51.100.%d", i+1), "owner", "wrong")
			switch r.Status {
			case 401:
				ok401.Add(1)
			case 429:
				ok429.Add(1)
			default:
				t.Errorf("status %d", r.Status)
			}
		}()
	}
	wg.Wait()
	if got := h.calls.Load(); got > 20 {
		t.Fatalf("%d hook calls for one username, want at most 20", got)
	}
	if ok401.Load()+ok429.Load() != 30 || ok429.Load() < 10 {
		t.Fatalf("401=%d 429=%d", ok401.Load(), ok429.Load())
	}
}

func TestAuthLimitConcurrentPairBounded(t *testing.T) {
	h := &fastLogin{}
	ts, _, _ := newLimitServer(t, api.WithAuthHooks(api.AuthHooks{Login: h.login}))
	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); login1(t, ts, "198.51.100.1", "owner", "wrong") }()
	}
	wg.Wait()
	if got := h.calls.Load(); got > 6 {
		t.Fatalf("%d attempts for one pair, want at most 6 before the lock", got)
	}
}

func TestAuthLimitSameForUnknownUser(t *testing.T) {
	ts, sqlDB, _ := newLimitServer(t)
	if _, err := auth.CreateUser(context.Background(), sqlDB, "alice", "secret-pw", false); err != nil {
		t.Fatal(err)
	}
	run := func(user, xff string) []authResp {
		var out []authResp
		for i := 0; i < 8; i++ {
			out = append(out, login1(t, ts, xff, user, "wrong"))
		}
		return out
	}
	known, unknown := run("alice", "198.51.100.1"), run("nobody", "198.51.100.2")
	for i := range known {
		k, u := known[i], unknown[i]
		if k.Status != u.Status || k.Body != u.Body || k.RetryAfter != u.RetryAfter {
			t.Fatalf("attempt %d differs: known %+v unknown %+v", i+1, k, u)
		}
	}
	if known[0].Status != 401 || known[6].Status != 429 {
		t.Fatalf("sequence = %d ... %d", known[0].Status, known[6].Status)
	}
}

func TestAuthLimitHashGateBusy(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	hook := func(ctx context.Context, _ *sql.DB, user, pass string) (string, error) {
		entered <- struct{}{}
		<-release
		return "", auth.ErrBadCredentials
	}
	p := api.DefaultAuthPolicy()
	p.Hashes, p.HashWait = 1, 50*time.Millisecond
	ts, _, _ := newLimitServer(t, api.WithAuthPolicy(p), api.WithAuthHooks(api.AuthHooks{Login: hook}))
	done := make(chan authResp)
	go func() { done <- login1(t, ts, "198.51.100.1", "a", "x") }()
	<-entered
	r := login1(t, ts, "198.51.100.2", "b", "x")
	if r.Status != 503 || r.Err != "busy" || r.RetryAfter != "2" {
		t.Fatalf("second request = %+v, want 503 busy Retry-After 2", r)
	}
	close(release)
	if first := <-done; first.Status != 401 {
		t.Fatalf("first = %d", first.Status)
	}
}

func TestAuthLimitNonCredentialErrorNotCounted(t *testing.T) {
	var boom atomic.Bool
	boom.Store(true)
	hook := func(ctx context.Context, _ *sql.DB, user, pass string) (string, error) {
		if boom.Load() {
			return "", errors.New("disk on fire")
		}
		return "tok_example", nil
	}
	ts, _, _ := newLimitServer(t, api.WithAuthHooks(api.AuthHooks{Login: hook}))
	for i := 0; i < 7; i++ {
		r := login1(t, ts, "198.51.100.1", "owner", "x")
		if r.Status != 500 || r.Err != "internal" {
			t.Fatalf("error %d = %+v, want 500 internal", i+1, r)
		}
	}
	boom.Store(false)
	if r := login1(t, ts, "198.51.100.1", "owner", "x"); r.Status != 200 {
		t.Fatalf("after 7 server errors = %+v, want 200 (no failure counted)", r)
	}
}

func TestAuthLimitBadBodies(t *testing.T) {
	h := &fastLogin{}
	ts, _, _ := newLimitServer(t, api.WithAuthHooks(api.AuthHooks{Login: h.login}))
	if r := authRaw(t, ts, "/api/auth/login", "", "", strings.NewReader("{nope")); r.Status != 400 || r.Err != "bad_request" {
		t.Fatalf("malformed = %+v", r)
	}
	if r := login1(t, ts, "", "", ""); r.Status != 400 || r.Err != "bad_request" {
		t.Fatalf("empty = %+v", r)
	}
	big := `{"username":"a","password":"` + strings.Repeat("x", 5000) + `"}`
	if r := authRaw(t, ts, "/api/auth/login", "", "", strings.NewReader(big)); r.Status != 413 || r.Err != "too_large" {
		t.Fatalf("oversize = %+v", r)
	}
	if h.calls.Load() != 0 {
		t.Fatal("a bad body hashed")
	}
}

func TestAuthLimitLogsNothingPersonal(t *testing.T) {
	var buf bytes.Buffer
	log.SetOutput(&buf)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })
	h := &fastLogin{}
	ts, _, _ := newLimitServer(t, api.WithAuthHooks(api.AuthHooks{Login: h.login}))
	for i := 0; i < 12; i++ {
		login1(t, ts, "198.51.100.77", "zelda-secret-name", "hunter2-secret")
	}
	out := buf.String()
	if !strings.Contains(out, "sign-in throttled") {
		t.Fatalf("no throttle line logged: %q", out)
	}
	if strings.Count(out, "sign-in throttled") != 1 {
		t.Fatalf("log not rate limited: %q", out)
	}
	for _, secret := range []string{"198.51.100.77", "zelda", "hunter2", "127.0.0.1"} {
		if strings.Contains(out, secret) {
			t.Fatalf("log contains %q: %q", secret, out)
		}
	}
}

func TestAuthLimitNamedLimiter(t *testing.T) {
	p := api.DefaultAuthPolicy()
	p.Named = map[string]ratelimit.BucketPolicy{"reauth": {Burst: 2, Every: time.Hour, MaxKeys: 100}}
	var probe func(name, key string) (bool, time.Duration)
	newLimitServer(t, api.WithAuthPolicy(p), api.WithLimiterProbe(&probe))
	for i := 0; i < 2; i++ {
		if ok, _ := probe("reauth", "u1"); !ok {
			t.Fatalf("reauth take %d refused", i+1)
		}
	}
	if ok, retry := probe("reauth", "u1"); ok || retry <= 0 {
		t.Fatalf("third reauth = %v %v, want refused with a wait", ok, retry)
	}
	if ok, _ := probe("reauth", "u2"); !ok {
		t.Fatal("another key shares the bucket")
	}
	if ok, _ := probe("reauth-other-table", "u1"); !ok {
		t.Fatal("tables are not separate per name")
	}
	for i := 0; i < 10; i++ { // unknown names use the client policy: burst 10
		if ok, _ := probe("whatever", "k"); !ok {
			t.Fatalf("unknown-name take %d refused", i+1)
		}
	}
	if ok, _ := probe("whatever", "k"); ok {
		t.Fatal("unknown-name policy has no limit")
	}
}

// registerAs posts a registration with an optional bearer token.
func registerAs(t *testing.T, ts *httptest.Server, xff, bearer, user string) authResp {
	t.Helper()
	b, _ := json.Marshal(map[string]string{"username": user, "password": "pw-" + user})
	return authRaw(t, ts, "/api/auth/register", xff, bearer, bytes.NewReader(b))
}

func TestAuthLimitRegisterBootstrapGated(t *testing.T) {
	var firsts atomic.Int64
	hook := func(ctx context.Context, d *sql.DB, user, pass string) (model.User, error) {
		firsts.Add(1)
		return auth.CreateFirstUser(ctx, d, user, pass)
	}
	ts, _, _ := newLimitServer(t, api.WithAuthHooks(api.AuthHooks{CreateFirstUser: hook}))
	if r := registerAs(t, ts, "198.51.100.1", "", "owner"); r.Status != 201 {
		t.Fatalf("bootstrap = %+v", r)
	}
	if firsts.Load() != 1 {
		t.Fatalf("bootstrap hash ran %d times", firsts.Load())
	}
}

func TestAuthLimitRegisterAnonymousThrottled(t *testing.T) {
	var creates atomic.Int64
	hook := func(ctx context.Context, d *sql.DB, user, pass string, admin bool) (model.User, error) {
		creates.Add(1)
		return auth.CreateUser(ctx, d, user, pass, admin)
	}
	ts, sqlDB, _ := newLimitServer(t, api.WithAuthHooks(api.AuthHooks{CreateUser: hook}))
	if _, err := auth.CreateFirstUser(context.Background(), sqlDB, "owner", "pw-owner"); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 10; i++ {
		if r := registerAs(t, ts, "198.51.100.1", "", fmt.Sprintf("u%d", i)); r.Status != 403 || r.Err != "admin_required" {
			t.Fatalf("anonymous %d = %+v, want 403 admin_required", i+1, r)
		}
	}
	if r := registerAs(t, ts, "198.51.100.1", "", "u11"); r.Status != 429 || r.Err != "rate_limited" {
		t.Fatalf("11th anonymous = %+v, want 429", r)
	}
	if creates.Load() != 0 {
		t.Fatal("an anonymous register hashed")
	}
	// a non-admin token is no admin
	if r := registerAs(t, ts, "198.51.100.2", "not-a-token", "x"); r.Status != 403 {
		t.Fatalf("bad token = %d", r.Status)
	}
}

func TestAuthLimitRegisterAdminBulkNotThrottled(t *testing.T) {
	ts, sqlDB, _ := newLimitServer(t)
	if _, err := auth.CreateFirstUser(context.Background(), sqlDB, "owner", "pw-owner"); err != nil {
		t.Fatal(err)
	}
	token, err := auth.Login(context.Background(), sqlDB, "owner", "pw-owner")
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 15; i++ {
		if r := registerAs(t, ts, "198.51.100.1", token, fmt.Sprintf("bulk%d", i)); r.Status != 201 {
			t.Fatalf("admin create %d = %+v, want 201", i+1, r)
		}
	}
	if r := registerAs(t, ts, "198.51.100.1", token, "bulk0"); r.Status != 409 || r.Err != "username_taken" {
		t.Fatalf("duplicate = %+v", r)
	}
	if r := authRaw(t, ts, "/api/auth/register", "198.51.100.1", token, strings.NewReader("{")); r.Status != 400 || r.Err != "bad_request" {
		t.Fatalf("malformed = %+v", r)
	}
}

func TestAuthLimitRegisterGateBusy(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	hook := func(ctx context.Context, d *sql.DB, user, pass string) (model.User, error) {
		entered <- struct{}{}
		<-release
		return auth.CreateFirstUser(ctx, d, user, pass)
	}
	p := api.DefaultAuthPolicy()
	p.Hashes, p.HashWait = 1, 50*time.Millisecond
	ts, _, _ := newLimitServer(t, api.WithAuthPolicy(p), api.WithAuthHooks(api.AuthHooks{CreateFirstUser: hook}))
	done := make(chan authResp)
	go func() { done <- registerAs(t, ts, "198.51.100.1", "", "owner") }()
	<-entered
	if r := registerAs(t, ts, "198.51.100.2", "", "other"); r.Status != 503 || r.Err != "busy" {
		t.Fatalf("second register = %+v, want 503", r)
	}
	close(release)
	if r := <-done; r.Status != 201 {
		t.Fatalf("first = %+v", r)
	}
}

// The fixtures of docs/contracts/auth/throttle-responses.json are what a
// real server answers.
func TestAuthLimitContractFixtures(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/auth/throttle-responses.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx map[string]struct {
		Status  int               `json:"status"`
		Headers map[string]string `json:"headers"`
		Body    map[string]string `json:"body"`
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	for name, f := range fx {
		if f.Body["error"] == "" || f.Body["message"] == "" || len(f.Body) != 2 || f.Headers["Content-Type"] != "application/json" {
			t.Errorf("fixture %s is not a {error,message} JSON response: %+v", name, f)
		}
	}
	h := &fastLogin{}
	ts, sqlDB, _ := newLimitServer(t, api.WithAuthHooks(api.AuthHooks{Login: h.login}))
	if _, err := auth.CreateFirstUser(context.Background(), sqlDB, "owner", "pw-owner"); err != nil {
		t.Fatal(err)
	}
	token, _ := auth.Login(context.Background(), sqlDB, "owner", "pw-owner")
	same := func(name string, got authResp) {
		t.Helper()
		f := fx[name]
		if got.Status != f.Status || got.Err != f.Body["error"] || got.Msg != f.Body["message"] ||
			got.RetryAfter != f.Headers["Retry-After"] {
			t.Errorf("%s: real %+v differs from fixture %+v", name, got, f)
		}
	}
	same("login_bad_credentials", login1(t, ts, "198.51.100.1", "owner", "wrong"))
	same("register_admin_required", registerAs(t, ts, "198.51.100.2", "", "x"))
	same("register_username_taken", registerAs(t, ts, "198.51.100.2", token, "owner"))
	same("bad_request", authRaw(t, ts, "/api/auth/login", "198.51.100.3", "", strings.NewReader("{")))
	big := `{"username":"a","password":"` + strings.Repeat("x", 5000) + `"}`
	same("too_large", authRaw(t, ts, "/api/auth/login", "198.51.100.3", "", strings.NewReader(big)))
	var last authResp
	for i := 0; i < 11; i++ {
		last = login1(t, ts, "198.51.100.4", fmt.Sprintf("u%d", i), "wrong")
	}
	same("rate_limited", last)
	// pair lock of 15 minutes words as minutes
	for i := 0; i < 6; i++ {
		login1(t, ts, "198.51.100.5", "owner", "wrong")
	}
	if r := login1(t, ts, "198.51.100.5", "owner", "wrong"); r.Err != "rate_limited" || r.Msg != "Too many sign-in attempts. Try again in 1 minute." {
		t.Errorf("minute wording: %+v", r)
	}
}
