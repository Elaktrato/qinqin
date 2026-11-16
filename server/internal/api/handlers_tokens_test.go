package api_test

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"qinqin/internal/api"
	"qinqin/internal/ratelimit"
)

var patShape = regexp.MustCompile(`^qq_pat_[0-9a-f]{64}$`)

// captureLog sends the standard logger to a buffer for the test and fails
// it if any line names an access token (matrix 22). The token tests of this
// package all run under it.
var logMu sync.Mutex

func captureLog(t *testing.T) {
	t.Helper()
	logMu.Lock()
	var buf bytes.Buffer
	log.SetOutput(&buf)
	t.Cleanup(func() {
		log.SetOutput(os.Stderr)
		logMu.Unlock()
		if strings.Contains(buf.String(), "qq_pat_") {
			t.Errorf("the server log names an access token:\n%s", buf.String())
		}
	})
}

type tokenCreated struct {
	Token       string         `json:"token"`
	AccessToken map[string]any `json:"accessToken"`
}

func tokenBody(name, scope string, days int, ws any, password string) map[string]any {
	return map[string]any{"name": name, "scope": scope, "workspaceId": ws, "expiresInDays": days, "currentPassword": password}
}

func createTok(t *testing.T, url, session string, b map[string]any) (int, tokenCreated, errBody, http.Header) {
	t.Helper()
	resp := doJSON(t, "POST", url, "/api/account/tokens", session, b)
	raw, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	var c tokenCreated
	var e errBody
	json.Unmarshal(raw, &c)
	json.Unmarshal(raw, &e)
	return resp.StatusCode, c, e, resp.Header
}

func TestTokenRoutesNeedAFullSession(t *testing.T) {
	captureLog(t)
	ts, sqlDB := newLooseServer(t)
	alice := registerUser(t, ts.URL, "alice", "")
	st, c, _, _ := createTok(t, ts.URL, alice, tokenBody("n", "write", 30, nil, "secret-pass-alice"))
	if st != 201 {
		t.Fatal(st)
	}
	registerUser(t, ts.URL, "bobby", alice)
	sqlDB.Exec(`UPDATE users SET must_change_password = 1, must_change_after = 0 WHERE username = 'bobby'`)
	pwc := login(t, ts.URL, "bobby")
	for _, rt := range []struct{ method, path string }{
		{"GET", "/api/account/tokens"}, {"POST", "/api/account/tokens"}, {"DELETE", "/api/account/tokens"}, {"DELETE", "/api/account/tokens/1"},
	} {
		for _, c := range []struct {
			who, tok string
			status   int
			code     string
		}{{"anon", "", 401, "unauthorized"}, {"pwc", pwc, 403, "password_change_required"}, {"token", c.Token, 403, "token_not_allowed"}} {
			resp := doJSON(t, rt.method, ts.URL, rt.path, c.tok, map[string]any{})
			var e errBody
			json.NewDecoder(resp.Body).Decode(&e)
			if resp.StatusCode != c.status || e.Error != c.code {
				t.Errorf("%s %s as %s = %d %q, want %d %q", rt.method, rt.path, c.who, resp.StatusCode, e.Error, c.status, c.code)
			}
		}
	}
}

