package api_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"qinqin/internal/ai"
	"qinqin/internal/api"
	"qinqin/internal/dbtest"
	"qinqin/internal/journal"
)

const aiGoodKey = "sk-fake-good-key-0001"
const aiBadKey = "sk-fake-bad-key-0001"

// aiServer builds a server with the fake provider. secret is "ok", "missing"
// or "invalid"; a missing or invalid secret leaves the key store nil, as
// aiFromEnv does.
func aiServer(t *testing.T, secret ai.SecretState) (*httptest.Server, *sql.DB, string) {
	t.Helper()
	sqlDB := dbtest.Open(t)
	var seed byte
	if secret == ai.SecretOK {
		seed = 7
	}
	svc := testAIService(sqlDB, ai.Fake{}, secret, seed)
	svc.Fake = true
	ts := newTestServer(sqlDB, api.New(sqlDB, t.TempDir(), nil, api.WithAI(svc)))
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
	storeActiveKeyModel(t, sqlDB, userID, provider, key, "")
}

func storeActiveKeyModel(t *testing.T, sqlDB *sql.DB, userID int64, provider, key, model string) {
	t.Helper()
	if model == "" {
		for _, b := range ai.Builtins() {
			if b.ID == provider {
				model = b.DefaultModel
			}
		}
	}
	svc := testAIService(sqlDB, ai.Fake{}, ai.SecretOK, 7)
	if err := svc.Keys.Put(context.Background(), userID, provider, key, model, ai.PutOptions{}); err != nil {
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

func putKey(t *testing.T, ts *httptest.Server, tok, provider string, body map[string]string) *http.Response {
	t.Helper()
	return doJSON(t, http.MethodPut, ts.URL, "/api/ai/keys/"+provider, tok, body)
}

func statusOf(t *testing.T, ts *httptest.Server, tok string) ai.Status {
	t.Helper()
	var st ai.Status
	decodeJSON(t, doJSON(t, http.MethodGet, ts.URL, "/api/ai/status", tok, nil), &st)
	return st
}

func errOf(t *testing.T, resp *http.Response) aiErrBody {
	t.Helper()
	var e aiErrBody
	_ = json.Unmarshal([]byte(aiBodyOf(t, resp)), &e)
	return e
}

func TestPutKeyPerProvider(t *testing.T) {
	ts, _, tok := aiServer(t, ai.SecretOK)
	resp := putKey(t, ts, tok, "anthropic", map[string]string{"key": aiGoodKey})
	body := aiBodyOf(t, resp)
	if resp.StatusCode != http.StatusOK || strings.Contains(body, "sk-fake-good") {
		t.Fatalf("PUT anthropic: %d %s", resp.StatusCode, body)
	}
	st := statusOf(t, ts, tok)
	if st.Active == nil || st.Active.Provider != "anthropic" || !st.Available || len(st.Keys) != 1 || st.Key == nil || st.Key.Hint != "…0001" || st.Key.Model != "claude-opus-5-5" {
		t.Fatalf("status = %+v", st)
	}
	// The second provider's key is stored but does not take over.
	resp = putKey(t, ts, tok, "openai", map[string]string{"key": "sk-fake-openai-key-0002", "model": "gpt-6-luna"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("PUT openai: %d %s", resp.StatusCode, aiBodyOf(t, resp))
	}
	st = statusOf(t, ts, tok)
	if st.Active.Provider != "anthropic" || len(st.Keys) != 2 || st.Keys[1].Provider != "openai" || st.Keys[1].Model != "gpt-6-luna" {
		t.Fatalf("second key changed the selection: %+v", st)
	}
	// Model only: keeps the key. A new key without a model keeps the chosen model.
	if r := putKey(t, ts, tok, "openai", map[string]string{"model": "gpt-6-astra"}); r.StatusCode != http.StatusOK {
		t.Fatalf("PUT model: %d", r.StatusCode)
	}
	putKey(t, ts, tok, "openai", map[string]string{"key": "sk-fake-openai-key-0003"})
	st = statusOf(t, ts, tok)
	if st.Keys[1].Model != "gpt-6-astra" || st.Keys[1].Hint != "…0003" {
		t.Fatalf("after re-key: %+v", st.Keys)
	}
	// Model change without a key is 409 no_key.
	if e := errOf(t, putKey(t, ts, tok, "gemini", map[string]string{"model": "gemini-3.8-flash"})); e.Error != "no_key" {
		t.Errorf("model without key: %+v", e)
	}
}

func TestPutKeyUnknownProvider(t *testing.T) {
	ts, _, tok := aiServer(t, ai.SecretOK)
	for _, id := range []string{"nope", "custom-aaaaaaaaaa", "OpenAI"} {
		resp := putKey(t, ts, tok, id, map[string]string{"key": aiGoodKey})
		e := errOf(t, resp)
		if resp.StatusCode != http.StatusNotFound || e.Error != "unknown_provider" {
			t.Errorf("%s: %d %+v", id, resp.StatusCode, e)
		}
	}
}

func TestPutKeyInvalidInput(t *testing.T) {
	ts, _, tok := aiServer(t, ai.SecretOK)
	for name, body := range map[string]map[string]string{
		"model":     {"key": aiGoodKey, "model": "a b"},
		"model2":    {"key": aiGoodKey, "model": strings.Repeat("a", 201)},
		"model3":    {"model": "-x"},
		"key short": {"key": "sk-short"},
		"key space": {"key": "sk-fake good key 00000001"},
	} {
		resp := putKey(t, ts, tok, "anthropic", body)
		e := errOf(t, resp)
		want := "invalid_model"
		if strings.HasPrefix(name, "key") {
			want = "invalid_key"
		}
		if resp.StatusCode != http.StatusUnprocessableEntity || e.Error != want {
			t.Errorf("%s: %d %+v, want 422 %s", name, resp.StatusCode, e, want)
		}
	}
	if resp := doRaw(t, http.MethodPut, ts.URL, "/api/ai/keys/anthropic", tok, strings.Repeat("x", 5000)); resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Errorf("oversized body: %d", resp.StatusCode)
	}
	if resp := doRaw(t, http.MethodPut, ts.URL, "/api/ai/keys/anthropic", tok, "not json"); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("bad json: %d", resp.StatusCode)
	}
}

func TestKeyRejectedIsNot401AndNotStored(t *testing.T) {
	ts, _, tok := aiServer(t, ai.SecretOK)
	resp := putKey(t, ts, tok, "openai", map[string]string{"key": aiBadKey})
	e := errOf(t, resp)
	if resp.StatusCode != http.StatusUnprocessableEntity || e.Error != "key_rejected" || e.Message != "The provider rejected the API key." {
		t.Fatalf("PUT bad key: %d %+v", resp.StatusCode, e)
	}
	if resp := doJSON(t, http.MethodGet, ts.URL, "/api/auth/me", tok, nil); resp.StatusCode != http.StatusOK {
		t.Fatalf("token no longer valid: %d", resp.StatusCode)
	}
	if st := statusOf(t, ts, tok); len(st.Keys) != 0 || st.Reason != "no_key" {
		t.Fatalf("a rejected key must not be stored: %+v", st)
	}
}

func TestTestKeyCountsCall(t *testing.T) {
	ts, sqlDB, tok := aiServer(t, ai.SecretOK)
	putKey(t, ts, tok, "openai", map[string]string{"key": aiGoodKey})
	before := statusOf(t, ts, tok).Usage.CallsLastHour
	resp := doJSON(t, http.MethodPost, ts.URL, "/api/ai/keys/openai/test", tok, nil)
	if resp.StatusCode != http.StatusOK || strings.Contains(aiBodyOf(t, resp), "sk-fake") {
		t.Fatalf("test: %d", resp.StatusCode)
	}
	if got := statusOf(t, ts, tok).Usage.CallsLastHour; got != before+1 {
		t.Errorf("calls %d -> %d, want one more", before, got)
	}
	var provider, kind string
	if err := sqlDB.QueryRow(`SELECT provider, kind FROM ai_calls ORDER BY id DESC LIMIT 1`).Scan(&provider, &kind); err != nil || provider != "openai" || kind != "validate" {
		t.Errorf("last call = %s/%s (%v)", provider, kind, err)
	}
	// A stored key the provider now rejects: key_rejected, never 401.
	storeActiveKeyModel(t, sqlDB, 1, "gemini", "sk-fake-bad-key-0009xxxxx", "gemini-3.8-flash")
	resp = doJSON(t, http.MethodPost, ts.URL, "/api/ai/keys/gemini/test", tok, nil)
	if e := errOf(t, resp); resp.StatusCode != http.StatusUnprocessableEntity || e.Error != "key_rejected" {
		t.Errorf("test bad key: %d %+v", resp.StatusCode, e)
	}
	if resp := doJSON(t, http.MethodPost, ts.URL, "/api/ai/keys/deepseek/test", tok, nil); resp.StatusCode != http.StatusConflict {
		t.Errorf("test without key: %d", resp.StatusCode)
	}
	if resp := doJSON(t, http.MethodPost, ts.URL, "/api/ai/keys/nope/test", tok, nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("test unknown provider: %d", resp.StatusCode)
	}
}

func TestDeleteActiveClearsSelection(t *testing.T) {
	ts, _, tok := aiServer(t, ai.SecretOK)
	putKey(t, ts, tok, "anthropic", map[string]string{"key": aiGoodKey})
	putKey(t, ts, tok, "openai", map[string]string{"key": "sk-fake-openai-key-0002"})
	if r := doJSON(t, http.MethodDelete, ts.URL, "/api/ai/keys/anthropic", tok, nil); r.StatusCode != http.StatusNoContent {
		t.Fatalf("DELETE: %d", r.StatusCode)
	}
	st := statusOf(t, ts, tok)
	if st.Reason != "no_selection" || st.Available || st.Active != nil || len(st.Keys) != 1 || st.Keys[0].Provider != "openai" {
		t.Fatalf("status = %+v (no automatic switch to openai)", st)
	}
	// Deleting twice, or a provider with no key, is fine and removes nothing else.
	for _, id := range []string{"anthropic", "gemini"} {
		if r := doJSON(t, http.MethodDelete, ts.URL, "/api/ai/keys/"+id, tok, nil); r.StatusCode != http.StatusNoContent {
			t.Errorf("DELETE %s: %d", id, r.StatusCode)
		}
	}
	if st := statusOf(t, ts, tok); len(st.Keys) != 1 {
		t.Errorf("keys = %+v", st.Keys)
	}
	// Deleting a non-active key keeps the selection.
	doJSON(t, http.MethodPut, ts.URL, "/api/ai/active", tok, map[string]string{"provider": "openai"})
	putKey(t, ts, tok, "gemini", map[string]string{"key": "sk-fake-gemini-key-0003"})
	doJSON(t, http.MethodDelete, ts.URL, "/api/ai/keys/gemini", tok, nil)
	if st := statusOf(t, ts, tok); st.Active == nil || st.Active.Provider != "openai" {
		t.Errorf("selection lost: %+v", st)
	}
}

func TestActiveRequiresKey(t *testing.T) {
	ts, _, tok := aiServer(t, ai.SecretOK)
	resp := doJSON(t, http.MethodPut, ts.URL, "/api/ai/active", tok, map[string]string{"provider": "openai"})
	if e := errOf(t, resp); resp.StatusCode != http.StatusConflict || e.Error != "no_key" {
		t.Fatalf("active without key: %d %+v", resp.StatusCode, e)
	}
	putKey(t, ts, tok, "anthropic", map[string]string{"key": aiGoodKey})
	putKey(t, ts, tok, "openai", map[string]string{"key": "sk-fake-openai-key-0002"})
	resp = doJSON(t, http.MethodPut, ts.URL, "/api/ai/active", tok, map[string]string{"provider": "openai"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("switch: %d %s", resp.StatusCode, aiBodyOf(t, resp))
	}
	if st := statusOf(t, ts, tok); st.Active.Provider != "openai" || st.Active.Model != "gpt-6-astra" || !st.Active.Vision {
		t.Fatalf("status = %+v", st.Active)
	}
	resp = doJSON(t, http.MethodPut, ts.URL, "/api/ai/active", tok, map[string]string{"provider": "nope"})
	if e := errOf(t, resp); resp.StatusCode != http.StatusNotFound || e.Error != "unknown_provider" {
		t.Errorf("unknown: %d %+v", resp.StatusCode, e)
	}
}

func TestProvidersListHidesBaseURLForUsers(t *testing.T) {
	ts, sqlDB, admin := aiServer(t, ai.SecretOK)
	user := registerUser(t, ts.URL, "bob", admin)
	cs := &ai.CustomStore{DB: sqlDB}
	sp, err := cs.Create(context.Background(), 1, ai.CustomInput{Name: "Company gateway", BaseURL: "https://llm.example.com/v1", DefaultModel: "m", KeyRequired: true})
	if err != nil {
		t.Fatal(err)
	}
	type listing struct {
		Providers []struct {
			ID      string `json:"id"`
			Name    string `json:"name"`
			BaseURL string `json:"baseUrl"`
			Host    string `json:"host"`
			Custom  bool   `json:"custom"`
			KeyURL  string `json:"keyUrl"`
		} `json:"providers"`
		CanManageCustom bool `json:"canManageCustom"`
		PrivateAllowed  bool `json:"privateAllowed"`
	}
	get := func(tok string) (listing, string) {
		resp := doJSON(t, http.MethodGet, ts.URL, "/api/ai/providers", tok, nil)
		body := aiBodyOf(t, resp)
		var l listing
		if err := json.Unmarshal([]byte(body), &l); err != nil || resp.StatusCode != 200 {
			t.Fatalf("GET providers: %d %s", resp.StatusCode, body)
		}
		return l, body
	}
	for name, tok := range map[string]string{"admin": admin, "user": user} {
		l, body := get(tok)
		if len(l.Providers) != 9 || l.Providers[0].ID != "anthropic" || l.Providers[8].ID != sp.ID {
			t.Fatalf("%s: providers = %+v", name, l.Providers)
		}
		for _, p := range l.Providers {
			if !p.Custom && p.BaseURL != "" {
				t.Errorf("%s: built-in %s exposes baseUrl", name, p.ID)
			}
			if p.Custom && p.Host != "llm.example.com" {
				t.Errorf("%s: custom host = %q", name, p.Host)
			}
		}
		custom := l.Providers[8]
		if (name == "admin") != (custom.BaseURL == "https://llm.example.com/v1") {
			t.Errorf("%s: custom baseUrl = %q", name, custom.BaseURL)
		}
		if l.CanManageCustom != (name == "admin") || l.PrivateAllowed {
			t.Errorf("%s: canManageCustom=%v privateAllowed=%v", name, l.CanManageCustom, l.PrivateAllowed)
		}
		for _, bad := range []string{"require_parameters", "max_completion_tokens", "tokenField"} {
			if strings.Contains(body, bad) {
				t.Errorf("%s: listing exposes %s", name, bad)
			}
		}
	}
	if resp := doRaw(t, http.MethodGet, ts.URL, "/api/ai/providers", "", ""); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("anonymous: %d", resp.StatusCode)
	}
}

func TestCrossUserKeysInvisible(t *testing.T) {
	ts, sqlDB, admin := aiServer(t, ai.SecretOK)
	bob := registerUser(t, ts.URL, "bob", admin)
	putKey(t, ts, admin, "openai", map[string]string{"key": "sk-fake-admin-openai-0001"})
	cs := &ai.CustomStore{DB: sqlDB}
	sp, _ := cs.Create(context.Background(), 1, ai.CustomInput{Name: "Local", BaseURL: "https://llm.example.com/v1", DefaultModel: "m", KeyRequired: true})
	putKey(t, ts, admin, sp.ID, map[string]string{"key": "sk-fake-admin-custom-0002"})

	st := statusOf(t, ts, bob)
	if len(st.Keys) != 0 || st.Active != nil || st.Reason != "no_key" {
		t.Fatalf("bob sees %+v", st)
	}
	// Bob testing, activating and removing the admin's providers touches nothing of hers.
	for _, id := range []string{"openai", sp.ID} {
		if r := doJSON(t, http.MethodPost, ts.URL, "/api/ai/keys/"+id+"/test", bob, nil); r.StatusCode != http.StatusConflict {
			t.Errorf("bob test %s: %d, want 409 no_key", id, r.StatusCode)
		}
		r := doJSON(t, http.MethodPut, ts.URL, "/api/ai/active", bob, map[string]string{"provider": id})
		if e := errOf(t, r); r.StatusCode != http.StatusConflict || e.Error != "no_key" {
			t.Errorf("bob activate %s: %d %+v", id, r.StatusCode, e)
		}
		if r := doJSON(t, http.MethodDelete, ts.URL, "/api/ai/keys/"+id, bob, nil); r.StatusCode != http.StatusNoContent {
			t.Errorf("bob delete %s: %d", id, r.StatusCode)
		}
	}
	st = statusOf(t, ts, admin)
	if len(st.Keys) != 2 || st.Active == nil || st.Active.Provider != "openai" {
		t.Fatalf("admin's keys were touched: %+v", st)
	}
	// Bob's own custom key is his own: AAD binds the user, so admin's row never serves him.
	putKey(t, ts, bob, sp.ID, map[string]string{"key": "sk-fake-bob-custom-0003x"})
	var n int
	_ = sqlDB.QueryRow(`SELECT COUNT(*) FROM ai_keys WHERE provider = ?`, sp.ID).Scan(&n)
	if n != 2 {
		t.Errorf("custom key rows = %d, want one per user", n)
	}
}

func TestResponsesAndLogsNeverContainKey(t *testing.T) {
	var buf bytes.Buffer
	log.SetOutput(&buf)
	t.Cleanup(func() { log.SetOutput(io.Discard) })
	ts, sqlDB, admin := aiServer(t, ai.SecretOK)
	bob := registerUser(t, ts.URL, "bob", admin)
	cs := &ai.CustomStore{DB: sqlDB}
	sp, _ := cs.Create(context.Background(), 1, ai.CustomInput{Name: "Local", BaseURL: "https://llm.example.com/v1", DefaultModel: "m", KeyRequired: true})
	var all strings.Builder
	rec := func(resp *http.Response) { all.WriteString(aiBodyOf(t, resp)) }
	for _, id := range []string{"anthropic", "openai", sp.ID} {
		rec(putKey(t, ts, admin, id, map[string]string{"key": aiGoodKey}))
		rec(putKey(t, ts, admin, id, map[string]string{"key": aiBadKey}))
		rec(doJSON(t, http.MethodPost, ts.URL, "/api/ai/keys/"+id+"/test", admin, nil))
		rec(doJSON(t, http.MethodPut, ts.URL, "/api/ai/active", admin, map[string]string{"provider": id}))
	}
	rec(doJSON(t, http.MethodGet, ts.URL, "/api/ai/status", admin, nil))
	rec(doJSON(t, http.MethodGet, ts.URL, "/api/ai/providers", admin, nil))
	rec(doJSON(t, http.MethodGet, ts.URL, "/api/ai/providers", bob, nil))
	for _, bad := range []string{"sk-fake-good", "good-key-0001", "sk-fake-bad", "bad-key"} {
		if strings.Contains(all.String(), bad) {
			t.Errorf("a response contains %q", bad)
		}
		if strings.Contains(buf.String(), bad) {
			t.Errorf("the log contains %q:\n%s", bad, buf.String())
		}
	}
	var dump []byte
	_ = sqlDB.QueryRow(`SELECT group_concat(hex(ciphertext)) FROM ai_keys`).Scan(&dump)
	if strings.Contains(string(dump), "sk-fake") {
		t.Error("db row holds the plain key")
	}
}

func TestNeverHTTP401ForAIErrors(t *testing.T) {
	ts, _, tok := aiServer(t, ai.SecretOK)
	putKey(t, ts, tok, "anthropic", map[string]string{"key": aiGoodKey})
	check := func(label string, resp *http.Response) {
		t.Helper()
		if resp.StatusCode == http.StatusUnauthorized {
			t.Errorf("%s answered 401 with a valid token", label)
		}
	}
	for _, id := range []string{"anthropic", "openai", "gemini", "deepseek", "nope"} {
		check("PUT bad key "+id, putKey(t, ts, tok, id, map[string]string{"key": aiBadKey}))
		check("test "+id, doJSON(t, http.MethodPost, ts.URL, "/api/ai/keys/"+id+"/test", tok, nil))
		check("delete "+id, doJSON(t, http.MethodDelete, ts.URL, "/api/ai/keys/"+id, tok, nil))
		check("activate "+id, doJSON(t, http.MethodPut, ts.URL, "/api/ai/active", tok, map[string]string{"provider": id}))
	}
	for _, rt := range [][2]string{{"GET", "/api/ai/status"}, {"GET", "/api/ai/providers"}, {"PUT", "/api/ai/keys/openai"}, {"POST", "/api/ai/keys/openai/test"}, {"DELETE", "/api/ai/keys/openai"}, {"PUT", "/api/ai/active"}} {
		if resp := doRaw(t, rt[0], ts.URL, rt[1], "", "{}"); resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("%s %s without token: %d", rt[0], rt[1], resp.StatusCode)
		}
	}
	// A provider that answers 401 inside a journal action (fake marker) is key_rejected.
	e := newJournalEnv(t, ai.Fake{}, true)
	e.putEntry(t, e.ws, "e1", "你好。[[fake:401]]")
	resp := e.post(t, "/api/journal/review", map[string]any{"workspaceId": e.ws, "entryId": "e1"})
	if er := errOf(t, resp); resp.StatusCode != http.StatusUnprocessableEntity || er.Error != "key_rejected" {
		t.Errorf("review with provider 401: %d %+v", resp.StatusCode, er)
	}
}

