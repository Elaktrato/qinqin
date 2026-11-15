package webdist_test

import (
	"errors"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"qinqin/internal/webdist"
)

// spaFS is a miniature build output: an index document plus one hashed
// asset, the two shapes the handler must distinguish.
func spaFS() fstest.MapFS {
	return fstest.MapFS{
		"index.html": &fstest.MapFile{
			Data: []byte("<!doctype html><title>qinqin</title>"),
		},
		"assets/app.js": &fstest.MapFile{
			Data: []byte("console.log('qinqin')"),
		},
	}
}

// get performs a GET against the handler and returns status, content type
// and body.
func get(t *testing.T, h http.Handler, target string) (int, string, string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, target, nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	resp := rec.Result()
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	return resp.StatusCode, resp.Header.Get("Content-Type"), string(body)
}

func TestHandler(t *testing.T) {
	h := webdist.Handler(spaFS())

	t.Run("root serves index", func(t *testing.T) {
		status, ctype, body := get(t, h, "/")
		if status != http.StatusOK {
			t.Fatalf("status = %d, want %d", status, http.StatusOK)
		}
		if !strings.HasPrefix(ctype, "text/html") {
			t.Errorf("content type = %q, want text/html", ctype)
		}
		if !strings.Contains(body, "<!doctype html>") {
			t.Errorf("body = %q, want the index document", body)
		}
	})

	t.Run("asset is served", func(t *testing.T) {
		status, ctype, body := get(t, h, "/assets/app.js")
		if status != http.StatusOK {
			t.Fatalf("status = %d, want %d", status, http.StatusOK)
		}
		if !strings.Contains(ctype, "javascript") {
			t.Errorf("content type = %q, want a JavaScript type", ctype)
		}
		if !strings.Contains(body, "console.log") {
			t.Errorf("body = %q, want the asset contents", body)
		}
	})

	t.Run("unknown route falls back to index", func(t *testing.T) {
		status, ctype, body := get(t, h, "/entry/5")
		if status != http.StatusOK {
			t.Fatalf("status = %d, want %d", status, http.StatusOK)
		}
		if !strings.HasPrefix(ctype, "text/html") {
			t.Errorf("content type = %q, want text/html", ctype)
		}
		if !strings.Contains(body, "<!doctype html>") {
			t.Errorf("body = %q, want the index document", body)
		}
	})

	t.Run("root traversal cannot escape the build", func(t *testing.T) {
		status, _, body := get(t, h, "/../../etc/passwd")
		if status != http.StatusOK {
			t.Fatalf("status = %d, want %d", status, http.StatusOK)
		}
		if !strings.Contains(body, "<!doctype html>") {
			t.Errorf("body = %q, want the index document", body)
		}
	})
}

func TestHandlerWithoutBuild(t *testing.T) {
	h := webdist.Handler(fstest.MapFS{})

	status, ctype, body := get(t, h, "/")
	if status != http.StatusOK {
		t.Fatalf("status = %d, want %d", status, http.StatusOK)
	}
	if !strings.HasPrefix(ctype, "text/html") {
		t.Errorf("content type = %q, want text/html", ctype)
	}
	if !strings.Contains(body, "web build not bundled") {
		t.Errorf("body = %q, want the unbundled-build placeholder", body)
	}

	// Deep links must get the same placeholder, not a 404.
	status, _, _ = get(t, h, "/entry/5")
	if status != http.StatusOK {
		t.Errorf("deep link status = %d, want %d", status, http.StatusOK)
	}
}

// header performs a GET and returns the response for header assertions.
func header(t *testing.T, h http.Handler, target string) *http.Response {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, target, nil))
	return rec.Result()
}

func hardeningFS() fstest.MapFS {
	fsys := spaFS()
	fsys["_app/immutable/entry/app.abc123.js"] = &fstest.MapFile{Data: []byte("export{}")}
	fsys["fonts/a.woff2"] = &fstest.MapFile{Data: []byte("wOF2")}
	fsys["fonts/a.woff"] = &fstest.MapFile{Data: []byte("wOFF")}
	fsys["fonts/a.ttf"] = &fstest.MapFile{Data: []byte{0, 1, 0, 0}}
	fsys["LICENSE.TXT"] = &fstest.MapFile{Data: []byte("licence")}
	return fsys
}