func TestCreateListRevokeTokens(t *testing.T) {
	captureLog(t)
	ts, _ := newLooseServer(t)
	alice := registerUser(t, ts.URL, "alice", "")
	bob := registerUser(t, ts.URL, "bob", alice)
	wsA := createWorkspace(t, ts.URL, alice, "zh", "A")
	wsBob := createWorkspace(t, ts.URL, bob, "zh", "B")
	st, c, e, h := createTok(t, ts.URL, alice, tokenBody("  cron sync ", "write", 90, nil, "secret-pass-alice"))
	if st != 201 || !patShape.MatchString(c.Token) || h.Get("Cache-Control") != "no-store" {
		t.Fatalf("create: %d %+v %+v cache %q", st, c.AccessToken, e, h.Get("Cache-Control"))
	}
	if c.AccessToken["name"] != "cron sync" || c.AccessToken["hint"] != c.Token[7:13] || c.AccessToken["workspaceId"] != nil || c.AccessToken["lastUsedAt"] != nil {
		t.Errorf("accessToken %+v", c.AccessToken)
	}
	st, lim, _, _ := createTok(t, ts.URL, alice, tokenBody("reader", "read", 7, wsA, "secret-pass-alice"))
	if st != 201 || lim.AccessToken["workspaceId"] != float64(wsA) {
		t.Fatalf("limited create: %d %+v", st, lim.AccessToken)
	}
	// The token works.
	if resp := doJSON(t, "GET", ts.URL, "/api/workspaces", c.Token, nil); resp.StatusCode != 200 {
		t.Fatalf("token on workspaces: %d", resp.StatusCode)
	}
	// Foreign and unknown workspaces are 404.
	for _, ws := range []any{wsBob, 99999} {
		if st, _, e, _ := createTok(t, ts.URL, alice, tokenBody("n", "read", 7, ws, "secret-pass-alice")); st != 404 || e.Error != "not_found" {
			t.Errorf("workspace %v: %d %+v", ws, st, e)
		}
	}
	// The list carries no secret.
	resp := doJSON(t, "GET", ts.URL, "/api/account/tokens", alice, nil)
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 || strings.Contains(string(raw), c.Token) || strings.Contains(string(raw), c.Token[7:]) || strings.Contains(string(raw), `"token"`) {
		t.Errorf("list: %d %s", resp.StatusCode, raw)
	}
	var list struct {
		AccessTokens []map[string]any `json:"accessTokens"`
	}
	json.Unmarshal(raw, &list)
	if len(list.AccessTokens) != 2 || list.AccessTokens[1]["lastUsedAt"] == nil {
		t.Errorf("list %s", raw)
	}
	// Matrix 12: bob cannot see or revoke alice's tokens.
	resp = doJSON(t, "GET", ts.URL, "/api/account/tokens", bob, nil)
	raw, _ = io.ReadAll(resp.Body)
	if !strings.Contains(string(raw), `"accessTokens":[]`) {
		t.Errorf("bob's list %s", raw)
	}
	id := strconv.FormatInt(int64(c.AccessToken["id"].(float64)), 10)
	for _, path := range []string{"/api/account/tokens/" + id, "/api/account/tokens/x", "/api/account/tokens/99999"} {
		resp = doJSON(t, "DELETE", ts.URL, path, bob, nil)
		var e errBody
		json.NewDecoder(resp.Body).Decode(&e)
		if resp.StatusCode != 404 || e.Error != "not_found" {
			t.Errorf("bob DELETE %s: %d %+v", path, resp.StatusCode, e)
		}
	}
	if resp := doJSON(t, "DELETE", ts.URL, "/api/account/tokens", bob, nil); resp.StatusCode != 200 {
		t.Errorf("bob revoke all: %d", resp.StatusCode)
	}
	if resp := doJSON(t, "GET", ts.URL, "/api/workspaces", c.Token, nil); resp.StatusCode != 200 {
		t.Errorf("alice's token after bob's attempts: %d", resp.StatusCode)
	}
	// Revoke one, then all.
	if resp := doJSON(t, "DELETE", ts.URL, "/api/account/tokens/"+id, alice, nil); resp.StatusCode != 204 {
		t.Errorf("revoke one: %d", resp.StatusCode)
	}
	if resp := doJSON(t, "GET", ts.URL, "/api/workspaces", c.Token, nil); resp.StatusCode != 401 {
		t.Errorf("revoked token: %d, want 401", resp.StatusCode)
	}
	resp = doJSON(t, "DELETE", ts.URL, "/api/account/tokens", alice, nil)
	var n struct{ Revoked int }
	json.NewDecoder(resp.Body).Decode(&n)
	if resp.StatusCode != 200 || n.Revoked != 1 {
		t.Errorf("revoke all: %d %+v", resp.StatusCode, n)
	}
}

// newTokenServer lifts the creation budget out of the way.
func newTokenServer(t *testing.T) (*httptest.Server, *sql.DB) {
	t.Helper()
	p := api.DefaultAuthPolicy()
	p.Client.Burst = 5000
	p.Named["pat-create"] = ratelimit.BucketPolicy{Burst: 1000, Every: time.Millisecond, MaxKeys: 100}
	return newPolicyServer(t, api.WithAuthPolicy(p))
}

