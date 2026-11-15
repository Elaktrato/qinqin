package main

import (
	"bytes"
	"context"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"testing/fstest"

	"qinqin/internal/api"
	"qinqin/internal/auth"
	"qinqin/internal/plugins"
)

// TestRootMuxKeepsAPI proves that mounting the SPA at / does not swallow
// the API and health routes.
func TestRootMuxKeepsAPI(t *testing.T) {
	web := fstest.MapFS{
		"index.html": &fstest.MapFile{
			Data: []byte("<!doctype html><title>qinqin spa</title>"),
		},
	}
	// The API handler is real; an empty POST body fails decoding before it
	// ever touches the (nil) database.
	h := rootHandler(web, api.New(nil, t.TempDir(), nil))
	srv := httptest.NewServer(h)
	defer srv.Close()

	t.Run("login reaches the API", func(t *testing.T) {
		resp, err := http.Post(srv.URL+"/api/auth/login", "application/json", strings.NewReader(""))
		if err != nil {
			t.Fatalf("POST /api/auth/login: %v", err)
		}
		defer resp.Body.Close()
		body, err := io.ReadAll(resp.Body)
		if err != nil {
			t.Fatalf("read body: %v", err)
		}
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("status = %d, want %d (the API's malformed-body answer)", resp.StatusCode, http.StatusBadRequest)
		}
		if strings.Contains(string(body), "web build not bundled") || strings.Contains(string(body), "<!doctype html>") {
			t.Errorf("body = %q, got the SPA instead of the API", body)
		}
	})

	t.Run("healthz reaches the API", func(t *testing.T) {
		resp, err := http.Get(srv.URL + "/healthz")
		if err != nil {
			t.Fatalf("GET /healthz: %v", err)
		}
		defer resp.Body.Close()
		body, err := io.ReadAll(resp.Body)
		if err != nil {
			t.Fatalf("read body: %v", err)
		}
		if resp.StatusCode != http.StatusOK || string(body) != "ok" {
			t.Errorf("GET /healthz = %d %q, want 200 %q", resp.StatusCode, body, "ok")
		}
	})

	t.Run("unknown path serves the SPA", func(t *testing.T) {
		resp, err := http.Get(srv.URL + "/entry/5")
		if err != nil {
			t.Fatalf("GET /entry/5: %v", err)
		}
		defer resp.Body.Close()
		body, err := io.ReadAll(resp.Body)
		if err != nil {
			t.Fatalf("read body: %v", err)
		}
		if resp.StatusCode != http.StatusOK {
			t.Errorf("status = %d, want %d", resp.StatusCode, http.StatusOK)
		}
		if !strings.Contains(string(body), "<!doctype html>") {
			t.Errorf("body = %q, want the SPA index", body)
		}
	})
}

// TestRegisterBuiltinPlugins proves the serve startup registration puts
// the shipped plugins (flashcards, reader and the core app's own
// qinqin-core) into the server registry: the list carries them, and
// with no state row they are enabled at order 0. Running twice must
// be a no-op upsert, as it happens on every start.
func TestRegisterBuiltinPlugins(t *testing.T) {
	sqlDB, err := openData(t.TempDir())
	if err != nil {
		t.Fatalf("openData: %v", err)
	}
	defer sqlDB.Close()

	ctx := context.Background()
	user, err := auth.CreateUser(ctx, sqlDB, "alice", "pw-alice", false)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}

	for i := 0; i < 2; i++ {
		if err := registerBuiltinPlugins(ctx, sqlDB); err != nil {
			t.Fatalf("registerBuiltinPlugins (run %d): %v", i+1, err)
		}
	}

	list, err := plugins.ListFor(ctx, sqlDB, user.ID)
	if err != nil {
		t.Fatalf("ListFor: %v", err)
	}
	found := map[string]bool{}
	for _, plugin := range list {
		if plugin.ID != "qinqin-flashcards" && plugin.ID != "qinqin-reader" && plugin.ID != "qinqin-core" && plugin.ID != "qinqin-grammar" {
			continue
		}
		found[plugin.ID] = true
		if !plugin.Enabled || plugin.Order != 0 {
			t.Errorf("%s state = enabled %t, order %d, want enabled, 0", plugin.ID, plugin.Enabled, plugin.Order)
		}
	}
	for _, id := range []string{"qinqin-flashcards", "qinqin-reader", "qinqin-core", "qinqin-grammar"} {
		if !found[id] {
			t.Errorf("%s not in plugin list %+v", id, list)
		}
	}
}

