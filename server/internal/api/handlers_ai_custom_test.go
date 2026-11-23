package api_test

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"qinqin/internal/ai"
	"qinqin/internal/ai/aitest"
	"qinqin/internal/api"
	"qinqin/internal/dbtest"
	"qinqin/internal/journal"
)

type customEnv struct {
	ts         *httptest.Server
	db         *sql.DB
	admin, bob string
	svc        *ai.Service
}

func newCustomEnv(t *testing.T, private bool, enabled map[string]bool) customEnv {
	t.Helper()
	sqlDB := dbtest.Open(t)
	svc := testAIService(sqlDB, ai.Fake{}, ai.SecretOK, 7)
	svc.Fake = true
	svc.Registry.Custom.Policy = ai.GuardPolicy{AllowPrivate: private}
	svc.Registry.Enabled = enabled
	ts := httptest.NewServer(api.New(sqlDB, t.TempDir(), nil, api.WithAI(svc)))
	t.Cleanup(ts.Close)
	admin := registerUser(t, ts.URL, "root", "")
	return customEnv{ts: ts, db: sqlDB, admin: admin, bob: registerUser(t, ts.URL, "bob", admin), svc: svc}
}

func (e customEnv) create(t *testing.T, tok string, body map[string]any) *http.Response {
	t.Helper()
	return doJSON(t, http.MethodPost, e.ts.URL, "/api/ai/custom-providers", tok, body)
}

func validCustom() map[string]any {
	return map[string]any{"name": "Company gateway", "baseUrl": "https://llm.example.com/v1", "defaultModel": "llama3.2:3b",
		"vision": true, "keyRequired": true, "structured": "json_schema"}
}

func TestCustomNonAdmin403(t *testing.T) {
	e := newCustomEnv(t, false, nil)
	resp := e.create(t, e.admin, validCustom())
	var sp ai.ProviderSpec
	decodeJSON(t, resp, &sp)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("admin create: %d", resp.StatusCode)
	}
	for _, c := range []struct{ method, path string }{
		{"POST", "/api/ai/custom-providers"}, {"PATCH", "/api/ai/custom-providers/" + sp.ID}, {"DELETE", "/api/ai/custom-providers/" + sp.ID},
	} {
		resp := doJSON(t, c.method, e.ts.URL, c.path, e.bob, validCustom())
		er := errOf(t, resp)
		if resp.StatusCode != http.StatusForbidden || er.Error != "forbidden" || er.Message == "" {
			t.Errorf("bob %s %s: %d %+v", c.method, c.path, resp.StatusCode, er)
		}
		if resp := doRaw(t, c.method, e.ts.URL, c.path, "", "{}"); resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("anonymous %s: %d", c.method, resp.StatusCode)
		}
	}
	var n int
	_ = e.db.QueryRow(`SELECT COUNT(*) FROM ai_custom_providers`).Scan(&n)
	if n != 1 {
		t.Errorf("rows = %d: a non-admin changed something", n)
	}
}

func TestCustomCreateShape(t *testing.T) {
	e := newCustomEnv(t, false, nil)
	resp := e.create(t, e.admin, validCustom())
	var sp ai.ProviderSpec
	body := aiBodyOf(t, resp)
	_ = json.Unmarshal([]byte(body), &sp)
	if resp.StatusCode != http.StatusCreated || !sp.Custom || sp.BaseURL != "https://llm.example.com/v1" || sp.Name != "Company gateway" || !sp.Vision || !strings.HasPrefix(sp.ID, "custom-") {
		t.Fatalf("create = %d %s", resp.StatusCode, body)
	}
	if r := doRaw(t, http.MethodPost, e.ts.URL, "/api/ai/custom-providers", e.admin, strings.Repeat("x", 5000)); r.StatusCode != http.StatusRequestEntityTooLarge {
		t.Errorf("oversized body: %d", r.StatusCode)
	}
	if r := doRaw(t, http.MethodPost, e.ts.URL, "/api/ai/custom-providers", e.admin, "nope"); r.StatusCode != http.StatusBadRequest {
		t.Errorf("bad json: %d", r.StatusCode)
	}
	bad := validCustom()
	bad["name"], bad["defaultModel"] = "Other", "a b"
	if er := errOf(t, e.create(t, e.admin, bad)); er.Error != "invalid_endpoint" {
		t.Errorf("bad model: %+v", er)
	}
}