func TestAIKeyLimitCountsAcrossProviders(t *testing.T) {
	ts, _, tok := aiServer(t, ai.SecretOK)
	ids := []string{"anthropic", "openai", "gemini"}
	for i := 1; i <= 31; i++ {
		resp := putKey(t, ts, tok, ids[i%3], map[string]string{"key": aiGoodKey})
		if i <= 30 {
			if resp.StatusCode != http.StatusOK {
				t.Fatalf("PUT %d: %d", i, resp.StatusCode)
			}
			continue
		}
		e := errOf(t, resp)
		if resp.StatusCode != http.StatusTooManyRequests || e.Error != "rate_limited" || resp.Header.Get("Retry-After") == "" {
			t.Fatalf("PUT 31: %d %+v", resp.StatusCode, e)
		}
		if !strings.Contains(e.Message, "30 AI calls this hour") {
			t.Errorf("message = %q", e.Message)
		}
	}
	if got := statusOf(t, ts, tok).Usage.CallsLastHour; got != 30 {
		t.Errorf("calls = %d", got)
	}
}

func TestAIKeyNoSecret(t *testing.T) {
	ts, _, tok := aiServer(t, ai.SecretMissing)
	resp := putKey(t, ts, tok, "anthropic", map[string]string{"key": aiGoodKey})
	e := errOf(t, resp)
	if resp.StatusCode != http.StatusConflict || e.Error != "ai_disabled" || e.Message != "Set QINQIN_SECRET on the server to store an API key." {
		t.Fatalf("missing secret: %d %+v", resp.StatusCode, e)
	}
	if st := statusOf(t, ts, tok); st.Reason != "no_secret" || st.Available {
		t.Fatalf("status = %+v", st)
	}
	ts, _, tok = aiServer(t, ai.SecretInvalid)
	resp = putKey(t, ts, tok, "anthropic", map[string]string{"key": aiGoodKey})
	e = errOf(t, resp)
	if resp.StatusCode != http.StatusConflict || e.Error != "ai_disabled" || e.Message != "QINQIN_SECRET is set but is not 32 bytes of base64." {
		t.Fatalf("invalid secret: %d %+v", resp.StatusCode, e)
	}
	if st := statusOf(t, ts, tok); st.Reason != "invalid_secret" {
		t.Fatalf("status = %+v", st)
	}
}

