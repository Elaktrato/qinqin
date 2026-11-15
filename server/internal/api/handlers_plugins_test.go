package api_test

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"testing"
)

// pluginInfoBody mirrors one element of GET /api/plugins.
type pluginInfoBody struct {
	ID       string          `json:"id"`
	Manifest json.RawMessage `json:"manifest"`
	Enabled  bool            `json:"enabled"`
	Order    int             `json:"order"`
}

// pluginStateBody mirrors the response of PUT /api/plugins/{id}/state.
type pluginStateBody struct {
	PluginID string `json:"pluginId"`
	UserID   int64  `json:"userId"`
	Enabled  bool   `json:"enabled"`
	Order    int    `json:"order"`
}

// pluginDataBody mirrors the response of the plugin data routes.
type pluginDataBody struct {
	PluginID    string          `json:"pluginId"`
	Key         string          `json:"key"`
	UserID      int64           `json:"userId"`
	WorkspaceID *int64          `json:"workspaceId"`
	Data        json.RawMessage `json:"data"`
	Version     int             `json:"version"`
}

// doRaw performs a request with a raw string body and the given bearer
// token ("" for none), returning the undecoded response. doJSON cannot
// carry an invalid or verbatim body; plugin manifests and data values
// are both raw JSON.
func doRaw(t *testing.T, method, tsURL, path, token, body string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(method, tsURL+path, strings.NewReader(body))
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

// registerPlugin registers a feature-plugin manifest through the admin
// route and returns the undecoded response.
func registerPlugin(t *testing.T, tsURL, adminToken, manifest string) *http.Response {
	t.Helper()
	return doRaw(t, http.MethodPost, tsURL, "/api/admin/plugins", adminToken, manifest)
}

// listPlugins fetches GET /api/plugins with the caller's token.
func listPlugins(t *testing.T, tsURL, token string) []pluginInfoBody {
	t.Helper()
	resp := doJSON(t, http.MethodGet, tsURL, "/api/plugins", token, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /api/plugins: status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	var list []pluginInfoBody
	decodeJSON(t, resp, &list)
	return list
}

func TestPluginRegistrationRoute(t *testing.T) {
	ts, _ := newServer(t)
	admin := registerUser(t, ts.URL, "root", "")
	alice := registerUser(t, ts.URL, "alice", admin)

	// Registering a feature plugin is admin-gated: unauthenticated and
	// non-admin callers alike are refused.
	manifest := `{"id":"qinqin-heatmap","name":"Study heatmap","version":"1.0","type":"feature"}`
	if resp := registerPlugin(t, ts.URL, "", manifest); resp.StatusCode != http.StatusForbidden {
		t.Errorf("register without token: status = %d, want %d", resp.StatusCode, http.StatusForbidden)
	}
	if resp := registerPlugin(t, ts.URL, alice, manifest); resp.StatusCode != http.StatusForbidden {
		t.Errorf("register as non-admin: status = %d, want %d", resp.StatusCode, http.StatusForbidden)
	}

	// A manifest without an id is rejected.
	for name, bad := range map[string]string{
		"not json":   `{`,
		"not object": `["qinqin-heatmap"]`,
		"no id":      `{"name":"Study heatmap"}`,
	} {
		if resp := registerPlugin(t, ts.URL, admin, bad); resp.StatusCode != http.StatusBadRequest {
			t.Errorf("register %s: status = %d, want %d", name, resp.StatusCode, http.StatusBadRequest)
		}
	}

	// The admin registers the heatmap manifest; it lists enabled by default.
	resp := registerPlugin(t, ts.URL, admin, manifest)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("register heatmap: status = %d, want %d", resp.StatusCode, http.StatusCreated)
	}
	var stored map[string]any
	decodeJSON(t, resp, &stored)
	if stored["id"] != "qinqin-heatmap" || stored["name"] != "Study heatmap" {
		t.Errorf("register response = %v, want the manifest back", stored)
	}

	list := listPlugins(t, ts.URL, alice)
	if len(list) != 1 {
		t.Fatalf("plugins for alice = %+v, want the one feature plugin", list)
	}
	p := list[0]
	if p.ID != "qinqin-heatmap" || !p.Enabled || p.Order != 0 {
		t.Errorf("plugin = %+v, want heatmap enabled at order 0", p)
	}
	var m map[string]any
	if err := json.Unmarshal(p.Manifest, &m); err != nil {
		t.Fatalf("parse served manifest %s: %v", p.Manifest, err)
	}
	if m["name"] != "Study heatmap" {
		t.Errorf("served manifest = %s, want the registered manifest", p.Manifest)
	}
}

func TestPluginStateRoute(t *testing.T) {
	ts, _ := newServer(t)
	admin := registerUser(t, ts.URL, "root", "")
	alice := registerUser(t, ts.URL, "alice", admin)
	registerPlugin(t, ts.URL, admin, `{"id":"qinqin-heatmap","name":"Study heatmap","version":"1.0","type":"feature"}`)

	// The plugin routes require a user.
	if resp := doJSON(t, http.MethodGet, ts.URL, "/api/plugins", "", nil); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("GET /api/plugins without token: status = %d, want %d", resp.StatusCode, http.StatusUnauthorized)
	}
	if resp := doJSON(t, http.MethodPut, ts.URL, "/api/plugins/qinqin-heatmap/state", "", map[string]any{"enabled": false, "order": 2}); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("PUT state without token: status = %d, want %d", resp.StatusCode, http.StatusUnauthorized)
	}

	// Alice disables the plugin and reorders it on her home.
	resp := doJSON(t, http.MethodPut, ts.URL, "/api/plugins/qinqin-heatmap/state", alice, map[string]any{"enabled": false, "order": 2})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("PUT state: status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	var st pluginStateBody
	decodeJSON(t, resp, &st)
	if st.PluginID != "qinqin-heatmap" || st.UserID == 0 || st.Enabled || st.Order != 2 {
		t.Errorf("state response = %+v, want heatmap disabled at order 2", st)
	}

	// Her list reflects it; the admin's does not — state is per-user.
	list := listPlugins(t, ts.URL, alice)
	if len(list) != 1 || list[0].Enabled || list[0].Order != 2 {
		t.Errorf("alice's plugins = %+v, want heatmap disabled at 2", list)
	}
	list = listPlugins(t, ts.URL, admin)
	if len(list) != 1 || !list[0].Enabled || list[0].Order != 0 {
		t.Errorf("admin's plugins = %+v, want heatmap still enabled at 0", list)
	}

	// State for an unknown plugin is 404, and both fields are required.
	if resp := doJSON(t, http.MethodPut, ts.URL, "/api/plugins/ghost/state", alice, map[string]any{"enabled": true, "order": 0}); resp.StatusCode != http.StatusNotFound {
		t.Errorf("PUT state for unknown plugin: status = %d, want %d", resp.StatusCode, http.StatusNotFound)
	}
	if resp := doJSON(t, http.MethodPut, ts.URL, "/api/plugins/qinqin-heatmap/state", alice, map[string]any{"enabled": true}); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("PUT state without order: status = %d, want %d", resp.StatusCode, http.StatusBadRequest)
	}
}

