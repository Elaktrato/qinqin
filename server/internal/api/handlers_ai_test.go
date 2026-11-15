package api_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/ai"
	"qinqin/internal/api"
	"qinqin/internal/db"
)

const aiGoodKey = "sk-fake-good-key-0001"
const aiBadKey = "sk-fake-bad-key-0001"

// aiServer builds a server with the fake provider. secret is "ok", "missing"
// or "invalid"; a missing or invalid secret leaves the key store nil, as
// aiFromEnv does.
func aiServer(t *testing.T, secret ai.SecretState) (*httptest.Server, *sql.DB, string) {
	t.Helper()
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	var seed byte
	if secret == ai.SecretOK {
		seed = 7
	}
	svc := testAIService(sqlDB, ai.Fake{}, secret, seed)
	svc.Fake = true
	ts := httptest.NewServer(api.New(sqlDB, t.TempDir(), nil, api.WithAI(svc)))
	t.Cleanup(ts.Close)
	admin := registerUser(t, ts.URL, "root", "")
	return ts, sqlDB, admin
}

// testAIService builds the service the way aiFromEnv does, with one adapter
// answering for every provider family (a fake or a client pointed at an
// httptest server). seed 0 means no key store.
func testAIService(sqlDB *sql.DB, p ai.Provider, secret ai.SecretState, seed byte) *ai.Service {
	reg := &ai.Registry{Custom: &ai.CustomStore{DB: sqlDB}}
	svc := &ai.Service{
		Adapters: map[ai.Kind]ai.Provider{ai.KindAnthropic: p, ai.KindOpenAI: p, ai.KindGemini: p},
		Registry: reg, Secret: secret, Selection: &ai.Selection{DB: sqlDB},
		Limiter: &ai.Limiter{DB: sqlDB, PerHour: 30},
	}
	if seed != 0 {
		svc.Keys = &ai.KeyStore{DB: sqlDB, Current: ai.NewSealer(bytes.Repeat([]byte{seed}, 32)), AADFor: reg.AADFor}
	}
	return svc
}

// storeActiveKey stores a key for the user directly (no validation call) and
// makes the provider active.
func storeActiveKey(t *testing.T, sqlDB *sql.DB, userID int64, provider, key string) {
	t.Helper()
	svc := testAIService(sqlDB, ai.Fake{}, ai.SecretOK, 7)
	if err := svc.Keys.Put(context.Background(), userID, provider, key, "", ai.PutOptions{}); err != nil {
		t.Fatal(err)
	}
	if err := svc.Selection.SetActive(context.Background(), userID, provider); err != nil {
		t.Fatal(err)
	}
}

