package api_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"testing"

	"qinqin/internal/lang"
)

// workspaceBody mirrors the JSON body of the /api/workspaces routes.
type workspaceBody struct {
	ID        int64           `json:"id"`
	Language  string          `json:"language"`
	Settings  json.RawMessage `json:"settings"`
	UpdatedAt string          `json:"updatedAt"`
}

// registerUser creates a user through the API — without a token for the
// first user (the instance admin), with an admin token afterwards — and
// returns the new user's bearer token.
func registerUser(t *testing.T, tsURL, username, adminToken string) string {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"username": username, "password": "pw-" + username})
	req, err := http.NewRequest(http.MethodPost, tsURL+"/api/auth/register", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("build register request: %v", err)
	}
	if adminToken != "" {
		req.Header.Set("Authorization", "Bearer "+adminToken)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("register %s: %v", username, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("register %s: status = %d, want %d", username, resp.StatusCode, http.StatusCreated)
	}
	return login(t, tsURL, username)
}

// login returns a fresh bearer token for username.
func login(t *testing.T, tsURL, username string) string {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"username": username, "password": "pw-" + username})
	resp, err := http.Post(tsURL+"/api/auth/login", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("login %s: %v", username, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("login %s: status = %d, want %d", username, resp.StatusCode, http.StatusOK)
	}
	var out struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("decode login response: %v", err)
	}
	return out.Token
}

