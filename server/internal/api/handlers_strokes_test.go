package api

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"testing"

	"qinqin/internal/dict"
	"qinqin/internal/packs"
	"qinqin/internal/strokes"
)

const strokeHao = `{"strokes":["M 1 2 Q 3 4"],"medians":[[[1,2],[3,4]]]}`

// installStrokes imports a strokes pack carrying 好 and 一.
func installStrokes(t *testing.T, s *server, id string) {
	t.Helper()
	dir := t.TempDir()
	m, _ := json.Marshal(map[string]any{
		"id": id, "name": "Stroke data", "version": "2.0.1", "type": "strokes", "languages": []string{"zh", "ja"},
		"license": "Arphic Public License", "attribution": "Make Me a Hanzi via hanzi-writer-data",
		"notice": "Used unmodified.", "format": "hanzi-writer-jsonl-gz",
	})
	var gz bytes.Buffer
	zw := gzip.NewWriter(&gz)
	zw.Write([]byte(`{"char":"好","data":` + strokeHao + "}\n" + `{"char":"一","data":{"strokes":["M 3 4"]}}` + "\n"))
	zw.Close()
	for name, body := range map[string][]byte{"manifest.json": m, strokes.DataFile: gz.Bytes()} {
		if err := os.WriteFile(filepath.Join(dir, name), body, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	p, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := packs.Import(context.Background(), s.db, p); err != nil {
		t.Fatal(err)
	}
}

func serveGet(h http.Handler, method, path, token string, header map[string]string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, nil)
	r.RemoteAddr = "192.0.2.10:1234"
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	for k, v := range header {
		r.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, r)
	return rec
}

func TestStrokeFiles(t *testing.T) {
	s, h, _, a, sqlDB := newGateServerFresh(t)
	s.limits = newAuthLimits(walkPolicy())
	tok := newTokenActors(t, sqlDB)

	// Nothing installed: 404.
	if rec := serveGet(h, "GET", "/hanzi/U597D.json", "", nil); rec.Code != 404 {
		t.Fatalf("no strokes installed: %d", rec.Code)
	}
	installStrokes(t, s, "hw")

	for who, token := range map[string]string{"anonymous": "", "user": a.user, "restricted": a.pwc} {
		rec := serveGet(h, "GET", "/hanzi/U597D.json", token, nil)
		if rec.Code != 200 || rec.Body.String() != strokeHao {
			t.Fatalf("%s: %d %q", who, rec.Code, rec.Body)
		}
		hd := rec.Header()
		if hd.Get("Content-Type") != "application/json" || hd.Get("Cache-Control") != "public, max-age=86400" || len(hd.Get("ETag")) < 10 {
			t.Errorf("%s headers %v", who, hd)
		}
	}
	etag := serveGet(h, "GET", "/hanzi/U597D.json", "", nil).Header().Get("ETag")
	if rec := serveGet(h, "GET", "/hanzi/U4E00.json", "", nil); rec.Code != 200 || rec.Body.String() != `{"strokes":["M 3 4"]}` || rec.Header().Get("ETag") == etag {
		t.Errorf("一: %d %q etag %q", rec.Code, rec.Body, rec.Header().Get("ETag"))
	}
	if rec := serveGet(h, "GET", "/hanzi/U597D.json", "", map[string]string{"If-None-Match": etag}); rec.Code != 304 {
		t.Errorf("If-None-Match: %d", rec.Code)
	}
	if rec := serveGet(h, "HEAD", "/hanzi/U597D.json", "", nil); rec.Code != 200 || rec.Body.Len() != 0 || rec.Header().Get("Content-Length") != strconv.Itoa(len(strokeHao)) {
		t.Errorf("HEAD: %d %q length %q", rec.Code, rec.Body, rec.Header().Get("Content-Length"))
	}
	// Only the canonical name of a code point that has data.
	for _, p := range []string{
		"/hanzi/U597d.json", "/hanzi/U597D.JSON", "/hanzi/U0.json", "/hanzi/U0597D.json", "/hanzi/u597D.json",
		"/hanzi/UD800.json", "/hanzi/UDFFF.json", "/hanzi/U110000.json", "/hanzi/U1000000.json", "/hanzi/U597D.json.map",
		"/hanzi/U597D", "/hanzi/U597D.json/x", "/hanzi/..%2F..%2Fqinqin.db", "/hanzi/U4E01.json", "/hanzi/",
	} {
		if rec := serveGet(h, "GET", p, "", nil); rec.Code != 404 {
			t.Errorf("%s: %d, want 404", p, rec.Code)
		}
	}
	// noTok: a token is refused even though the route is public.
	if rec := serveGet(h, "GET", "/hanzi/U597D.json", tok.patR, nil); rec.Code != 403 || errCode(rec) != "token_not_allowed" {
		t.Errorf("token: %d %s", rec.Code, rec.Body)
	}
	// The pack that registered first serves; an uninstall hands over.
	if err := packs.Uninstall(context.Background(), sqlDB, "strokes", "hw"); err != nil {
		t.Fatal(err)
	}
	if rec := serveGet(h, "GET", "/hanzi/U597D.json", "", nil); rec.Code != 404 {
		t.Errorf("after uninstall: %d", rec.Code)
	}
}

func TestStrokePacksList(t *testing.T) {
	s, h, _, a, sqlDB := newGateServerFresh(t)
	s.limits = newAuthLimits(walkPolicy())
	tok := newTokenActors(t, sqlDB)
	if rec := serveGet(h, "GET", "/api/stroke-packs", "", nil); rec.Code != 200 || rec.Body.String() != "[]" {
		t.Fatalf("empty: %d %s", rec.Code, rec.Body)
	}
	installStrokes(t, s, "hw")
	installStrokes(t, s, "hw-two")
	for who, token := range map[string]string{"anonymous": "", "user": a.user, "read token": tok.patR, "limited token": tok.patL} {
		rec := serveGet(h, "GET", "/api/stroke-packs", token, nil)
		if rec.Code != 200 {
			t.Fatalf("%s: %d %s", who, rec.Code, rec.Body)
		}
		var rows []map[string]json.RawMessage
		dec := json.NewDecoder(bytes.NewReader(rec.Body.Bytes()))
		if err := dec.Decode(&rows); err != nil || len(rows) != 2 {
			t.Fatalf("%s: %v %s", who, err, rec.Body)
		}
		if got := keysOf(rows[0]); !slices.Equal(got, []string{"attribution", "languages", "license", "name", "notice", "packId", "version"}) {
			t.Errorf("row keys %v", got)
		}
		if string(rows[0]["packId"]) != `"hw"` || string(rows[1]["packId"]) != `"hw-two"` || string(rows[0]["languages"]) != `["ja","zh"]` {
			t.Errorf("%s rows %s", who, rec.Body)
		}
	}
	if err := packs.Uninstall(context.Background(), sqlDB, "strokes", "hw"); err != nil {
		t.Fatal(err)
	}
	if rec := serveGet(h, "GET", "/api/stroke-packs", "", nil); rec.Code != 200 || bytes.Contains(rec.Body.Bytes(), []byte(`"hw"`)) {
		t.Errorf("after uninstall: %s", rec.Body)
	}
}