func TestCustomBlockedURLs(t *testing.T) {
	e := newCustomEnv(t, false, nil)
	for url, wantInMsg := range map[string]string{
		"http://169.254.169.254/v1":         "never allowed",
		"https://169.254.169.254/":          "never allowed",
		"https://[::ffff:169.254.169.254]/": "never allowed",
		"http://127.0.0.1:11434/v1":         "QINQIN_AI_ALLOW_PRIVATE=1",
		"https://10.0.0.5/v1":               "Private network addresses are off. Set QINQIN_AI_ALLOW_PRIVATE=1 to allow them.",
		"http://llm.example.com/v1":         "https",
		"https://u:p@llm.example.com/":      "user name",
		"https://llm.example.com/v1?k=1":    "query",
		"http://2130706433/":                "plain IP",
	} {
		body := validCustom()
		body["baseUrl"] = url
		resp := e.create(t, e.admin, body)
		raw := aiBodyOf(t, resp)
		var er aiErrBody
		_ = json.Unmarshal([]byte(raw), &er)
		if resp.StatusCode != http.StatusUnprocessableEntity || er.Error != "endpoint_blocked" || !strings.Contains(er.Message, wantInMsg) {
			t.Errorf("%s: %d %s (want message with %q)", url, resp.StatusCode, raw, wantInMsg)
		}
		if strings.Contains(raw, "p@") || strings.Contains(raw, "k=1") {
			t.Errorf("%s: response echoes URL secrets: %s", url, raw)
		}
	}
	var n int
	_ = e.db.QueryRow(`SELECT COUNT(*) FROM ai_custom_providers`).Scan(&n)
	if n != 0 {
		t.Errorf("%d rows created from blocked URLs", n)
	}
}

func TestCustomPrivateWithSwitch(t *testing.T) {
	e := newCustomEnv(t, true, nil)
	body := validCustom()
	body["baseUrl"] = "http://127.0.0.1:11434/v1"
	body["keyRequired"] = false
	if resp := e.create(t, e.admin, body); resp.StatusCode != http.StatusCreated {
		t.Fatalf("loopback with the switch: %d %s", resp.StatusCode, aiBodyOf(t, resp))
	}
	var pl struct {
		PrivateAllowed bool `json:"privateAllowed"`
	}
	decodeJSON(t, doJSON(t, http.MethodGet, e.ts.URL, "/api/ai/providers", e.admin, nil), &pl)
	if !pl.PrivateAllowed {
		t.Error("privateAllowed not reported")
	}
	body = validCustom()
	body["name"], body["baseUrl"] = "Meta", "http://169.254.169.254/v1"
	if er := errOf(t, e.create(t, e.admin, body)); er.Error != "endpoint_blocked" {
		t.Errorf("metadata with the switch: %+v", er)
	}
}

func TestCustomPatchImmutableFields(t *testing.T) {
	e := newCustomEnv(t, false, nil)
	var sp ai.ProviderSpec
	decodeJSON(t, e.create(t, e.admin, validCustom()), &sp)
	for _, field := range []map[string]any{{"baseUrl": "https://evil.example.com/v1"}, {"name": "Renamed"}, {"keyRequired": false}} {
		resp := doJSON(t, http.MethodPatch, e.ts.URL, "/api/ai/custom-providers/"+sp.ID, e.admin, field)
		if er := errOf(t, resp); resp.StatusCode != http.StatusUnprocessableEntity || er.Error != "invalid_endpoint" {
			t.Errorf("PATCH %v: %d %+v", field, resp.StatusCode, er)
		}
	}
	resp := doJSON(t, http.MethodPatch, e.ts.URL, "/api/ai/custom-providers/"+sp.ID, e.admin,
		map[string]any{"defaultModel": "new-model", "vision": false, "structured": "prompt", "maxOutputTokens": 2000})
	var up ai.ProviderSpec
	decodeJSON(t, resp, &up)
	if resp.StatusCode != 200 || up.DefaultModel != "new-model" || up.Vision || up.Structured != ai.StructuredPrompt || up.MaxOutputTokens != 2000 || up.BaseURL != sp.BaseURL || up.Name != sp.Name {
		t.Fatalf("PATCH = %d %+v", resp.StatusCode, up)
	}
	if r := doJSON(t, http.MethodPatch, e.ts.URL, "/api/ai/custom-providers/custom-aaaaaaaaaa", e.admin, map[string]any{"vision": true}); r.StatusCode != http.StatusNotFound {
		t.Errorf("PATCH unknown: %d", r.StatusCode)
	}
	if er := errOf(t, doJSON(t, http.MethodPatch, e.ts.URL, "/api/ai/custom-providers/"+sp.ID, e.admin, map[string]any{"structured": "xml"})); er.Error != "invalid_endpoint" {
		t.Errorf("bad structured: %+v", er)
	}
}