// doJSON performs a JSON request with the given bearer token ("" for
// none) and returns the undecoded response.
func doJSON(t *testing.T, method, tsURL, path, token string, body any) *http.Response {
	t.Helper()
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal request body: %v", err)
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, tsURL+path, rdr)
	if err != nil {
		t.Fatalf("build %s %s: %v", method, path, err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}

// decodeJSON decodes resp into v, failing the test on error.
func decodeJSON(t *testing.T, resp *http.Response, v any) {
	t.Helper()
	if err := json.NewDecoder(resp.Body).Decode(v); err != nil {
		t.Fatalf("decode response: %v", err)
	}
}

func TestWorkspaceCrud(t *testing.T) {
	// zh registers as a code pack, exactly as main.go does for the server.
	lang.Register(lang.Zh{})

	ts, sqlDB := newServer(t)
	alice := registerUser(t, ts.URL, "alice", "")

	// Creating a workspace for a code-pack language needs no language row.
	zh := doJSON(t, http.MethodPost, ts.URL, "/api/workspaces", alice, map[string]string{"language": "zh"})
	if zh.StatusCode != http.StatusCreated {
		t.Fatalf("POST zh workspace: status = %d, want %d", zh.StatusCode, http.StatusCreated)
	}
	var zhWS workspaceBody
	decodeJSON(t, zh, &zhWS)
	if zhWS.ID == 0 || zhWS.Language != "zh" || string(zhWS.Settings) != "{}" {
		t.Errorf("created workspace = %+v, want zh with empty settings", zhWS)
	}
	if zhWS.UpdatedAt == "" {
		t.Error("created workspace has no updatedAt")
	}

	// One workspace per (user, language).
	again := doJSON(t, http.MethodPost, ts.URL, "/api/workspaces", alice, map[string]string{"language": "zh"})
	if again.StatusCode != http.StatusConflict {
		t.Errorf("POST duplicate zh workspace: status = %d, want %d", again.StatusCode, http.StatusConflict)
	}

	// Unknown codes auto-register as data-only languages.
	es := doJSON(t, http.MethodPost, ts.URL, "/api/workspaces", alice, map[string]string{"language": "es"})
	if es.StatusCode != http.StatusCreated {
		t.Fatalf("POST es workspace: status = %d, want %d", es.StatusCode, http.StatusCreated)
	}
	var esWS workspaceBody
	decodeJSON(t, es, &esWS)
	if esWS.Language != "es" {
		t.Errorf("created workspace = %+v, want es", esWS)
	}
	var name string
	if err := sqlDB.QueryRow(`SELECT name FROM languages WHERE code = 'es'`).Scan(&name); err != nil {
		t.Fatalf("es language row: %v (want auto-registered)", err)
	}
	if name != "es" {
		t.Errorf("es language name = %q, want %q", name, "es")
	}
	var zhRows int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM languages WHERE code = 'zh'`).Scan(&zhRows); err != nil {
		t.Fatalf("zh language rows: %v (want none — zh is a code pack)", err)
	}
	if zhRows != 0 {
		t.Errorf("zh language rows = %d, want 0 (zh is a code pack, not data-only)", zhRows)
	}

	// A language is required.
	if resp := doJSON(t, http.MethodPost, ts.URL, "/api/workspaces", alice, map[string]string{"language": ""}); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("POST empty language: status = %d, want %d", resp.StatusCode, http.StatusBadRequest)
	}
	if resp := doJSON(t, http.MethodPost, ts.URL, "/api/workspaces", alice, "not-an-object"); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("POST malformed body: status = %d, want %d", resp.StatusCode, http.StatusBadRequest)
	}

	// The caller's workspaces list, in creation order.
	list := doJSON(t, http.MethodGet, ts.URL, "/api/workspaces", alice, nil)
	if list.StatusCode != http.StatusOK {
		t.Fatalf("GET workspaces: status = %d, want %d", list.StatusCode, http.StatusOK)
	}
	var ws []workspaceBody
	decodeJSON(t, list, &ws)
	if len(ws) != 2 || ws[0].ID != zhWS.ID || ws[1].ID != esWS.ID {
		t.Errorf("GET workspaces = %+v, want zh then es", ws)
	}

	// Settings updates merge into the stored object.
	put := doJSON(t, http.MethodPut, ts.URL, "/api/workspaces/"+strconv.FormatInt(zhWS.ID, 10), alice,
		map[string]string{"theme": "dark"})
	if put.StatusCode != http.StatusOK {
		t.Fatalf("PUT settings: status = %d, want %d", put.StatusCode, http.StatusOK)
	}
	var updated workspaceBody
	decodeJSON(t, put, &updated)
	if got := parseSettings(t, updated.Settings); got["theme"] != "dark" {
		t.Errorf("settings after first PUT = %v, want theme dark", got)
	}

	// A second PUT merges: existing keys update, new keys are added.
	put = doJSON(t, http.MethodPut, ts.URL, "/api/workspaces/"+strconv.FormatInt(zhWS.ID, 10), alice,
		map[string]string{"theme": "light", "font": "serif"})
	if put.StatusCode != http.StatusOK {
		t.Fatalf("PUT settings again: status = %d, want %d", put.StatusCode, http.StatusOK)
	}
	decodeJSON(t, put, &updated)
	got := parseSettings(t, updated.Settings)
	if got["theme"] != "light" || got["font"] != "serif" {
		t.Errorf("settings after merge = %v, want theme light and font serif", got)
	}
	if updated.ID != zhWS.ID || updated.Language != "zh" {
		t.Errorf("updated workspace = %+v, want the same zh workspace", updated)
	}

	// Settings must be a JSON object; unknown and malformed ids are 404.
	if resp := doJSON(t, http.MethodPut, ts.URL, "/api/workspaces/"+strconv.FormatInt(zhWS.ID, 10), alice, []string{"no"}); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("PUT array settings: status = %d, want %d", resp.StatusCode, http.StatusBadRequest)
	}
	if resp := doJSON(t, http.MethodPut, ts.URL, "/api/workspaces/999999", alice, map[string]string{"a": "b"}); resp.StatusCode != http.StatusNotFound {
		t.Errorf("PUT unknown workspace: status = %d, want %d", resp.StatusCode, http.StatusNotFound)
	}
	if resp := doJSON(t, http.MethodPut, ts.URL, "/api/workspaces/NaN", alice, map[string]string{"a": "b"}); resp.StatusCode != http.StatusNotFound {
		t.Errorf("PUT malformed id: status = %d, want %d", resp.StatusCode, http.StatusNotFound)
	}

	// Other users' workspaces are invisible.
	bob := registerUser(t, ts.URL, "bob", alice)
	if resp := doJSON(t, http.MethodPut, ts.URL, "/api/workspaces/"+strconv.FormatInt(zhWS.ID, 10), bob, map[string]string{"a": "b"}); resp.StatusCode != http.StatusNotFound {
		t.Errorf("PUT another user's workspace: status = %d, want %d", resp.StatusCode, http.StatusNotFound)
	}
	bobList := doJSON(t, http.MethodGet, ts.URL, "/api/workspaces", bob, nil)
	if bobList.StatusCode != http.StatusOK {
		t.Fatalf("GET bob's workspaces: status = %d, want %d", bobList.StatusCode, http.StatusOK)
	}
	var bobWS []workspaceBody
	decodeJSON(t, bobList, &bobWS)
	if len(bobWS) != 0 {
		t.Errorf("bob's workspaces = %+v, want empty", bobWS)
	}

	// Another user may open their own workspace for the same language; a
	// repeated code does not double-register the language row.
	if resp := doJSON(t, http.MethodPost, ts.URL, "/api/workspaces", bob, map[string]string{"language": "ES"}); resp.StatusCode != http.StatusCreated {
		t.Errorf("POST bob's ES workspace: status = %d, want %d", resp.StatusCode, http.StatusCreated)
	}
	var count int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM languages WHERE code = 'es'`).Scan(&count); err != nil {
		t.Fatalf("count es language rows: %v", err)
	}
	if count != 1 {
		t.Errorf("es language rows = %d, want 1", count)
	}

	// All workspace routes require authentication.
	for _, tc := range []struct {
		method, path string
	}{
		{http.MethodGet, "/api/workspaces"},
		{http.MethodPost, "/api/workspaces"},
		{http.MethodPut, "/api/workspaces/1"},
	} {
		if resp := doJSON(t, tc.method, ts.URL, tc.path, "", nil); resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("%s %s without token: status = %d, want %d", tc.method, tc.path, resp.StatusCode, http.StatusUnauthorized)
		}
	}
}

// parseSettings decodes a workspace settings blob into a string map.
func parseSettings(t *testing.T, raw json.RawMessage) map[string]string {
	t.Helper()
	var m map[string]string
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("parse settings %s: %v", raw, err)
	}
	return m
}