// TestRegisterBuiltinPluginsRetiresHeatmap simulates a database upgraded
// from a build that shipped the heatmap: its registry row and per-user
// state survive, and the serve startup must remove both while keeping
// the flashcards plugin. Running startup again must stay a no-op.
func TestRegisterBuiltinPluginsRetiresHeatmap(t *testing.T) {
	sqlDB, err := openData(t.TempDir())
	if err != nil {
		t.Fatalf("openData: %v", err)
	}
	defer sqlDB.Close()

	ctx := context.Background()
	user, err := auth.CreateUser(ctx, sqlDB, "alice", "pw-alice", false)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	if err := plugins.Register(ctx, sqlDB, []byte(legacyHeatmapManifest)); err != nil {
		t.Fatalf("register old heatmap: %v", err)
	}
	if err := plugins.SetState(ctx, sqlDB, user.ID, "qinqin-heatmap", false, 4); err != nil {
		t.Fatalf("set heatmap state: %v", err)
	}

	for i := 0; i < 2; i++ {
		if err := registerBuiltinPlugins(ctx, sqlDB); err != nil {
			t.Fatalf("registerBuiltinPlugins (run %d): %v", i+1, err)
		}
	}

	list, err := plugins.ListFor(ctx, sqlDB, user.ID)
	if err != nil {
		t.Fatalf("ListFor: %v", err)
	}
	var hasFlashcards bool
	for _, plugin := range list {
		switch plugin.ID {
		case "qinqin-heatmap":
			t.Errorf("retired plugin qinqin-heatmap is still listed: %+v", plugin)
		case "qinqin-flashcards":
			hasFlashcards = true
		}
	}
	if !hasFlashcards {
		t.Errorf("qinqin-flashcards not in plugin list %+v", list)
	}

	var states int
	if err := sqlDB.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM plugin_states WHERE pack_id = 'qinqin-heatmap'`).Scan(&states); err != nil {
		t.Fatalf("count heatmap states: %v", err)
	}
	if states != 0 {
		t.Errorf("heatmap state rows = %d, want 0", states)
	}
}

// legacyHeatmapManifest is a sdk-1 manifest for the retired heatmap id.
const legacyHeatmapManifest = `{"id":"qinqin-heatmap","name":"Study heatmap","version":"1.0","type":"feature","sdk":1,"surfaces":[],"permissions":[],"hooks":[],"events":[]}`

// TestRegisterBuiltinOverLegacyDB is the upgrade path: a database
// holding the old 1.0 rows of all four built-ins (no sdk) and a legacy
// heatmap row starts, carries sdk 1 afterwards, and drops the heatmap.
func TestRegisterBuiltinOverLegacyDB(t *testing.T) {
	sqlDB, err := openData(t.TempDir())
	if err != nil {
		t.Fatalf("openData: %v", err)
	}
	defer sqlDB.Close()
	ctx := context.Background()
	legacy := map[string]string{
		"qinqin-flashcards": `{"id":"qinqin-flashcards","name":"Flashcards","version":"1.0","type":"feature","surfaces":["home-widget"]}`,
		"qinqin-reader":     `{"id":"qinqin-reader","name":"Reader","version":"1.0","type":"feature","surfaces":["page"]}`,
		"qinqin-journal":    `{"id":"qinqin-journal","name":"Journal","version":"1.0","type":"feature","surfaces":["page"]}`,
		"qinqin-core":       `{"id":"qinqin-core","name":"Core","version":"1.0","type":"feature","surfaces":[]}`,
		"qinqin-heatmap":    `{"id":"qinqin-heatmap","name":"Study heatmap","version":"1.0","type":"feature"}`,
	}
	for id, raw := range legacy {
		if _, err := sqlDB.ExecContext(ctx, `INSERT INTO plugin_registry (pack_id, manifest_json, updated_at) VALUES (?, ?, '2026-01-01T00:00:00Z')`, id, raw); err != nil {
			t.Fatalf("seed %s: %v", id, err)
		}
	}
	if err := registerBuiltinPlugins(ctx, sqlDB); err != nil {
		t.Fatalf("registerBuiltinPlugins: %v", err)
	}
	for _, id := range plugins.BuiltinIDs() {
		var raw string
		if err := sqlDB.QueryRowContext(ctx, `SELECT manifest_json FROM plugin_registry WHERE pack_id = ?`, id).Scan(&raw); err != nil {
			t.Fatalf("%s row: %v", id, err)
		}
		m, err := plugins.ParseManifest([]byte(raw))
		if err != nil || m.SDK != 1 || m.Version != "1.1" {
			t.Errorf("%s = %s (err %v), want sdk 1, version 1.1", id, raw, err)
		}
	}
	var n int
	if err := sqlDB.QueryRowContext(ctx, `SELECT COUNT(*) FROM plugin_registry WHERE pack_id = 'qinqin-heatmap'`).Scan(&n); err != nil || n != 0 {
		t.Errorf("heatmap rows = %d (err %v), want 0", n, err)
	}
}

// TestRegisterBuiltinPluginsLogsConflict: an admin plugin claiming a
// built-in's event type never stops the start; the log names it.
func TestRegisterBuiltinPluginsLogsConflict(t *testing.T) {
	sqlDB, err := openData(t.TempDir())
	if err != nil {
		t.Fatalf("openData: %v", err)
	}
	defer sqlDB.Close()
	other := `{"id":"qinqin-other","name":"Other","version":"1.0","type":"feature","sdk":1,"surfaces":[],"permissions":["write:study-events"],"hooks":[],"events":[{"type":"read"}]}`
	if err := plugins.Register(context.Background(), sqlDB, []byte(other)); err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	log.SetOutput(&buf)
	defer log.SetOutput(os.Stderr)
	if err := registerBuiltinPlugins(context.Background(), sqlDB); err != nil {
		t.Fatalf("registerBuiltinPlugins: %v", err)
	}
	if !strings.Contains(buf.String(), "plugin qinqin-other also claims event types of qinqin-reader; the built-in wins") {
		t.Errorf("log = %q", buf.String())
	}
}