func TestCachePolicy(t *testing.T) {
	h := webdist.Handler(hardeningFS())
	cases := []struct{ target, want string }{
		{"/", "no-store"},
		{"/index.html", "no-store"},
		{"/entry/5", "no-store"}, // SPA fallback is the index
		{"/_app/immutable/entry/app.abc123.js", "public, max-age=31536000, immutable"},
	}
	for _, c := range cases {
		if got := header(t, h, c.target).Header.Get("Cache-Control"); got != c.want {
			t.Errorf("%s Cache-Control = %q, want %q", c.target, got, c.want)
		}
	}
	// A missing hashed asset must not be cached as immutable: it falls back
	// to the index, which is no-store.
	if got := header(t, h, "/_app/immutable/gone.js").Header.Get("Cache-Control"); got != "no-store" {
		t.Errorf("missing immutable asset Cache-Control = %q, want no-store", got)
	}
}

func TestNosniffEverywhere(t *testing.T) {
	h := webdist.Handler(hardeningFS())
	for _, target := range []string{"/", "/assets/app.js", "/entry/5", "/fonts/a.woff2"} {
		if got := header(t, h, target).Header.Get("X-Content-Type-Options"); got != "nosniff" {
			t.Errorf("%s X-Content-Type-Options = %q, want nosniff", target, got)
		}
	}
	empty := webdist.Handler(fstest.MapFS{})
	if got := header(t, empty, "/").Header.Get("X-Content-Type-Options"); got != "nosniff" {
		t.Errorf("placeholder X-Content-Type-Options = %q, want nosniff", got)
	}
}

func TestFontAndTextMIME(t *testing.T) {
	h := webdist.Handler(hardeningFS())
	cases := map[string]string{
		"/fonts/a.woff2": "font/woff2",
		"/fonts/a.woff":  "font/woff",
		"/fonts/a.ttf":   "font/ttf",
		"/LICENSE.TXT":   "text/plain; charset=utf-8",
	}
	for target, want := range cases {
		if got := header(t, h, target).Header.Get("Content-Type"); got != want {
			t.Errorf("%s Content-Type = %q, want %q", target, got, want)
		}
	}
}

func TestDirectoryRequestFallsBackToIndex(t *testing.T) {
	h := webdist.Handler(hardeningFS())
	for _, target := range []string{"/assets", "/assets/", "/_app/immutable"} {
		status, ctype, body := get(t, h, target)
		if status != http.StatusOK || !strings.HasPrefix(ctype, "text/html") || !strings.Contains(body, "<!doctype html>") {
			t.Errorf("%s = %d %q %q, want the index document", target, status, ctype, body)
		}
	}
}

// failFS reports an I/O error (not fs.ErrNotExist) for the named files.
type failFS struct {
	fs.FS
	failStat, failRead string
}

func (f failFS) Open(name string) (fs.File, error) {
	if name == f.failStat {
		return nil, errors.New("disk on fire")
	}
	file, err := f.FS.Open(name)
	if err != nil || name != f.failRead {
		return file, err
	}
	return brokenFile{file}, nil
}

type brokenFile struct{ fs.File }

func (brokenFile) Read([]byte) (int, error) { return 0, errors.New("disk on fire") }

func TestIOErrorsAreNotAbsentFiles(t *testing.T) {
	cases := map[string]failFS{
		"stat failure":  {FS: hardeningFS(), failStat: "assets/app.js"},
		"read failure":  {FS: hardeningFS(), failRead: "assets/app.js"},
		"index failure": {FS: hardeningFS(), failRead: "index.html"},
	}
	targets := map[string]string{"stat failure": "/assets/app.js", "read failure": "/assets/app.js", "index failure": "/entry/5"}
	for name, fsys := range cases {
		status, _, body := get(t, webdist.Handler(fsys), targets[name])
		if status != http.StatusInternalServerError {
			t.Errorf("%s: status = %d, want 500 (body %q)", name, status, body)
		}
		if strings.Contains(body, "<!doctype html>") {
			t.Errorf("%s: served the SPA instead of failing", name)
		}
	}
}
