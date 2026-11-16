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
	// A stub stands in for the API: it names the route it was given, so a
	// precedence regression fails with a readable message instead of a nil
	// database panic, and no API validation order can change the outcome.
	stub := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Stub-API", "1")
		io.WriteString(w, "stub-api "+r.Method+" "+r.URL.Path)
	})
	h := rootHandler(web, stub)
	srv := httptest.NewServer(h)
	defer srv.Close()

	reach := func(t *testing.T, method, path string) (*http.Response, string) {
		t.Helper()
		req, err := http.NewRequest(method, srv.URL+path, strings.NewReader(""))
		if err != nil {
			t.Fatal(err)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("%s %s: %v", method, path, err)
		}
		defer resp.Body.Close()
		body, err := io.ReadAll(resp.Body)
		if err != nil {
			t.Fatalf("read body: %v", err)
		}
		return resp, string(body)
	}

	t.Run("api routes reach the API", func(t *testing.T) {
		for _, c := range []struct{ method, path string }{
			{"POST", "/api/auth/login"}, {"GET", "/api/entries/5"}, {"GET", "/healthz"},
		} {
			resp, body := reach(t, c.method, c.path)
			if resp.Header.Get("X-Stub-API") != "1" || body != "stub-api "+c.method+" "+c.path {
				t.Errorf("%s %s = %d %q, want the API handler", c.method, c.path, resp.StatusCode, body)
			}
		}
	})

	t.Run("healthz with a trailing slash redirects to the API route", func(t *testing.T) {
		client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
		resp, err := client.Get(srv.URL + "/healthz/")
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusPermanentRedirect || resp.Header.Get("Location") != "/healthz" {
			t.Errorf("GET /healthz/ = %d Location %q, want 308 /healthz", resp.StatusCode, resp.Header.Get("Location"))
		}
		resp, body := reach(t, "GET", "/healthz/")
		if resp.Header.Get("X-Stub-API") != "1" || body != "stub-api GET /healthz" {
			t.Errorf("following the redirect = %d %q, want the API handler", resp.StatusCode, body)
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
		want := "1.1"
		if id == "qinqin-flashcards" {
			want = "1.2" // gained the decks page surface
		}
		m, err := plugins.ParseManifest([]byte(raw))
		if err != nil || m.SDK != 1 || m.Version != want {
			t.Errorf("%s = %s (err %v), want sdk 1, version %s", id, raw, err, want)
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

// A bad QINQIN_TRUSTED_PROXIES stops startup before anything is opened
// or listened on.
func TestServeRejectsBadTrustedProxies(t *testing.T) {
	t.Setenv("QINQIN_TRUSTED_PROXIES", "10.0.0.0/33")
	err := serveCmd([]string{"--addr", "127.0.0.1:0", "--data", t.TempDir()})
	if err == nil || !strings.Contains(err.Error(), "QINQIN_TRUSTED_PROXIES") || !strings.Contains(err.Error(), "10.0.0.0/33") {
		t.Fatalf("serveCmd error = %v, want one naming QINQIN_TRUSTED_PROXIES and the item", err)
	}
}

// Every response, API or static, tells browsers not to send a Referer and
// not to be framed.
func TestRootHandlerSetsBrowserHeaders(t *testing.T) {
	web := fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("<!doctype html>")}}
	stub := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, "api") })
	srv := httptest.NewServer(rootHandler(web, stub))
	defer srv.Close()
	for _, path := range []string{"/", "/register", "/api/auth/options", "/healthz", "/missing.js"} {
		resp, err := http.Get(srv.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if got := resp.Header.Get("Referrer-Policy"); got != "no-referrer" {
			t.Errorf("%s: Referrer-Policy = %q", path, got)
		}
		if got := resp.Header.Get("X-Frame-Options"); got != "DENY" {
			t.Errorf("%s: X-Frame-Options = %q", path, got)
		}
		if got := resp.Header.Get("Content-Security-Policy"); got != "" {
			t.Errorf("%s: unexpected CSP %q", path, got)
		}
	}
}