func TestAIKeyUndecryptable(t *testing.T) {
	ts, sqlDB, tok := aiServer(t, ai.SecretOK)
	putKey(t, ts, tok, "openai", map[string]string{"key": aiGoodKey})
	// The server restarts with another secret.
	svc := testAIService(sqlDB, ai.Fake{}, ai.SecretOK, 9)
	svc.Fake = true
	ts2 := newTestServer(sqlDB, api.New(sqlDB, t.TempDir(), nil, api.WithAI(svc)))
	t.Cleanup(ts2.Close)
	st := statusOf(t, ts2, tok)
	if st.Reason != "key_undecryptable" || st.Key == nil || st.Key.State != ai.KeyUndecryptable {
		t.Fatalf("status = %+v", st)
	}
	if resp := putKey(t, ts2, tok, "openai", map[string]string{"key": aiGoodKey}); resp.StatusCode != http.StatusOK {
		t.Fatalf("re-enter: %d", resp.StatusCode)
	}
	if st := statusOf(t, ts2, tok); !st.Available {
		t.Errorf("not repaired: %+v", st)
	}
}

func TestAIServiceNilIsDisabled(t *testing.T) {
	ts, _ := newServer(t) // no WithAI
	tok := registerUser(t, ts.URL, "root", "")
	if st := statusOf(t, ts, tok); st.Available || st.Reason != "no_secret" {
		t.Fatalf("status = %+v", st)
	}
	if resp := putKey(t, ts, tok, "anthropic", map[string]string{"key": aiGoodKey}); resp.StatusCode != http.StatusConflict {
		t.Fatalf("PUT without service: %d", resp.StatusCode)
	}
	resp := doJSON(t, http.MethodGet, ts.URL, "/api/ai/providers", tok, nil)
	if resp.StatusCode != http.StatusOK {
		t.Errorf("providers without a service: %d", resp.StatusCode)
	}
}