func aiBodyOf(t *testing.T, resp *http.Response) string {
	t.Helper()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

type aiErrBody struct {
	Error   string `json:"error"`
	Message string `json:"message"`
}

func TestAIKeyLifecycle(t *testing.T) {
	ts, _, tok := aiServer(t, ai.SecretOK)

	resp := doJSON(t, http.MethodPut, ts.URL, "/api/ai/key", tok, map[string]string{"provider": "anthropic", "key": aiGoodKey})
	body := aiBodyOf(t, resp)
	if resp.StatusCode != http.StatusOK || strings.Contains(body, "sk-fake-good") {
		t.Fatalf("PUT key: %d %s", resp.StatusCode, body)
	}
	var st ai.Status
	if err := json.Unmarshal([]byte(body), &st); err != nil {
		t.Fatal(err)
	}
	if st.Key == nil || st.Key.Hint != "…0001" || st.Key.Model != "claude-opus-5-5" || !st.Available || st.Provider != "fake" {
		t.Fatalf("status = %+v", st)
	}

	resp = doJSON(t, http.MethodGet, ts.URL, "/api/ai/key", tok, nil)
	body = aiBodyOf(t, resp)
	if resp.StatusCode != http.StatusOK || strings.Contains(body, "sk-fake-good") || strings.Contains(body, "good-key") {
		t.Fatalf("GET key: %d %s", resp.StatusCode, body)
	}
	var k struct{ Provider, Hint, Model, State string }
	_ = json.Unmarshal([]byte(body), &k)
	if k.Provider != "anthropic" || k.Hint != "…0001" || k.State != "ok" {
		t.Fatalf("key = %+v", k)
	}

	// Changing only the model keeps the key.
	resp = doJSON(t, http.MethodPut, ts.URL, "/api/ai/key", tok, map[string]string{"model": "claude-haiku-5-5"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("PUT model: %d %s", resp.StatusCode, aiBodyOf(t, resp))
	}
	resp = doJSON(t, http.MethodGet, ts.URL, "/api/ai/key", tok, nil)
	_ = json.Unmarshal([]byte(aiBodyOf(t, resp)), &k)
	if k.Model != "claude-haiku-5-5" || k.Hint != "…0001" {
		t.Fatalf("after model change: %+v", k)
	}

	// A new key without a model keeps the chosen model.
	doJSON(t, http.MethodPut, ts.URL, "/api/ai/key", tok, map[string]string{"key": "sk-fake-good-key-0002"})
	resp = doJSON(t, http.MethodGet, ts.URL, "/api/ai/key", tok, nil)
	_ = json.Unmarshal([]byte(aiBodyOf(t, resp)), &k)
	if k.Model != "claude-haiku-5-5" || k.Hint != "…0002" {
		t.Fatalf("after re-key: %+v", k)
	}

	if resp := doJSON(t, http.MethodDelete, ts.URL, "/api/ai/key", tok, nil); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("DELETE: %d", resp.StatusCode)
	}
	resp = doJSON(t, http.MethodGet, ts.URL, "/api/ai/key", tok, nil)
	var e aiErrBody
	_ = json.Unmarshal([]byte(aiBodyOf(t, resp)), &e)
	if resp.StatusCode != http.StatusNotFound || e.Error != "no_key" {
		t.Fatalf("GET after delete: %d %+v", resp.StatusCode, e)
	}
	// Model change without a key is 409 no_key.
	resp = doJSON(t, http.MethodPut, ts.URL, "/api/ai/key", tok, map[string]string{"model": "claude-haiku-5-5"})
	_ = json.Unmarshal([]byte(aiBodyOf(t, resp)), &e)
	if resp.StatusCode != http.StatusConflict || e.Error != "no_key" {
		t.Fatalf("PUT model without key: %d %+v", resp.StatusCode, e)
	}
}

func TestAIStatus(t *testing.T) {
	ts, _, tok := aiServer(t, ai.SecretOK)
	resp := doJSON(t, http.MethodGet, ts.URL, "/api/ai/status", tok, nil)
	var st ai.Status
	decodeJSON(t, resp, &st)
	if st.Available || st.Reason != "no_key" || st.Key != nil || len(st.Models) != 3 || st.Usage.LimitPerHour != 30 {
		t.Fatalf("status = %+v", st)
	}
}

func TestAIKeyRejectedIsNot401(t *testing.T) {
	ts, _, tok := aiServer(t, ai.SecretOK)
	resp := doJSON(t, http.MethodPut, ts.URL, "/api/ai/key", tok, map[string]string{"key": aiBadKey})
	var e aiErrBody
	_ = json.Unmarshal([]byte(aiBodyOf(t, resp)), &e)
	if resp.StatusCode != http.StatusUnprocessableEntity || e.Error != "key_rejected" || e.Message != "The provider rejected the API key." {
		t.Fatalf("PUT bad key: %d %+v", resp.StatusCode, e)
	}
	if resp := doJSON(t, http.MethodGet, ts.URL, "/api/auth/me", tok, nil); resp.StatusCode != http.StatusOK {
		t.Fatalf("token no longer valid: %d", resp.StatusCode)
	}
	if resp := doJSON(t, http.MethodGet, ts.URL, "/api/ai/key", tok, nil); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("a rejected key must not be stored: %d", resp.StatusCode)
	}
}

func TestAIKeyNoSecret(t *testing.T) {
	ts, _, tok := aiServer(t, ai.SecretMissing)
	resp := doJSON(t, http.MethodPut, ts.URL, "/api/ai/key", tok, map[string]string{"key": aiGoodKey})
	var e aiErrBody
	_ = json.Unmarshal([]byte(aiBodyOf(t, resp)), &e)
	if resp.StatusCode != http.StatusConflict || e.Error != "ai_disabled" || e.Message != "Set QINQIN_SECRET on the server to store an API key." {
		t.Fatalf("missing secret: %d %+v", resp.StatusCode, e)
	}
	var st ai.Status
	decodeJSON(t, doJSON(t, http.MethodGet, ts.URL, "/api/ai/status", tok, nil), &st)
	if st.Reason != "no_secret" || st.Available {
		t.Fatalf("status = %+v", st)
	}

	ts, _, tok = aiServer(t, ai.SecretInvalid)
	resp = doJSON(t, http.MethodPut, ts.URL, "/api/ai/key", tok, map[string]string{"key": aiGoodKey})
	_ = json.Unmarshal([]byte(aiBodyOf(t, resp)), &e)
	if resp.StatusCode != http.StatusConflict || e.Error != "ai_disabled" || e.Message != "QINQIN_SECRET is set but is not 32 bytes of base64." {
		t.Fatalf("invalid secret: %d %+v", resp.StatusCode, e)
	}
	decodeJSON(t, doJSON(t, http.MethodGet, ts.URL, "/api/ai/status", tok, nil), &st)
	if st.Reason != "invalid_secret" {
		t.Fatalf("status = %+v", st)
	}
}

