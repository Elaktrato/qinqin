package api_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"qinqin/internal/plugins"
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

// rowBody mirrors the response of the keyed row routes.
type rowBody struct {
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

// seedBuiltin stores a manifest under a built-in plugin id the way server
// start-up does (Register refuses those ids on the admin route).
func seedBuiltin(t *testing.T, sqlDB *sql.DB, manifest string) {
	t.Helper()
	if _, err := plugins.RegisterBuiltin(context.Background(), sqlDB, []byte(manifest)); err != nil {
		t.Fatalf("seed built-in: %v", err)
	}
}

// validManifest is a feature manifest that passes plugins.ParseManifest:
// sdk 1, owns-data, no surfaces or events. extra is a list of JSON members
// appended last, so a repeated key overrides the default.
func validManifest(id, extra string) string {
	if extra != "" {
		extra = "," + extra
	}
	return `{"id":"` + id + `","name":"X","version":"1.0","type":"feature","sdk":1,"surfaces":[],"permissions":["owns-data"],"hooks":[],"events":[]` + extra + `}`
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
	manifest := validManifest("qinqin-heatmap", `"name":"Study heatmap"`)
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

	// The contract is checked and the 400 body names the problem.
	resp := registerPlugin(t, ts.URL, admin, `{"id":"x","name":"X","version":"1","type":"feature","sdk":1,"surfaces":[],"permissions":[]}`)
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("register bad version: status = %d, want %d", resp.StatusCode, http.StatusBadRequest)
	}
	if body, _ := io.ReadAll(resp.Body); errorCode(t, body) != "bad_request" || !strings.Contains(string(body), `version \"1\" must look like`) {
		t.Errorf("400 body = %q, want the version problem", body)
	}
	resp.Body.Close()

	// The admin registers the heatmap manifest; it lists enabled by default.
	resp = registerPlugin(t, ts.URL, admin, manifest)
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
	registerPlugin(t, ts.URL, admin, validManifest("qinqin-heatmap", `"name":"Study heatmap"`))

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

func readAll(t *testing.T, resp *http.Response) string {
	t.Helper()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestPluginRegistrationRefusesBuiltinID(t *testing.T) {
	ts, _ := newServer(t)
	admin := registerUser(t, ts.URL, "root", "")
	resp := registerPlugin(t, ts.URL, admin, validManifest("qinqin-journal", ""))
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusConflict)
	}
	body, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(body), "qinqin-journal") {
		t.Errorf("body %q does not name the id", body)
	}
}

func TestPluginRegistrationRefusesTrailingData(t *testing.T) {
	ts, _ := newServer(t)
	admin := registerUser(t, ts.URL, "root", "")
	resp := registerPlugin(t, ts.URL, admin, validManifest("trail-x", "")+" garbage")
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusBadRequest)
	}
	if got := listPlugins(t, ts.URL, admin); len(got) != 0 {
		for _, p := range got {
			if p.ID == "trail-x" {
				t.Errorf("trailing-data manifest was stored")
			}
		}
	}
}

// canonJSON re-encodes a JSON value so escaping and spacing do not matter.
func canonJSON(t *testing.T, raw []byte) string {
	t.Helper()
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatalf("bad JSON %s: %v", raw, err)
	}
	b, _ := json.Marshal(v)
	return string(b)
}

// The core features keep their reserved registry rows (spec Q6): GET
// /api/plugins lists qinqin-flashcards and qinqin-reader with the caller's
// state (hidden: not plugins), PUT .../state switches them per user, and
// the admin route cannot take their ids.
func TestReservedFeatureRows(t *testing.T) {
	ts, sqlDB := newServer(t)
	admin := registerUser(t, ts.URL, "root", "")
	bob := registerUser(t, ts.URL, "bob", admin)
	for _, raw := range plugins.Builtin() {
		seedBuiltin(t, sqlDB, string(raw))
	}
	for _, id := range []string{"qinqin-reader", "qinqin-flashcards"} {
		resp := registerPlugin(t, ts.URL, admin, validManifest(id, ""))
		if resp.StatusCode != http.StatusConflict {
			t.Errorf("register %s: status = %d, want 409", id, resp.StatusCode)
		}
	}
	resp := doJSON(t, http.MethodPut, ts.URL, "/api/plugins/qinqin-reader/state", admin, map[string]any{"enabled": false, "order": 0})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("PUT reader state: %d", resp.StatusCode)
	}
	state := func(token string) map[string]pluginInfoBody {
		out := map[string]pluginInfoBody{}
		for _, p := range listPlugins(t, ts.URL, token) {
			out[p.ID] = p
		}
		return out
	}
	mine, his := state(admin), state(bob)
	for _, id := range []string{"qinqin-flashcards", "qinqin-reader"} {
		if _, ok := mine[id]; !ok {
			t.Errorf("%s not listed", id)
		}
	}
	if mine["qinqin-reader"].Enabled || !mine["qinqin-flashcards"].Enabled || !his["qinqin-reader"].Enabled {
		t.Errorf("states: admin reader %v flashcards %v, bob reader %v", mine["qinqin-reader"].Enabled, mine["qinqin-flashcards"].Enabled, his["qinqin-reader"].Enabled)
	}
	raw := doJSON(t, http.MethodGet, ts.URL, "/api/plugins", admin, nil)
	var list []json.RawMessage
	decodeJSON(t, raw, &list)
	for _, item := range list {
		var p struct {
			ID     string `json:"id"`
			Hidden bool   `json:"hidden"`
		}
		json.Unmarshal(item, &p)
		// Listed unhidden (introduced for v0.3.x shells, kept as the documented
		// answer until #199 retires code plugins; clients know the reserved ids).
		if p.ID == "qinqin-reader" || p.ID == "qinqin-flashcards" {
			if p.Hidden {
				t.Errorf("%s hidden = true, want false (the documented answer)", p.ID)
			}
		}
	}
}