func TestAIKeyDeleteWithoutSecret(t *testing.T) {
	ts, sqlDB, tok := aiServer(t, ai.SecretOK)
	putKey(t, ts, tok, "anthropic", map[string]string{"key": aiGoodKey})
	// The server restarts without a usable secret: no key store at all.
	for _, secret := range []ai.SecretState{ai.SecretMissing, ai.SecretInvalid} {
		svc := testAIService(sqlDB, ai.Fake{}, secret, 0)
		svc.Fake = true
		ts2 := newTestServer(sqlDB, api.New(sqlDB, t.TempDir(), nil, api.WithAI(svc)))
		t.Cleanup(ts2.Close)
		if st := statusOf(t, ts2, tok); st.Reason == "" {
			t.Fatalf("%s: status = %+v", secret, st)
		}
	}
	svc := testAIService(sqlDB, ai.Fake{}, ai.SecretMissing, 0)
	svc.Fake = true
	ts2 := newTestServer(sqlDB, api.New(sqlDB, t.TempDir(), nil, api.WithAI(svc)))
	t.Cleanup(ts2.Close)
	if resp := doJSON(t, http.MethodDelete, ts2.URL, "/api/ai/keys/anthropic", tok, nil); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("DELETE: %d", resp.StatusCode)
	}
	var n, sel int
	_ = sqlDB.QueryRow(`SELECT COUNT(*) FROM ai_keys`).Scan(&n)
	_ = sqlDB.QueryRow(`SELECT COUNT(*) FROM ai_selection`).Scan(&sel)
	if n != 0 || sel != 0 {
		t.Fatalf("rows after DELETE: keys=%d selection=%d", n, sel)
	}
}