func TestPluginDataRoute(t *testing.T) {
	ts, _ := newServer(t)
	admin := registerUser(t, ts.URL, "root", "")
	alice := registerUser(t, ts.URL, "alice", admin)
	bob := registerUser(t, ts.URL, "bob", admin)
	registerPlugin(t, ts.URL, admin, `{"id":"qinqin-flashcards","name":"Flashcards","version":"1.0","type":"feature"}`)

	// Alice opens a zh workspace to scope a deck to.
	resp := doJSON(t, http.MethodPost, ts.URL, "/api/workspaces", alice, map[string]string{"language": "zh"})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("POST workspace: status = %d, want %d", resp.StatusCode, http.StatusCreated)
	}
	var ws workspaceBody
	decodeJSON(t, resp, &ws)
	scoped := "/api/plugins/qinqin-flashcards/data/decks?workspace=" + strconv.FormatInt(ws.ID, 10)
	global := "/api/plugins/qinqin-flashcards/data/decks"

	// Storing data in her workspace versions the row.
	resp = doRaw(t, http.MethodPut, ts.URL, scoped, alice, `{"cards":["你好"]}`)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("PUT workspace data: status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	var d pluginDataBody
	decodeJSON(t, resp, &d)
	if d.PluginID != "qinqin-flashcards" || d.Key != "decks" || d.UserID == 0 ||
		d.WorkspaceID == nil || *d.WorkspaceID != ws.ID ||
		d.Version != 1 || string(d.Data) != `{"cards":["你好"]}` {
		t.Errorf("stored workspace data = %+v, want version 1 in alice's workspace", d)
	}
	resp = doRaw(t, http.MethodPut, ts.URL, scoped, alice, `{"cards":["你好","谢谢"]}`)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("re-PUT workspace data: status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	decodeJSON(t, resp, &d)
	if d.Version != 2 {
		t.Errorf("re-PUT version = %d, want 2", d.Version)
	}

	// GET reads the row back.
	resp = doJSON(t, http.MethodGet, ts.URL, scoped, alice, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET workspace data: status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	decodeJSON(t, resp, &d)
	if d.Version != 2 || string(d.Data) != `{"cards":["你好","谢谢"]}` {
		t.Errorf("read workspace data = %+v, want version 2 with the re-put value", d)
	}

	// Without ?workspace the row is user-global — a different row.
	if resp := doJSON(t, http.MethodGet, ts.URL, global, alice, nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("GET user-global before storing: status = %d, want %d", resp.StatusCode, http.StatusNotFound)
	}
	resp = doRaw(t, http.MethodPut, ts.URL, global, alice, `{"goal":20}`)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("PUT user-global data: status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	decodeJSON(t, resp, &d)
	if d.WorkspaceID != nil || d.Version != 1 {
		t.Errorf("stored user-global data = %+v, want version 1 with no workspace", d)
	}
	resp = doJSON(t, http.MethodGet, ts.URL, scoped, alice, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET workspace data after user-global put: status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	decodeJSON(t, resp, &d)
	if d.Version != 2 {
		t.Errorf("workspace data after user-global put = version %d, want still 2 — separate rows", d.Version)
	}

	// Bob sees none of alice's rows.
	if resp := doJSON(t, http.MethodGet, ts.URL, global, bob, nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("bob reads alice's user-global row: status = %d, want %d", resp.StatusCode, http.StatusNotFound)
	}

	// DELETE tombstones the workspace row; the user-global row stays.
	if resp := doJSON(t, http.MethodDelete, ts.URL, scoped, alice, nil); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("DELETE workspace data: status = %d, want %d", resp.StatusCode, http.StatusNoContent)
	}
	if resp := doJSON(t, http.MethodGet, ts.URL, scoped, alice, nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("GET deleted workspace data: status = %d, want %d", resp.StatusCode, http.StatusNotFound)
	}
	if resp := doJSON(t, http.MethodDelete, ts.URL, scoped, alice, nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("re-DELETE workspace data: status = %d, want %d", resp.StatusCode, http.StatusNotFound)
	}
	if resp := doJSON(t, http.MethodGet, ts.URL, global, alice, nil); resp.StatusCode != http.StatusOK {
		t.Errorf("GET user-global after workspace delete: status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	// Foreign and unknown workspaces are 404.
	bobWS := doJSON(t, http.MethodPost, ts.URL, "/api/workspaces", bob, map[string]string{"language": "zh"})
	if bobWS.StatusCode != http.StatusCreated {
		t.Fatalf("POST bob's workspace: status = %d, want %d", bobWS.StatusCode, http.StatusCreated)
	}
	var bobWorkspace workspaceBody
	decodeJSON(t, bobWS, &bobWorkspace)
	foreign := "/api/plugins/qinqin-flashcards/data/decks?workspace=" + strconv.FormatInt(bobWorkspace.ID, 10)
	if resp := doRaw(t, http.MethodPut, ts.URL, foreign, alice, `{"cards":[]}`); resp.StatusCode != http.StatusNotFound {
		t.Errorf("PUT data in bob's workspace: status = %d, want %d", resp.StatusCode, http.StatusNotFound)
	}
	if resp := doRaw(t, http.MethodPut, ts.URL, "/api/plugins/qinqin-flashcards/data/decks?workspace=999999", alice, `{"cards":[]}`); resp.StatusCode != http.StatusNotFound {
		t.Errorf("PUT data in unknown workspace: status = %d, want %d", resp.StatusCode, http.StatusNotFound)
	}
	if resp := doRaw(t, http.MethodPut, ts.URL, "/api/plugins/qinqin-flashcards/data/decks?workspace=not-a-number", alice, `{"cards":[]}`); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("PUT data with malformed workspace: status = %d, want %d", resp.StatusCode, http.StatusBadRequest)
	}

	// Data writes key to registered plugins only, and the body must be
	// valid JSON.
	if resp := doRaw(t, http.MethodPut, ts.URL, "/api/plugins/ghost/data/decks", alice, `{"cards":[]}`); resp.StatusCode != http.StatusNotFound {
		t.Errorf("PUT data for unknown plugin: status = %d, want %d", resp.StatusCode, http.StatusNotFound)
	}
	if resp := doRaw(t, http.MethodPut, ts.URL, global, alice, `{`); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("PUT invalid JSON data: status = %d, want %d", resp.StatusCode, http.StatusBadRequest)
	}
	if resp := doJSON(t, http.MethodGet, ts.URL, global, "", nil); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("GET data without token: status = %d, want %d", resp.StatusCode, http.StatusUnauthorized)
	}
}

func TestListPluginDataRoute(t *testing.T) {
	ts, _ := newServer(t)
	admin := registerUser(t, ts.URL, "root", "")
	alice := registerUser(t, ts.URL, "alice", admin)
	bob := registerUser(t, ts.URL, "bob", admin)
	registerPlugin(t, ts.URL, admin, `{"id":"qinqin-journal","name":"Journal","version":"1.0","type":"feature"}`)

	var ws workspaceBody
	resp := doJSON(t, http.MethodPost, ts.URL, "/api/workspaces", alice, map[string]string{"language": "zh"})
	decodeJSON(t, resp, &ws)
	w := "?workspace=" + strconv.FormatInt(ws.ID, 10)
	for _, k := range []string{"entry:2", "entry:1", "review:1"} {
		if r := doRaw(t, http.MethodPut, ts.URL, "/api/plugins/qinqin-journal/data/"+k+w, alice, `{"k":"`+k+`"}`); r.StatusCode != http.StatusOK {
			t.Fatalf("PUT %s: %d", k, r.StatusCode)
		}
	}

	resp = doJSON(t, http.MethodGet, ts.URL, "/api/plugins/qinqin-journal/data"+w+"&prefix=entry:", alice, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("list: status = %d", resp.StatusCode)
	}
	var rows []pluginDataBody
	decodeJSON(t, resp, &rows)
	if len(rows) != 2 || rows[0].Key != "entry:1" || rows[1].Key != "entry:2" || string(rows[0].Data) != `{"k":"entry:1"}` {
		t.Fatalf("rows = %+v", rows)
	}

	// An empty result is [] not null.
	resp = doJSON(t, http.MethodGet, ts.URL, "/api/plugins/qinqin-journal/data"+w+"&prefix=none:", alice, nil)
	if body := readAll(t, resp); strings.TrimSpace(body) != "[]" {
		t.Errorf("empty list body = %q, want []", body)
	}

	// A foreign workspace is 404, as is an unknown plugin; no token is 401.
	if r := doJSON(t, http.MethodGet, ts.URL, "/api/plugins/qinqin-journal/data"+w, bob, nil); r.StatusCode != http.StatusNotFound {
		t.Errorf("foreign workspace: status = %d, want 404", r.StatusCode)
	}
	if r := doJSON(t, http.MethodGet, ts.URL, "/api/plugins/ghost/data"+w, alice, nil); r.StatusCode != http.StatusNotFound {
		t.Errorf("unknown plugin: status = %d, want 404", r.StatusCode)
	}
	if r := doJSON(t, http.MethodGet, ts.URL, "/api/plugins/qinqin-journal/data"+w, "", nil); r.StatusCode != http.StatusUnauthorized {
		t.Errorf("no token: status = %d, want 401", r.StatusCode)
	}
}

func readAll(t *testing.T, resp *http.Response) string {
	t.Helper()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}
