package webdist_test

import (
	"io"
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
