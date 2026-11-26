package api_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/images"
	"qinqin/internal/lexicon"
	"qinqin/internal/pack"
)

type imagesEnv struct {
	ts                     *httptest.Server
	token                  string
	db                     *sql.DB
	apple, hit, kana, nope int64
}

const (
	envApple = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72"><path fill="none" stroke="#000" d="M1 2h3"/></svg>`
	envHit   = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72"><line x1="0" y1="0" x2="3" y2="3"/></svg>`
	envPhone = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72"><rect width="3" height="3"/></svg>`
)

// newImagesEnv serves an instance with a small images pack and four entries:
// 苹果 (zh), 打 (zh, two senses), a kana-only ja word and a word with no picture.
func newImagesEnv(t *testing.T) imagesEnv {
	t.Helper()
	ts, sqlDB, _ := newServerWithDir(t)
	token := registerUser(t, ts.URL, "alice", "")
	ctx := context.Background()
	var dictID int64
	if err := sqlDB.QueryRow(`INSERT INTO dictionaries (pack_id, name, version, license, attribution, updated_at)
		VALUES ('d', 'd', '1', 'x', 'x', '2026-01-01T00:00:00Z') RETURNING id`).Scan(&dictID); err != nil {
		t.Fatal(err)
	}
	st := lexicon.Store{DB: sqlDB}
	put := func(lang, key string, forms []string, kana ...string) int64 {
		e := &lexicon.Entry{Language: lang, Kind: "word", Key: key}
		for _, f := range forms {
			e.Forms = append(e.Forms, lexicon.Form{Text: f})
		}
		for _, k := range kana {
			e.Readings = append(e.Readings, lexicon.Reading{Type: "kana", Value: k, Plain: k})
		}
		id, err := st.Put(ctx, e, dictID)
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	env := imagesEnv{ts: ts, token: token, db: sqlDB}
	env.apple = put("zh", "苹果", []string{"苹果", "蘋果"})
	env.hit = put("zh", "打", []string{"打"})
	env.kana = put("ja", "j:1", nil, "いぬ") // no written form: found by its kana reading
	env.nope = put("zh", "桌子", []string{"桌子"})

	dir := t.TempDir()
	files := map[string]string{
		"manifest.json":  `{"id":"images-test","name":"Test pictures","version":"1","type":"images","languages":["zh","ja"],"license":"CC BY-SA 4.0","attribution":"Testers","notice":"Synthetic.","format":"images-svg"}`,
		"pictures.tsv":   "concept\tfile\tlabel\tcredit\nA\tpictures/A.svg\tred apple\tOpenMoji, Liz Bravo\nH\tpictures/H.svg\thit\tOpenMoji\nP\tpictures/P.svg\tphone\tOpenMoji\n",
		"pictures/A.svg": envApple,
		"pictures/H.svg": envHit,
		"pictures/P.svg": envPhone,
		"map.tsv":        "language\ttarget\tsense\tconcept\tscore\tbasis\tnote\nzh\t蘋果\t0\tA\t100\tmanual\t\nzh\t打\t1\tH\t80\tgloss\t\nzh\t打\t3\tP\t80\tgloss\t\nja\tいぬ\t0\tA\t90\tname\t\n",
	}
	for name, content := range files {
		p := filepath.Join(dir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	pk, err := pack.LoadPack(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := images.Import(ctx, sqlDB, pk); err != nil {
		t.Fatal(err)
	}
	return env
}

func (e imagesEnv) get(t *testing.T, path, token string) (int, map[string]any) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, e.ts.URL+path, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	return resp.StatusCode, out
}

func picture(t *testing.T, body map[string]any) map[string]any {
	t.Helper()
	p, ok := body["picture"]
	if !ok {
		t.Fatalf("no picture member in %v", body)
	}
	if p == nil {
		return nil
	}
	return p.(map[string]any)
}

func TestEntryPictureNeedsSignIn(t *testing.T) {
	e := newImagesEnv(t)
	if code, _ := e.get(t, fmt.Sprintf("/api/images/entries/%d", e.apple), ""); code != http.StatusUnauthorized {
		t.Errorf("without a token = %d, want 401", code)
	}
}

func TestEntryPicture(t *testing.T) {
	e := newImagesEnv(t)
	code, body := e.get(t, fmt.Sprintf("/api/images/entries/%d", e.apple), e.token)
	if code != http.StatusOK {
		t.Fatalf("status %d", code)
	}
	p := picture(t, body)
	want := map[string]any{"packId": "images-test", "concept": "A", "label": "red apple", "credit": "OpenMoji, Liz Bravo",
		"license": "CC BY-SA 4.0", "attribution": "Testers", "basis": "manual", "sense": float64(0), "score": float64(100), "svg": envApple}
	for k, v := range want {
		if p[k] != v {
			t.Errorf("picture[%s] = %v, want %v", k, p[k], v)
		}
	}
	// the whole entry of a word with no mapping, and a ja word found by its reading
	if _, b := e.get(t, fmt.Sprintf("/api/images/entries/%d", e.nope), e.token); picture(t, b) != nil {
		t.Errorf("a word with no mapping got %v", b)
	}
	if _, b := e.get(t, fmt.Sprintf("/api/images/entries/%d", e.kana), e.token); picture(t, b)["concept"] != "A" {
		t.Errorf("a kana-only word got %v", b)
	}
}

func TestEntryPictureBySense(t *testing.T) {
	e := newImagesEnv(t)
	path := func(q string) string { return fmt.Sprintf("/api/images/entries/%d%s", e.hit, q) }
	for _, c := range []struct{ query, concept string }{{"", "H"}, {"?sense=1", "H"}, {"?sense=3", "P"}, {"?sense=2", ""}} {
		_, b := e.get(t, path(c.query), e.token)
		p := picture(t, b)
		got := ""
		if p != nil {
			got = p["concept"].(string)
		}
		if got != c.concept {
			t.Errorf("GET %s: concept %q, want %q", c.query, got, c.concept)
		}
	}
	for _, q := range []string{"?sense=0", "?sense=-1", "?sense=x", "?sense=1000"} {
		if code, _ := e.get(t, path(q), e.token); code != http.StatusBadRequest {
			t.Errorf("GET %s = %d, want 400", q, code)
		}
	}
	if code, _ := e.get(t, "/api/images/entries/999999", e.token); code != http.StatusNotFound {
		t.Errorf("an unknown entry = %d, want 404", code)
	}
	if code, _ := e.get(t, "/api/images/entries/abc", e.token); code != http.StatusNotFound {
		t.Errorf("a bad id = %d, want 404", code)
	}
}

// A pack installed before the canonical form existed holds the pack's own
// bytes. The route must not serve them: it canonicalises what it reads, and
// shows no picture for one that no longer passes (v0.8.0 review: stored XSS).
func TestEntryPictureServesCanonicalSVGOnly(t *testing.T) {
	e := newImagesEnv(t)
	set := func(concept, svg string) {
		t.Helper()
		if _, err := e.db.Exec(`UPDATE image_pictures SET svg = ? WHERE concept = ?`, svg, concept); err != nil {
			t.Fatal(err)
		}
	}
	set("H", `<svg xmlns="http://www.w3.org/2000/svg"><!--><img/src="x"/onerror="alert(1)">--></svg>`)
	if _, b := e.get(t, fmt.Sprintf("/api/images/entries/%d?sense=1", e.hit), e.token); picture(t, b) != nil {
		t.Errorf("a stored picture that fails the check was served: %v", b)
	}
	set("P", `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="#a"/></svg>`)
	_, b := e.get(t, fmt.Sprintf("/api/images/entries/%d?sense=3", e.hit), e.token)
	if p := picture(t, b); p == nil || p["svg"] != `<svg xmlns="http://www.w3.org/2000/svg"><use href="#a"/></svg>` {
		t.Errorf("legacy stored picture = %v, want its canonical form", p)
	}
}

func TestImagePacksList(t *testing.T) {
	e := newImagesEnv(t)
	req, _ := http.NewRequest(http.MethodGet, e.ts.URL+"/api/image-packs", nil)
	resp, err := http.DefaultClient.Do(req) // public: no token
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d: %s", resp.StatusCode, raw)
	}
	got := strings.TrimSpace(string(raw))
	const want = `[{"packId":"images-test","name":"Test pictures","version":"1","languages":["ja","zh"],"license":"CC BY-SA 4.0","attribution":"Testers","notice":"Synthetic.","pictureCount":3,"mappingCount":4}]`
	if got != want {
		t.Errorf("GET /api/image-packs:\n got %s\nwant %s", got, want)
	}
}
