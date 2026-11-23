package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"qinqin/internal/api"
	"qinqin/internal/auth"
)

// TestCorePluginStoresUserGlobalHomeLayout proves the registered
// qinqin-core plugin accepts the per-user home layout as a user-global
// plugin data row (no ?workspace): PUT stores it with no workspace, GET
// reads it back, and a sync pull carries it with a null workspaceId so
// every client of the user sees the same layout.
func TestCorePluginStoresUserGlobalHomeLayout(t *testing.T) {
	sqlDB, err := openData(t.TempDir())
	if err != nil {
		t.Fatalf("openData: %v", err)
	}
	defer sqlDB.Close()

	ctx := context.Background()
	if err := registerBuiltinPlugins(ctx, sqlDB); err != nil {
		t.Fatalf("registerBuiltinPlugins: %v", err)
	}
	if _, err := auth.CreateUser(ctx, sqlDB, "alice", "pw-alice", false); err != nil {
		t.Fatalf("create user: %v", err)
	}
	token, err := auth.Login(ctx, sqlDB, "alice", "pw-alice")
	if err != nil {
		t.Fatalf("login: %v", err)
	}

	srv := httptest.NewServer(api.New(sqlDB, t.TempDir(), nil))
	defer srv.Close()

	do := func(method, path, body string) *http.Response {
		t.Helper()
		req, err := http.NewRequest(method, srv.URL+path, strings.NewReader(body))
		if err != nil {
			t.Fatalf("build %s %s: %v", method, path, err)
		}
		req.Header.Set("Authorization", "Bearer "+token)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("%s %s: %v", method, path, err)
		}
		t.Cleanup(func() { resp.Body.Close() })
		return resp
	}

	type row struct {
		PluginID    string          `json:"pluginId"`
		Key         string          `json:"key"`
		WorkspaceID *int64          `json:"workspaceId"`
		Data        json.RawMessage `json:"data"`
	}
	const path = "/api/plugins/qinqin-core/data/home-layout"
	const layout = `{"version":1,"widgets":["flashcards-summary","activity-heatmap"]}`

	if resp := do(http.MethodGet, path, ""); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("GET before any write: status = %d, want %d (missing row = default layout)", resp.StatusCode, http.StatusNotFound)
	}

	resp := do(http.MethodPut, path, layout)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("PUT home-layout: status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	var put row
	if err := json.NewDecoder(resp.Body).Decode(&put); err != nil {
		t.Fatalf("decode PUT: %v", err)
	}
	if put.PluginID != "qinqin-core" || put.Key != "home-layout" || put.WorkspaceID != nil {
		t.Errorf("stored row = %+v, want qinqin-core/home-layout with no workspace", put)
	}

	resp = do(http.MethodGet, path, "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET home-layout: status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	var got row
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode GET: %v", err)
	}
	if got.WorkspaceID != nil || !jsonEqual(t, got.Data, layout) {
		t.Errorf("read row = %+v, want the stored layout with no workspace", got)
	}

	// a paged pull ships rows stamped before its own second
	if _, err := sqlDB.Exec(`UPDATE plugin_data SET updated_at = '2026-01-01T00:00:00Z'`); err != nil {
		t.Fatal(err)
	}
	resp = do(http.MethodGet, "/api/sync/pull?v=2&collections=pluginData", "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("sync pull: status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	var page struct {
		Collections struct {
			PluginData []row `json:"pluginData"`
		} `json:"collections"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&page); err != nil {
		t.Fatalf("decode sync pull: %v", err)
	}
	delta := page.Collections
	var synced *row
	for i := range delta.PluginData {
		if delta.PluginData[i].PluginID == "qinqin-core" && delta.PluginData[i].Key == "home-layout" {
			synced = &delta.PluginData[i]
		}
	}
	if synced == nil {
		t.Fatalf("sync pull pluginData = %+v, want the qinqin-core home-layout row", delta.PluginData)
	}
	if synced.WorkspaceID != nil || !jsonEqual(t, synced.Data, layout) {
		t.Errorf("synced row = %+v, want the layout with a null workspace", *synced)
	}
}

// jsonEqual compares two JSON documents by value, not formatting.
func jsonEqual(t *testing.T, got json.RawMessage, want string) bool {
	t.Helper()
	var a, b any
	if err := json.Unmarshal(got, &a); err != nil {
		t.Fatalf("decode %s: %v", got, err)
	}
	if err := json.Unmarshal([]byte(want), &b); err != nil {
		t.Fatalf("decode %s: %v", want, err)
	}
	ja, _ := json.Marshal(a)
	jb, _ := json.Marshal(b)
	return string(ja) == string(jb)
}