func TestAIKeyUndecryptable(t *testing.T) {
	ts, sqlDB, tok := aiServer(t, ai.SecretOK)
	doJSON(t, http.MethodPut, ts.URL, "/api/ai/key", tok, map[string]string{"key": aiGoodKey})
	// The server restarts with another secret.
	svc := testAIService(sqlDB, ai.Fake{}, ai.SecretOK, 9)
	svc.Fake = true
	ts2 := httptest.NewServer(api.New(sqlDB, t.TempDir(), nil, api.WithAI(svc)))
	t.Cleanup(ts2.Close)
	var st ai.Status
	decodeJSON(t, doJSON(t, http.MethodGet, ts2.URL, "/api/ai/status", tok, nil), &st)
	if st.Reason != "key_undecryptable" || st.Key == nil || st.Key.State != ai.KeyUndecryptable {
		t.Fatalf("status = %+v", st)
	}
	// Entering the key again repairs it.
	if resp := doJSON(t, http.MethodPut, ts2.URL, "/api/ai/key", tok, map[string]string{"key": aiGoodKey}); resp.StatusCode != http.StatusOK {
		t.Fatalf("re-enter: %d", resp.StatusCode)
	}
}

func TestAIKeyInvalidInput(t *testing.T) {
	ts, _, tok := aiServer(t, ai.SecretOK)
	for name, body := range map[string]map[string]string{
		"model":    {"key": aiGoodKey, "model": "gpt 4"},
		"short":    {"key": "sk-short"},
		"spaces":   {"key": "sk-fake good key 00000001"},
		"provider": {"key": aiGoodKey, "provider": "openai"},
	} {
		resp := doJSON(t, http.MethodPut, ts.URL, "/api/ai/key", tok, body)
		var e aiErrBody
		_ = json.Unmarshal([]byte(aiBodyOf(t, resp)), &e)
		want := "invalid_" + name
		if name == "short" || name == "spaces" {
			want = "invalid_key"
		}
		if resp.StatusCode != http.StatusUnprocessableEntity || e.Error != want {
			t.Errorf("%s: %d %+v, want 422 %s", name, resp.StatusCode, e, want)
		}
	}
	resp := doRaw(t, http.MethodPut, ts.URL, "/api/ai/key", tok, strings.Repeat("x", 5000))
	if resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Errorf("oversized body: %d", resp.StatusCode)
	}
	resp = doRaw(t, http.MethodPut, ts.URL, "/api/ai/key", tok, "not json")
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("bad json: %d", resp.StatusCode)
	}
}

func TestAIRoutesNeedUser(t *testing.T) {
	ts, _, _ := aiServer(t, ai.SecretOK)
	for _, rt := range [][2]string{{"GET", "/api/ai/status"}, {"GET", "/api/ai/key"}, {"PUT", "/api/ai/key"}, {"DELETE", "/api/ai/key"}} {
		if resp := doRaw(t, rt[0], ts.URL, rt[1], "", "{}"); resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("%s %s without token: %d", rt[0], rt[1], resp.StatusCode)
		}
	}
}

func TestAIKeyNotLogged(t *testing.T) {
	var buf bytes.Buffer
	log.SetOutput(&buf)
	t.Cleanup(func() { log.SetOutput(io.Discard) })
	ts, _, tok := aiServer(t, ai.SecretOK)
	doJSON(t, http.MethodPut, ts.URL, "/api/ai/key", tok, map[string]string{"key": aiGoodKey})
	doJSON(t, http.MethodPut, ts.URL, "/api/ai/key", tok, map[string]string{"key": aiBadKey})
	doJSON(t, http.MethodGet, ts.URL, "/api/ai/key", tok, nil)
	doJSON(t, http.MethodGet, ts.URL, "/api/ai/status", tok, nil)
	if out := buf.String(); strings.Contains(out, "good-key") || strings.Contains(out, "bad-key") || strings.Contains(out, "sk-fake") {
		t.Fatalf("log leaks a key:\n%s", out)
	}
}

