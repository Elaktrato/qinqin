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
	h := rootHandler(web, api.New(nil, t.TempDir()))
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
// the shipped heatmap into the server registry: Settings lists it, and
// with no state row it is enabled at order 0. Running twice must be a
// no-op upsert, as it happens on every start.
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
	for _, plugin := range list {
		if plugin.ID != "qinqin-heatmap" {
			continue
		}
		if !plugin.Enabled || plugin.Order != 0 {
			t.Errorf("heatmap state = enabled %t, order %d, want enabled, 0", plugin.Enabled, plugin.Order)
		}
		return
	}
	t.Fatalf("qinqin-heatmap not in plugin list %+v", list)
}