func TestCustomLookalikeName(t *testing.T) {
	e := newCustomEnv(t, false, nil)
	for _, name := range []string{"OpenAI", "openai", "Open AI", "Google Gemini", "Anthropic", "xAI"} {
		body := validCustom()
		body["name"] = name
		if resp := e.create(t, e.admin, body); resp.StatusCode != http.StatusUnprocessableEntity {
			t.Errorf("%q: %d", name, resp.StatusCode)
		}
	}
}

func TestCustomDeleteRemovesKeysAndSelection(t *testing.T) {
	e := newCustomEnv(t, false, nil)
	var sp ai.ProviderSpec
	decodeJSON(t, e.create(t, e.admin, validCustom()), &sp)
	for _, tok := range []string{e.admin, e.bob} {
		if r := putKey(t, e.ts, tok, sp.ID, map[string]string{"key": aiGoodKey}); r.StatusCode != 200 {
			t.Fatalf("store custom key: %d %s", r.StatusCode, aiBodyOf(t, r))
		}
	}
	putKey(t, e.ts, e.admin, "openai", map[string]string{"key": "sk-fake-openai-key-0002"})
	if st := statusOf(t, e.ts, e.bob); st.Active == nil || st.Active.Provider != sp.ID || !st.Available {
		t.Fatalf("bob status = %+v", st)
	}
	resp := doJSON(t, http.MethodDelete, e.ts.URL, "/api/ai/custom-providers/"+sp.ID, e.admin, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("DELETE: %d %s", resp.StatusCode, aiBodyOf(t, resp))
	}
	for _, q := range []string{`SELECT COUNT(*) FROM ai_keys WHERE provider LIKE 'custom-%'`, `SELECT COUNT(*) FROM ai_selection WHERE provider LIKE 'custom-%'`, `SELECT COUNT(*) FROM ai_custom_providers`} {
		var n int
		_ = e.db.QueryRow(q).Scan(&n)
		if n != 0 {
			t.Errorf("%s = %d", q, n)
		}
	}
	for name, tok := range map[string]string{"admin": e.admin, "bob": e.bob} {
		st := statusOf(t, e.ts, tok)
		if st.Active != nil || st.Available {
			t.Errorf("%s status = %+v", name, st)
		}
	}
	if st := statusOf(t, e.ts, e.bob); st.Reason != "no_key" {
		t.Errorf("bob reason = %q", st.Reason)
	}
	if st := statusOf(t, e.ts, e.admin); st.Reason != "no_selection" || len(st.Keys) != 1 || st.Keys[0].Provider != "openai" {
		t.Errorf("admin status = %+v (the openai key stays, no automatic switch)", st)
	}
	if r := doJSON(t, http.MethodDelete, e.ts.URL, "/api/ai/custom-providers/"+sp.ID, e.admin, nil); r.StatusCode != http.StatusNotFound {
		t.Errorf("second DELETE: %d", r.StatusCode)
	}
}