func TestAIKeyValidateCountsTowardLimit(t *testing.T) {
	ts, _, tok := aiServer(t, ai.SecretOK)
	for i := 1; i <= 31; i++ {
		resp := doJSON(t, http.MethodPut, ts.URL, "/api/ai/key", tok, map[string]string{"key": aiGoodKey})
		if i <= 30 {
			if resp.StatusCode != http.StatusOK {
				t.Fatalf("PUT %d: %d", i, resp.StatusCode)
			}
			continue
		}
		var e aiErrBody
		_ = json.Unmarshal([]byte(aiBodyOf(t, resp)), &e)
		if resp.StatusCode != http.StatusTooManyRequests || e.Error != "rate_limited" || resp.Header.Get("Retry-After") == "" {
			t.Fatalf("PUT 31: %d %+v retry-after=%q", resp.StatusCode, e, resp.Header.Get("Retry-After"))
		}
		if !strings.Contains(e.Message, "30 AI calls this hour") {
			t.Errorf("message = %q", e.Message)
		}
	}
	var st ai.Status
	decodeJSON(t, doJSON(t, http.MethodGet, ts.URL, "/api/ai/status", tok, nil), &st)
	if st.Usage.CallsLastHour != 30 {
		t.Errorf("calls = %d", st.Usage.CallsLastHour)
	}
}

func TestAIServiceNilIsDisabled(t *testing.T) {
	ts, _ := newServer(t) // no WithAI
	tok := registerUser(t, ts.URL, "root", "")
	var st ai.Status
	decodeJSON(t, doJSON(t, http.MethodGet, ts.URL, "/api/ai/status", tok, nil), &st)
	if st.Available || st.Reason != "no_secret" {
		t.Fatalf("status = %+v", st)
	}
	resp := doJSON(t, http.MethodPut, ts.URL, "/api/ai/key", tok, map[string]string{"key": aiGoodKey})
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("PUT without service: %d", resp.StatusCode)
	}
}

func TestAIKeyDeleteAndGetWithoutSecret(t *testing.T) {
	ts, sqlDB, tok := aiServer(t, ai.SecretOK)
	doJSON(t, http.MethodPut, ts.URL, "/api/ai/key", tok, map[string]string{"key": aiGoodKey})
	// The server restarts without a usable secret: no key store at all.
	for _, secret := range []ai.SecretState{ai.SecretMissing, ai.SecretInvalid} {
		svc := testAIService(sqlDB, ai.Fake{}, secret, 0)
		svc.Fake = true
		ts2 := httptest.NewServer(api.New(sqlDB, t.TempDir(), nil, api.WithAI(svc)))
		t.Cleanup(ts2.Close)
		resp := doJSON(t, http.MethodGet, ts2.URL, "/api/ai/key", tok, nil)
		var k struct{ Hint, State string }
		body := aiBodyOf(t, resp)
		_ = json.Unmarshal([]byte(body), &k)
		if resp.StatusCode != http.StatusOK || k.State != "undecryptable" || k.Hint != "…0001" {
			t.Fatalf("%s: GET key: %d %s", secret, resp.StatusCode, body)
		}
	}
	svc := testAIService(sqlDB, ai.Fake{}, ai.SecretMissing, 0)
	svc.Fake = true
	ts2 := httptest.NewServer(api.New(sqlDB, t.TempDir(), nil, api.WithAI(svc)))
	t.Cleanup(ts2.Close)
	if resp := doJSON(t, http.MethodDelete, ts2.URL, "/api/ai/key", tok, nil); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("DELETE: %d", resp.StatusCode)
	}
	var n int
	_ = sqlDB.QueryRow(`SELECT COUNT(*) FROM ai_keys`).Scan(&n)
	if n != 0 {
		t.Fatalf("ai_keys rows after DELETE = %d", n)
	}
	resp := doJSON(t, http.MethodGet, ts2.URL, "/api/ai/key", tok, nil)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("GET after delete: %d", resp.StatusCode)
	}
}