func TestCreateTokenRefusals(t *testing.T) {
	captureLog(t)
	ts, sqlDB := newTokenServer(t)
	alice := registerUser(t, ts.URL, "alice", "")
	for _, c := range []struct {
		body map[string]any
		msg  string
	}{
		{tokenBody(" ", "read", 7, nil, "secret-pass-alice"), "The name must be 1 to 64 characters."},
		{tokenBody(strings.Repeat("x", 65), "read", 7, nil, "secret-pass-alice"), "The name must be 1 to 64 characters."},
		{tokenBody("n", "admin", 7, nil, "secret-pass-alice"), "The scope must be read or write."},
		{tokenBody("n", "read", 0, nil, "secret-pass-alice"), "The expiry must be 1 to 365 days."},
		{tokenBody("n", "read", 366, nil, "secret-pass-alice"), "The expiry must be 1 to 365 days."},
	} {
		if st, _, e, _ := createTok(t, ts.URL, alice, c.body); st != 422 || e.Error != "invalid_token_request" || e.Message != c.msg {
			t.Errorf("%v: %d %+v", c.body, st, e)
		}
	}
	if st, _, e, _ := createTok(t, ts.URL, alice, tokenBody("n", "read", 7, nil, "")); st != 403 || e.Error != "current_password_required" {
		t.Errorf("no password: %d %+v", st, e)
	}
	// Bad body shapes are 400.
	for _, raw := range []string{`{"name":"n","scope":"read","expiresInDays":"7","currentPassword":"x"}`, `{"nope":1}`, `[`} {
		resp := doRaw(t, "POST", ts.URL, "/api/account/tokens", alice, raw)
		if resp.StatusCode != 400 {
			t.Errorf("%s: %d", raw, resp.StatusCode)
		}
	}
	// Matrix 20: the 21st live token is refused; an expired one does not count.
	for i := 0; i < 20; i++ {
		if st, _, e, _ := createTok(t, ts.URL, alice, tokenBody("n", "read", 7, nil, "secret-pass-alice")); st != 201 {
			t.Fatalf("create %d: %d %+v", i, st, e)
		}
	}
	if st, _, e, _ := createTok(t, ts.URL, alice, tokenBody("n", "read", 7, nil, "secret-pass-alice")); st != 409 || e.Error != "token_limit" {
		t.Errorf("21st: %d %+v", st, e)
	}
	sqlDB.Exec(`UPDATE access_tokens SET expires_at = '2000-01-01T00:00:00Z' WHERE id = (SELECT MIN(id) FROM access_tokens)`)
	if st, _, e, _ := createTok(t, ts.URL, alice, tokenBody("n", "read", 7, nil, "secret-pass-alice")); st != 201 {
		t.Errorf("after one expired: %d %+v", st, e)
	}
}

// Matrix 19: wrong passwords spend the reauth budget (403 wrong_password,
// then 429); creations spend pat-create.
func TestCreateTokenBudgets(t *testing.T) {
	captureLog(t)
	p := api.DefaultAuthPolicy()
	p.Client.Burst = 5000
	p.Named["pat-create"] = ratelimit.BucketPolicy{Burst: 3, Every: time.Hour, MaxKeys: 100}
	ts, _ := newPolicyServer(t, api.WithAuthPolicy(p))
	alice := registerUser(t, ts.URL, "alice", "")
	for i := 0; i < 3; i++ {
		if st, _, e, _ := createTok(t, ts.URL, alice, tokenBody("n", "read", 7, nil, "secret-pass-alice")); st != 201 {
			t.Fatalf("create %d: %d %+v", i, st, e)
		}
	}
	st, _, e, h := createTok(t, ts.URL, alice, tokenBody("n", "read", 7, nil, "secret-pass-alice"))
	if st != 429 || e.Error != "rate_limited" || h.Get("Retry-After") == "" {
		t.Errorf("4th create: %d %+v %q", st, e, h.Get("Retry-After"))
	}
	// reauth: 5 wrong per user, the 6th is 429.
	ts2, _ := newLooseServer(t)
	carla := registerUser(t, ts2.URL, "carla", "")
	for i := 0; i < 5; i++ {
		if st, _, e, _ := createTok(t, ts2.URL, carla, tokenBody("n", "read", 7, nil, "not-the-password")); st != 403 || e.Error != "wrong_password" {
			t.Fatalf("wrong %d: %d %+v", i, st, e)
		}
	}
	if st, _, e, _ := createTok(t, ts2.URL, carla, tokenBody("n", "read", 7, nil, "not-the-password")); st != 429 || e.Error != "rate_limited" {
		t.Errorf("6th wrong: %d %+v", st, e)
	}
}

// The capture sees what the server logs.
func TestCaptureLogSeesTheLog(t *testing.T) {
	var buf bytes.Buffer
	log.SetOutput(&buf)
	defer log.SetOutput(os.Stderr)
	log.Print("probe")
	if !strings.Contains(buf.String(), "probe") {
		t.Error("log capture does not see log.Print")
	}
}