func TestCustomRoutesDisabledWhenCustomOff(t *testing.T) {
	e := newCustomEnv(t, false, map[string]bool{"anthropic": true, "openai": true})
	for _, c := range []struct{ method, path string }{
		{"POST", "/api/ai/custom-providers"}, {"PATCH", "/api/ai/custom-providers/custom-aaaaaaaaaa"}, {"DELETE", "/api/ai/custom-providers/custom-aaaaaaaaaa"},
	} {
		resp := doJSON(t, c.method, e.ts.URL, c.path, e.admin, validCustom())
		if er := errOf(t, resp); resp.StatusCode != http.StatusConflict || er.Error != "provider_disabled" {
			t.Errorf("%s %s: %d %+v", c.method, c.path, resp.StatusCode, er)
		}
	}
	var l struct {
		Providers       []struct{ ID string } `json:"providers"`
		CanManageCustom bool                  `json:"canManageCustom"`
	}
	decodeJSON(t, doJSON(t, http.MethodGet, e.ts.URL, "/api/ai/providers", e.admin, nil), &l)
	if len(l.Providers) != 2 || l.CanManageCustom {
		t.Errorf("providers = %+v canManage = %v", l.Providers, l.CanManageCustom)
	}
	// A key for a disabled provider cannot be stored or activated.
	if er := errOf(t, putKey(t, e.ts, e.admin, "gemini", map[string]string{"key": aiGoodKey})); er.Error != "provider_disabled" {
		t.Errorf("PUT disabled provider: %+v", er)
	}
}

// A database writer without QINQIN_SECRET repoints the endpoint: the stored
// key (bound to the old base URL) can no longer be opened, so it cannot be
// delivered to the new host.
func TestCustomKeyBoundToBaseURLThroughAPI(t *testing.T) {
	e := newCustomEnv(t, false, nil)
	var sp ai.ProviderSpec
	decodeJSON(t, e.create(t, e.admin, validCustom()), &sp)
	if r := putKey(t, e.ts, e.bob, sp.ID, map[string]string{"key": aiGoodKey}); r.StatusCode != 200 {
		t.Fatalf("store: %d", r.StatusCode)
	}
	if st := statusOf(t, e.ts, e.bob); !st.Available {
		t.Fatalf("not available before: %+v", st)
	}
	if _, err := e.db.Exec(`UPDATE ai_custom_providers SET base_url = 'https://evil.example.com/v1' WHERE id = ?`, sp.ID); err != nil {
		t.Fatal(err)
	}
	st := statusOf(t, e.ts, e.bob)
	if st.Available || st.Reason != "key_undecryptable" || st.Key == nil || st.Key.State != ai.KeyUndecryptable {
		t.Errorf("status after repointing = %+v", st)
	}
}