// repairing is an adapter whose review needed a repair request: it reports two calls.
type repairing struct{ ai.Fake }

func (repairing) Review(_ context.Context, c ai.Credentials, r ai.ReviewRequest) (ai.ReviewReply, error) {
	return ai.ReviewReply{Model: c.Model, Usage: ai.Usage{InputTokens: 7, OutputTokens: 3}, Overall: ai.Overall{Summary: "s", Strengths: []string{}, Focus: []string{}},
		Calls: []ai.CallUsage{{Kind: "review", Usage: ai.Usage{InputTokens: 4, OutputTokens: 1}}, {Kind: "review-repair", Usage: ai.Usage{InputTokens: 3, OutputTokens: 2}}}}, nil
}

func TestRepairRecordsOwnCallRow(t *testing.T) {
	e := newJournalEnv(t, repairing{}, false)
	storeActiveKey(t, e.db, 1, "openai", aiGoodKey)
	e.putEntry(t, e.ws, "e1", "你好。")
	if r := e.post(t, "/api/journal/review", map[string]any{"workspaceId": e.ws, "entryId": "e1"}); r.StatusCode != 200 {
		t.Fatalf("review: %d %s", r.StatusCode, aiBodyOf(t, r))
	}
	rows, err := e.db.Query(`SELECT kind, provider, ok, input_tokens, output_tokens FROM ai_calls ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var got []string
	for rows.Next() {
		var kind, provider string
		var ok, in, out int
		_ = rows.Scan(&kind, &provider, &ok, &in, &out)
		got = append(got, fmt.Sprintf("%s/%s/%d/%d/%d", kind, provider, ok, in, out))
	}
	want := []string{"review/openai/1/4/1", "review-repair/openai/1/3/2"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("ai_calls = %v, want %v", got, want)
	}
	// Both rows count toward the hour.
	if n := statusOfEnv(t, e).Usage.CallsLastHour; n != 2 {
		t.Errorf("calls last hour = %d, want 2", n)
	}
}

func statusOfEnv(t *testing.T, e journalEnv) ai.Status {
	t.Helper()
	var st ai.Status
	decodeJSON(t, doJSON(t, http.MethodGet, e.url, "/api/ai/status", e.token, nil), &st)
	return st
}

func TestReviewUsesActiveProvider(t *testing.T) {
	e := newJournalEnv(t, ai.Fake{}, false)
	storeActiveKeyModel(t, e.db, 1, "mistral", aiGoodKey, "mistral-small-latest")
	e.putEntry(t, e.ws, "e1", "我昨天去学校。")
	resp := e.post(t, "/api/journal/review", map[string]any{"workspaceId": e.ws, "entryId": "e1"})
	var rev journal.Review
	decodeJSON(t, resp, &rev)
	if resp.StatusCode != 200 || rev.Provider != "mistral" || rev.Model != "mistral-small-latest" {
		t.Fatalf("review = %d %+v", resp.StatusCode, rev)
	}
	raw, _ := e.doc(t, e.ws, "review:e1")
	if !strings.Contains(string(raw), `"provider":"mistral"`) {
		t.Errorf("stored review lacks the provider: %s", raw)
	}
	resp = e.post(t, "/api/journal/suggestions", map[string]any{"workspaceId": e.ws})
	var sg journal.Suggestions
	decodeJSON(t, resp, &sg)
	if sg.Provider != "mistral" {
		t.Errorf("suggestions provider = %q", sg.Provider)
	}
	var n int
	_ = e.db.QueryRow(`SELECT COUNT(*) FROM ai_calls WHERE provider = 'mistral'`).Scan(&n)
	if n != 2 {
		t.Errorf("ai_calls rows for mistral = %d, want 2", n)
	}
}

// Every AI route resolves the selection of the requesting user: bob's calls
// never use alice's provider or key.
func TestSelectionCheckedOnEveryAIRoute(t *testing.T) {
	e := newJournalEnvOpts(t, ai.Fake{}, false, api.WithOCR(newOCR()))
	storeActiveKey(t, e.db, 1, "openai", aiGoodKey)
	bob := registerUser(t, e.url, "bob", e.token)
	bobWS := createWorkspace(t, e.url, bob, "zh", "")
	post := func(path string, body map[string]any) (int, aiErrBody) {
		resp := doJSON(t, http.MethodPost, e.url, path, bob, body)
		return resp.StatusCode, errOf(t, resp)
	}
	e.putEntry(t, e.ws, "e1", "你好。")
	// Bob writes his own entry (the plugin data route is per user) and has no key.
	body, _ := json.Marshal(map[string]any{"date": "2026-11-15", "title": "T", "text": "你好。", "source": "typed"})
	if r := doRaw(t, http.MethodPut, e.url, "/api/journal/entries/b1?workspace="+strconv.FormatInt(bobWS, 10), bob, string(body)); r.StatusCode != 200 {
		t.Fatalf("bob entry: %d", r.StatusCode)
	}
	photo := e.uploadOK(t, bob, bobWS)
	for name, call := range map[string]func() (int, aiErrBody){
		"review": func() (int, aiErrBody) {
			return post("/api/journal/review", map[string]any{"workspaceId": bobWS, "entryId": "b1"})
		},
		"suggestions": func() (int, aiErrBody) { return post("/api/journal/suggestions", map[string]any{"workspaceId": bobWS}) },
		"transcribe": func() (int, aiErrBody) {
			return post("/api/journal/transcribe", map[string]any{"workspaceId": bobWS, "photoId": photo, "engine": "ai"})
		},
	} {
		if status, er := call(); status != 409 || er.Error != "no_key" {
			t.Errorf("%s as bob without a key: %d %+v", name, status, er)
		}
	}
	// Bob stores his own key for another provider: his calls go there, alice's stay on hers.
	if r := putKey2(t, e.url, bob, "gemini", map[string]string{"key": "sk-fake-bob-gemini-0001x"}); r.StatusCode != 200 {
		t.Fatalf("bob key: %d", r.StatusCode)
	}
	resp := doJSON(t, http.MethodPost, e.url, "/api/journal/review", bob, map[string]any{"workspaceId": bobWS, "entryId": "b1"})
	var rev journal.Review
	decodeJSON(t, resp, &rev)
	if resp.StatusCode != 200 || rev.Provider != "gemini" {
		t.Fatalf("bob review = %d %+v", resp.StatusCode, rev)
	}
	resp = e.post(t, "/api/journal/review", map[string]any{"workspaceId": e.ws, "entryId": "e1"})
	decodeJSON(t, resp, &rev)
	if resp.StatusCode != 200 || rev.Provider != "openai" {
		t.Fatalf("alice review = %d %+v", resp.StatusCode, rev)
	}
	var bobCalls, aliceCalls int
	_ = e.db.QueryRow(`SELECT COUNT(*) FROM ai_calls WHERE provider = 'gemini'`).Scan(&bobCalls)
	_ = e.db.QueryRow(`SELECT COUNT(*) FROM ai_calls WHERE provider = 'openai'`).Scan(&aliceCalls)
	if bobCalls != 2 || aliceCalls != 1 { // bob: validate + review; alice: review
		t.Errorf("rows gemini=%d openai=%d", bobCalls, aliceCalls)
	}
}

func putKey2(t *testing.T, url, tok, provider string, body map[string]string) *http.Response {
	t.Helper()
	return doJSON(t, http.MethodPut, url, "/api/ai/keys/"+provider, tok, body)
}

func TestTranscribeNoVision(t *testing.T) {
	ocr := newOCR()
	e := newJournalEnvOpts(t, ai.Fake{}, false, api.WithOCR(ocr))
	storeActiveKeyModel(t, e.db, 1, "deepseek", aiGoodKey, "deepseek-v4-pro")
	photo := e.uploadOK(t, e.token, e.ws)
	status, out := e.transcribe(t, e.token, e.ws, photo, "ai")
	if status != 409 || out["error"] != "no_vision" {
		t.Fatalf("%d %v", status, out)
	}
	if msg, _ := out["message"].(string); !strings.Contains(msg, "deepseek-v4-pro") || !strings.Contains(msg, "DeepSeek") || !strings.Contains(msg, "Read it offline instead.") {
		t.Errorf("message = %q", msg)
	}
	var n int
	_ = e.db.QueryRow(`SELECT COUNT(*) FROM ai_calls`).Scan(&n)
	if n != 0 {
		t.Errorf("%d ai_calls rows: the provider must not be called", n)
	}
	if ocr.calls.Load() != 0 {
		t.Error("no silent fallback to offline OCR")
	}
	// A vision-capable model on the same provider works.
	ks := testAIService(e.db, ai.Fake{}, ai.SecretOK, 7).Keys
	if err := ks.SetModel(context.Background(), 1, "deepseek", "deepseek-flash"); err != nil {
		t.Fatal(err)
	}
	if status, out := e.transcribe(t, e.token, e.ws, photo, "ai"); status != 200 || out["engine"] != "ai" {
		t.Errorf("deepseek-flash: %d %v", status, out)
	}
}

// counting is an adapter whose key check needed a second call (a custom
// endpoint without /models falls back to a chat call).
type counting struct {
	ai.Fake
	calls int
}

func (c counting) ValidateCounted(context.Context, ai.Credentials) (int, error) { return c.calls, nil }

func TestValidateFallbackRecordsEveryCall(t *testing.T) {
	sqlDB := dbtest.Open(t)
	svc := testAIService(sqlDB, counting{calls: 2}, ai.SecretOK, 7)
	ts := newTestServer(sqlDB, api.New(sqlDB, t.TempDir(), nil, api.WithAI(svc)))
	t.Cleanup(ts.Close)
	tok := registerUser(t, ts.URL, "root", "")
	if r := putKey(t, ts, tok, "openai", map[string]string{"key": aiGoodKey}); r.StatusCode != 200 {
		t.Fatalf("PUT: %d", r.StatusCode)
	}
	var n int
	_ = sqlDB.QueryRow(`SELECT COUNT(*) FROM ai_calls WHERE kind = 'validate' AND provider = 'openai'`).Scan(&n)
	if n != 2 {
		t.Errorf("validate rows = %d, want 2 (the limiter must stay honest)", n)
	}
	if got := statusOf(t, ts, tok).Usage.CallsLastHour; got != 2 {
		t.Errorf("calls last hour = %d", got)
	}
}
