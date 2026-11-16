package api_test

import (
	"bytes"
	"compress/gzip"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"qinqin/internal/components"
	"qinqin/internal/dict"
)

// importComponents installs a components pack with the given files.
func importComponents(t *testing.T, sqlDB *sql.DB, id, language string, files map[string]string) {
	t.Helper()
	dir := t.TempDir()
	m, _ := json.Marshal(map[string]string{
		"id": id, "name": "Components " + id, "version": "1", "type": "components", "language": language,
		"license": "CC BY-SA 3.0", "attribution": "Test fixture", "format": "components-tsv", "notice": "Derived.",
	})
	files["manifest.json"] = string(m)
	for n, body := range files {
		if err := os.WriteFile(filepath.Join(dir, n), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	p, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := components.Import(context.Background(), sqlDB, p); err != nil {
		t.Fatal(err)
	}
}

// componentsFixture is docs/contracts/radicals/components-response.json.
type componentsFixture struct {
	Pack       map[string]string `json:"pack"`
	Components json.RawMessage   `json:"components"`
	Empty      json.RawMessage   `json:"emptyComponents"`
}

func loadComponentsFixture(t *testing.T) componentsFixture {
	t.Helper()
	raw, err := os.ReadFile("../../../docs/contracts/radicals/components-response.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx componentsFixture
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	return fx
}

// getPlain requests path with the given headers, without transparent gzip.
func getPlain(t *testing.T, tsURL, path string, header map[string]string) (*http.Response, []byte) {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, tsURL+path, nil)
	if err != nil {
		t.Fatal(err)
	}
	for k, v := range header {
		req.Header.Set(k, v)
	}
	client := &http.Client{Transport: &http.Transport{DisableCompression: true}}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("GET %s: %v", path, err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return resp, body
}

// jsonEqual reports whether a and b decode to the same value.
func jsonEqual(t *testing.T, a, b []byte) bool {
	t.Helper()
	var x, y any
	if err := json.Unmarshal(a, &x); err != nil {
		t.Fatalf("decode %s: %v", a, err)
	}
	if err := json.Unmarshal(b, &y); err != nil {
		t.Fatalf("decode %s: %v", b, err)
	}
	return reflect.DeepEqual(x, y)
}

func TestComponentsRejectsBadLanguage(t *testing.T) {
	ts, _ := newServer(t)
	for _, q := range []string{"", "?language=", "?language=JA", "?language=x!", "?language=" + strings.Repeat("a", 17)} {
		if resp, _ := getPlain(t, ts.URL, "/api/components"+q, nil); resp.StatusCode != http.StatusBadRequest {
			t.Errorf("query %q: status %d, want 400", q, resp.StatusCode)
		}
	}
}

func TestComponentsBody(t *testing.T) {
	ts, sqlDB := newServer(t)
	fx := loadComponentsFixture(t)

	// No packs: the empty body.
	resp, body := getPlain(t, ts.URL, "/api/components?language=ja", nil)
	if resp.StatusCode != http.StatusOK || !jsonEqual(t, body, fx.Empty) {
		t.Fatalf("no packs: status %d body %s", resp.StatusCode, body)
	}
	if ct := resp.Header.Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q", ct)
	}

	files := map[string]string{}
	for k, v := range fx.Pack {
		files[k] = v
	}
	importComponents(t, sqlDB, "ja-comp", "ja", files)
	resp, body = getPlain(t, ts.URL, "/api/components?language=ja", nil)
	if resp.StatusCode != http.StatusOK || !jsonEqual(t, body, fx.Components) {
		t.Errorf("with the fixture pack: status %d body\n%s\nwant\n%s", resp.StatusCode, body, fx.Components)
	}
	// Another language is still empty.
	_, body = getPlain(t, ts.URL, "/api/components?language=zh", nil)
	if string(body) != `{"language":"zh","parts":[],"chars":{}}` {
		t.Errorf("zh body = %s", body)
	}
}

func TestComponentsCachingAndGzip(t *testing.T) {
	ts, sqlDB := newServer(t)
	importComponents(t, sqlDB, "p", "ja", map[string]string{"components.tsv": "語\t言 口\n"})

	resp, body := getPlain(t, ts.URL, "/api/components?language=ja", nil)
	etag := resp.Header.Get("ETag")
	if !strings.HasPrefix(etag, `W/"comp1-ja-`) {
		t.Fatalf("ETag = %q", etag)
	}
	if cc := resp.Header.Get("Cache-Control"); cc != "private, max-age=0, must-revalidate" {
		t.Errorf("Cache-Control = %q", cc)
	}
	if v := resp.Header.Get("Vary"); v != "Accept-Encoding" {
		t.Errorf("Vary = %q", v)
	}
	if r, b := getPlain(t, ts.URL, "/api/components?language=ja", map[string]string{"If-None-Match": etag}); r.StatusCode != http.StatusNotModified || len(b) != 0 {
		t.Errorf("If-None-Match: status %d, body %q", r.StatusCode, b)
	}
	r, gz := getPlain(t, ts.URL, "/api/components?language=ja", map[string]string{"Accept-Encoding": "gzip"})
	if r.Header.Get("Content-Encoding") != "gzip" {
		t.Fatalf("Content-Encoding = %q", r.Header.Get("Content-Encoding"))
	}
	zr, err := gzip.NewReader(bytes.NewReader(gz))
	if err != nil {
		t.Fatal(err)
	}
	plain, _ := io.ReadAll(zr)
	if !bytes.Equal(plain, body) {
		t.Errorf("gzip body differs: %s vs %s", plain, body)
	}

	// A re-import with other rows moves the ETag (in the same second).
	importComponents(t, sqlDB, "p", "ja", map[string]string{"components.tsv": "語\t言 吾\n"})
	r, b := getPlain(t, ts.URL, "/api/components?language=ja", map[string]string{"If-None-Match": etag})
	if r.StatusCode != http.StatusOK || r.Header.Get("ETag") == etag || !strings.Contains(string(b), "吾") {
		t.Errorf("after a re-import: status %d, ETag %q (was %q), body %s", r.StatusCode, r.Header.Get("ETag"), etag, b)
	}
}

// Public shared data: an anonymous caller and two different users get
// byte-identical bodies of both routes, and no method but GET is served.
func TestComponentsSameForEveryCaller(t *testing.T) {
	ts, sqlDB := newServer(t)
	importComponents(t, sqlDB, "p", "ja", map[string]string{"components.tsv": "語\t言 口\n", "parts.tsv": "言\t7\n"})
	alice := registerUser(t, ts.URL, "alice", "")
	bob := registerUser(t, ts.URL, "bob", alice)
	for _, path := range []string{"/api/components?language=ja", "/api/component-packs"} {
		_, anon := getPlain(t, ts.URL, path, nil)
		_, a := getPlain(t, ts.URL, path, map[string]string{"Authorization": "Bearer " + alice})
		_, b := getPlain(t, ts.URL, path, map[string]string{"Authorization": "Bearer " + bob})
		if !bytes.Equal(anon, a) || !bytes.Equal(a, b) || len(anon) == 0 {
			t.Errorf("%s: bodies differ:\nanon %s\nalice %s\nbob %s", path, anon, a, b)
		}
		bare, _, _ := strings.Cut(path, "?")
		resp := doJSON(t, http.MethodPost, ts.URL, bare, alice, nil)
		if resp.StatusCode != http.StatusMethodNotAllowed {
			t.Errorf("POST %s: status %d, want 405", bare, resp.StatusCode)
		}
	}
}

func TestComponentPacksList(t *testing.T) {
	ts, sqlDB := newServer(t)
	resp, body := getPlain(t, ts.URL, "/api/component-packs", nil)
	if resp.StatusCode != http.StatusOK || string(body) != "[]" {
		t.Fatalf("empty list: %d %s", resp.StatusCode, body)
	}
	importComponents(t, sqlDB, "b", "zh", map[string]string{"components.tsv": "语\t讠\n"})
	importComponents(t, sqlDB, "a", "ja", map[string]string{"components.tsv": "語\t言\n"})
	if err := components.Uninstall(context.Background(), sqlDB, "b"); err != nil {
		t.Fatal(err)
	}
	_, body = getPlain(t, ts.URL, "/api/component-packs", nil)
	want := `[{"packId":"a","name":"Components a","version":"1","language":"ja","license":"CC BY-SA 3.0","attribution":"Test fixture","notice":"Derived."}]`
	if string(body) != want {
		t.Errorf("list = %s\nwant %s", body, want)
	}
}