func TestCustomEndToEndWithAitest(t *testing.T) {
	fake := &aitest.OpenAI{}
	fakeSrv := httptest.NewServer(fake)
	t.Cleanup(fakeSrv.Close)
	var buf bytes.Buffer
	logSink(t, &buf)

	e := newJournalEnvSvc(t, func(sqlDB *sql.DB) *ai.Service {
		svc := testAIService(sqlDB, ai.Fake{}, ai.SecretOK, 7)
		policy := ai.GuardPolicy{AllowPrivate: true}
		svc.Registry.Custom.Policy = policy
		svc.Adapters = map[ai.Kind]ai.Provider{
			ai.KindOpenAI: &ai.OpenAICompat{HTTP: ai.NewBuiltinClient(nil), CustomHTTP: ai.NewGuardedClient(policy, nil), Spec: svc.Registry.Lookup},
		}
		return svc
	}, false)
	bob := registerUser(t, e.url, "bob", e.token)
	bobWS := createWorkspace(t, e.url, bob, "zh", "")

	resp := doJSON(t, http.MethodPost, e.url, "/api/ai/custom-providers", e.token, map[string]any{
		"name": "Local fake", "baseUrl": fakeSrv.URL + "/v1", "defaultModel": "fake-model", "vision": true, "keyRequired": true, "structured": "json_schema"})
	var sp ai.ProviderSpec
	decodeJSON(t, resp, &sp)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create: %d", resp.StatusCode)
	}
	const key = "sk-fake-e2e-key-0001xx"
	if r := doJSON(t, http.MethodPut, e.url, "/api/ai/keys/"+sp.ID, bob, map[string]string{"key": key}); r.StatusCode != 200 {
		t.Fatalf("store key: %d %s", r.StatusCode, aiBodyOf(t, r))
	}
	if st := statusOfTok(t, e.url, bob); st.Active == nil || st.Active.Provider != sp.ID || st.Active.Model != "fake-model" {
		t.Fatalf("status = %+v", st)
	}
	body, _ := json.Marshal(map[string]any{"id": "b1", "date": "2026-11-15", "title": "T", "text": "你好世界。", "source": "typed"})
	if r := doRaw(t, http.MethodPut, e.url, "/api/plugins/qinqin-journal/data/entry:b1?workspace="+itoa(bobWS), bob, string(body)); r.StatusCode != 200 {
		t.Fatalf("entry: %d", r.StatusCode)
	}
	resp = doJSON(t, http.MethodPost, e.url, "/api/journal/review", bob, map[string]any{"workspaceId": bobWS, "entryId": "b1"})
	var rev journal.Review
	decodeJSON(t, resp, &rev)
	if resp.StatusCode != 200 || rev.Provider != sp.ID || rev.Model != "fake-model" || len(rev.Annotations) != 1 {
		t.Fatalf("review = %d %+v", resp.StatusCode, rev)
	}
	var sawChat, sawModels bool
	for _, r := range fake.Requests() {
		if r.Auth != "Bearer "+key {
			t.Errorf("%s %s Authorization = %q", r.Method, r.Path, r.Auth)
		}
		if r.Path == "/v1/chat/completions" {
			sawChat = true
			if !strings.Contains(string(r.Body), "entry_") || !strings.Contains(string(r.Body), "你好世界") {
				t.Errorf("chat request lacks the nonce-tagged entry")
			}
		}
		if r.Path == "/v1/models" {
			sawModels = true
		}
	}
	if !sawChat || !sawModels {
		t.Errorf("fake saw chat=%v models=%v", sawChat, sawModels)
	}
	// A bad key is key_rejected (422), and the blocked-address guard still holds
	// for a name that resolves to the metadata address.
	if er := errOf(t, doJSON(t, http.MethodPut, e.url, "/api/ai/keys/"+sp.ID, bob, map[string]string{"key": "sk-fake-bad-key-0002xxxxx"})); er.Error != "key_rejected" {
		t.Errorf("bad key: %+v", er)
	}
	for _, bad := range []string{key, "sk-fake-e2e"} {
		if strings.Contains(buf.String(), bad) {
			t.Errorf("log contains the key:\n%s", buf.String())
		}
	}
}

func logSink(t *testing.T, w io.Writer) {
	t.Helper()
	log.SetOutput(w)
	t.Cleanup(func() { log.SetOutput(io.Discard) })
}

func statusOfTok(t *testing.T, url, tok string) ai.Status {
	t.Helper()
	var st ai.Status
	decodeJSON(t, doJSON(t, http.MethodGet, url, "/api/ai/status", tok, nil), &st)
	return st
}

func TestCustomPatchNullClearsMaxOutputTokens(t *testing.T) {
	e := newCustomEnv(t, false, nil)
	body := validCustom()
	body["maxOutputTokens"] = 2048
	var sp ai.ProviderSpec
	decodeJSON(t, e.create(t, e.admin, body), &sp)
	if sp.MaxOutputTokens != 2048 {
		t.Fatalf("created = %+v", sp)
	}
	resp := doRaw(t, http.MethodPatch, e.ts.URL, "/api/ai/custom-providers/"+sp.ID, e.admin, `{"maxOutputTokens": null}`)
	var up ai.ProviderSpec
	decodeJSON(t, resp, &up)
	if resp.StatusCode != 200 || up.MaxOutputTokens != 0 {
		t.Errorf("PATCH null = %d %+v", resp.StatusCode, up)
	}
	// An absent field changes nothing.
	resp = doJSON(t, http.MethodPatch, e.ts.URL, "/api/ai/custom-providers/"+sp.ID, e.admin, map[string]any{"vision": true})
	decodeJSON(t, resp, &up)
	if !up.Vision {
		t.Errorf("vision not set: %+v", up)
	}
}
