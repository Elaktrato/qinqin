package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

// TestRootMuxKeepsAPI proves that mounting the SPA at / does not swallow
// the API and health routes.
func TestRootMuxKeepsAPI(t *testing.T) {
	web := fstest.MapFS{
		"index.html": &fstest.MapFile{
			Data: []byte("<!doctype html><title>qinqin spa</title>"),
		},
		"hanzi/U597D.json": &fstest.MapFile{Data: []byte(`{"from":"the web build"}`)},
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
			// Stroke files are served by the API from the installed strokes
			// pack, even when an old web build still carries hanzi/ files.
			{"GET", "/hanzi/U597D.json"}, {"GET", "/hanzi/nope"},
			// Font slices are served by the API from the installed font packs.
			{"GET", "/fonts/" + strings.Repeat("a", 64) + ".woff2"}, {"GET", "/fonts/nope"},
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
