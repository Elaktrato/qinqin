package main

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
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
		if plugin.ID != "qinqin-flashcards" && plugin.ID != "qinqin-reader" && plugin.ID != "qinqin-core" {
			continue
		}
		found[plugin.ID] = true
		if !plugin.Enabled || plugin.Order != 0 {
			t.Errorf("%s state = enabled %t, order %d, want enabled, 0", plugin.ID, plugin.Enabled, plugin.Order)
		}
	}
	for _, id := range []string{"qinqin-flashcards", "qinqin-reader", "qinqin-core"} {
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
	if err := plugins.Register(ctx, sqlDB, []byte(`{"id":"qinqin-heatmap","name":"Study heatmap","version":"1.0","type":"feature"}`)); err != nil {
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
