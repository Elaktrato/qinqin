package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"qinqin/internal/api"
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
