package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"qinqin/internal/auth"
	"qinqin/internal/datapkg"
	"qinqin/internal/pack"
	"qinqin/internal/packs"
)

// pkgWorld is the gate server with two installed dictionaries (es and zh),
// their data packages built, and the walk's tokens. gate-user owns zh
// workspaces A and B and an es workspace; gate-user2 owns zh workspace C
// only.
type pkgWorld struct {
	s     *server
	h     http.Handler
	a     gateActors
	tok   tokenActors
	reg   datapkg.Registry
	user1 int64
}

func importJSONDict(t *testing.T, s *server, id, language string) {
	t.Helper()
	dir := t.TempDir()
	manifest := `{"id":"` + id + `","name":"` + id + `","version":"1.0","type":"dictionary","language":"` + language +
		`","license":"CC0-1.0","attribution":"Qinqin test fixtures","format":"json"}`
	body := `{"entries":[{"written":"hola","kind":"word","readings":[{"type":"latin","value":"hola"}],"glosses":["hello"]}]}`
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), []byte(manifest), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "dictionary.json"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	p, err := pack.LoadPack(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := packs.Import(context.Background(), s.db, p, packs.WithOnChange(s.packChanged)); err != nil {
		t.Fatal(err)
	}
}

func newPkgWorld(t *testing.T) pkgWorld {
	t.Helper()
	s, h, _, a, sqlDB := newGateServerFresh(t)
	s.limits = newAuthLimits(walkPolicy())
	b := datapkg.NewBuilder(datapkg.Registry{DB: sqlDB, Dir: filepath.Join(t.TempDir(), "packages")}, t.Logf)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	go b.Run(ctx)
	s.packages = b
	importJSONDict(t, s, "es-test", "es")
	importJSONDict(t, s, "zh-test", "zh")
	wctx, wcancel := context.WithTimeout(context.Background(), time.Minute)
	defer wcancel()
	if err := b.Wait(wctx); err != nil {
		t.Fatal(err)
	}
	w := pkgWorld{s: s, h: h, a: a, tok: newTokenActors(t, sqlDB), reg: b.Registry()}
	if err := sqlDB.QueryRow(`SELECT id FROM users WHERE username = 'gate-user'`).Scan(&w.user1); err != nil {
		t.Fatal(err)
	}
	if _, err := sqlDB.Exec(`INSERT INTO workspaces (user_id, language, name, updated_at) VALUES (?, 'es', 'Spanish secret', '2026-01-01T00:00:00Z')`, w.user1); err != nil {
		t.Fatal(err)
	}
	return w
}

func (w pkgWorld) get(t *testing.T, path, token string, header map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(http.MethodGet, path, nil)
	r.RemoteAddr = "192.0.2.10:1234"
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	for k, v := range header {
		r.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	w.h.ServeHTTP(rec, r)
	return rec
}

func errCode(rec *httptest.ResponseRecorder) string {
	var e struct {
		Error string `json:"error"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &e)
	return e.Error
}

// catalogueKeys reads the key lists of docs/contracts/packages/catalogue.json.
func catalogueKeys(t *testing.T) (top, row, admin, source []string) {
	t.Helper()
	raw, err := os.ReadFile("../../../docs/contracts/packages/catalogue.json")
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		TopKeys      []string `json:"topKeys"`
		RowKeys      []string `json:"rowKeys"`
		AdminRowKeys []string `json:"adminRowKeys"`
		SourceKeys   []string `json:"sourceKeys"`
	}
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	return f.TopKeys, f.RowKeys, f.AdminRowKeys, f.SourceKeys
}

func keysOf(m map[string]json.RawMessage) []string {
	var ks []string
	for k := range m {
		ks = append(ks, k)
	}
	slices.Sort(ks)
	return ks
}

func sorted(s []string) []string {
	s = slices.Clone(s)
	slices.Sort(s)
	return s
}

// checkCatalogueShape decodes a catalogue strictly: exactly the fixture's
// keys (error only where admin allows it).
func checkCatalogueShape(t *testing.T, body []byte, adminAllowed bool) {
	t.Helper()
	topKeys, rowKeys, adminKeys, sourceKeys := catalogueKeys(t)
	var top map[string]json.RawMessage
	if err := json.Unmarshal(body, &top); err != nil {
		t.Fatal(err)
	}
	if got := keysOf(top); !slices.Equal(got, sorted(topKeys)) {
		t.Errorf("top keys %v, want %v", got, sorted(topKeys))
	}
	var rows []map[string]json.RawMessage
	if err := json.Unmarshal(top["packages"], &rows); err != nil {
		t.Fatal(err)
	}
	if len(rows) == 0 {
		t.Fatal("no packages listed")
	}
	for _, r := range rows {
		want := sorted(rowKeys)
		if _, ok := r["error"]; ok {
			if !adminAllowed {
				t.Errorf("row %s carries error in a user's catalogue", r["id"])
			}
			want = sorted(append(slices.Clone(rowKeys), adminKeys...))
		}
		if got := keysOf(r); !slices.Equal(got, want) {
			t.Errorf("row keys %v, want %v", got, want)
		}
		var srcs []map[string]json.RawMessage
		if err := json.Unmarshal(r["sources"], &srcs); err != nil {
			t.Fatal(err)
		}
		for _, s := range srcs {
			if got := keysOf(s); !slices.Equal(got, sorted(sourceKeys)) {
				t.Errorf("source keys %v, want %v", got, sorted(sourceKeys))
			}
		}
	}
	// And the typed decoder takes it without unknown fields.
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.DisallowUnknownFields()
	var c datapkg.Catalogue
	if err := dec.Decode(&c); err != nil {
		t.Errorf("strict decode: %v", err)
	}
}

func packageIDs(t *testing.T, body []byte) (ids []string, languages []string) {
	t.Helper()
	var c datapkg.Catalogue
	if err := json.Unmarshal(body, &c); err != nil {
		t.Fatal(err)
	}
	for _, p := range c.Packages {
		ids = append(ids, p.ID)
	}
	return ids, c.Languages
}

func TestPackageRoutesNeedAFullSession(t *testing.T) {
	w := newPkgWorld(t)
	for _, path := range []string{"/api/packages", "/api/packages/lexicon.es/1"} {
		if rec := w.get(t, path, "", nil); rec.Code != 401 || errCode(rec) != "unauthorized" {
			t.Errorf("%s anonymous: %d %s", path, rec.Code, rec.Body)
		}
		if rec := w.get(t, path, w.a.pwc, nil); rec.Code != 403 || errCode(rec) != "password_change_required" {
			t.Errorf("%s restricted: %d %s", path, rec.Code, rec.Body)
		}
		if rec := w.get(t, path, w.a.enr, nil); rec.Code != 403 || errCode(rec) != "mfa_enrollment_required" {
			t.Errorf("%s enrolling: %d %s", path, rec.Code, rec.Body)
		}
	}
}

func TestPackageCatalogueShapeLanguagesAndETag(t *testing.T) {
	w := newPkgWorld(t)
	// gate-user: default languages are its workspaces' (es, zh).
	rec := w.get(t, "/api/packages", w.a.user, nil)
	if rec.Code != 200 {
		t.Fatalf("catalogue: %d %s", rec.Code, rec.Body)
	}
	checkCatalogueShape(t, rec.Body.Bytes(), false)
	if cc := rec.Header().Get("Cache-Control"); cc != "no-cache" {
		t.Errorf("Cache-Control %q", cc)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type %q", ct)
	}
	if strings.Contains(rec.Body.String(), "Spanish secret") || strings.Contains(rec.Body.String(), "workspace") {
		t.Errorf("catalogue carries workspace data: %s", rec.Body)
	}
	ids, langs := packageIDs(t, rec.Body.Bytes())
	if !slices.Equal(ids, []string{"lexicon.es", "lexicon.zh"}) || !slices.Equal(langs, []string{"es", "zh"}) {
		t.Errorf("user 1 default: ids %v languages %v", ids, langs)
	}
	etag := rec.Header().Get("ETag")
	if !strings.HasPrefix(etag, `"`) || len(etag) < 10 {
		t.Fatalf("ETag %q", etag)
	}
	if rec := w.get(t, "/api/packages", w.a.user, map[string]string{"If-None-Match": etag}); rec.Code != 304 || rec.Body.Len() != 0 || rec.Header().Get("ETag") != etag {
		t.Errorf("If-None-Match: %d %q %s", rec.Code, rec.Header().Get("ETag"), rec.Body)
	}
	if rec := w.get(t, "/api/packages", w.a.user, map[string]string{"If-None-Match": `"other"`}); rec.Code != 200 {
		t.Errorf("If-None-Match other: %d", rec.Code)
	}

	// gate-user2 (zh only, through a token of its own: a session would do
	// the same) sees zh only; the explicit list and all are the same for both.
	var u2 int64
	w.s.db.QueryRow(`SELECT id FROM users WHERE username = 'gate-user2'`).Scan(&u2)
	tok2 := mintPAT(t, w.s, u2, "read", nil)
	rec = w.get(t, "/api/packages", tok2, nil)
	ids, langs = packageIDs(t, rec.Body.Bytes())
	if rec.Code != 200 || !slices.Equal(ids, []string{"lexicon.zh"}) || !slices.Equal(langs, []string{"zh"}) {
		t.Errorf("user 2 default: %d ids %v languages %v", rec.Code, ids, langs)
	}
	if rec.Header().Get("ETag") == etag {
		t.Error("the ETag does not change with the language set")
	}
	for _, tok := range []string{w.a.user, tok2} {
		rec = w.get(t, "/api/packages?languages=all", tok, nil)
		ids, langs = packageIDs(t, rec.Body.Bytes())
		if rec.Code != 200 || !slices.Equal(ids, []string{"lexicon.es", "lexicon.zh"}) || !slices.Equal(langs, []string{"es", "zh"}) {
			t.Errorf("all: %d ids %v languages %v", rec.Code, ids, langs)
		}
		rec = w.get(t, "/api/packages?languages=es", tok, nil)
		ids, langs = packageIDs(t, rec.Body.Bytes())
		if rec.Code != 200 || !slices.Equal(ids, []string{"lexicon.es"}) || !slices.Equal(langs, []string{"es"}) {
			t.Errorf("es: %d ids %v languages %v", rec.Code, ids, langs)
		}
	}
	for _, q := range []string{"?languages=", "?languages=ES", "?languages=zh,../x", "?languages=" + strings.Repeat("zh,", 40) + "zh"} {
		if rec := w.get(t, "/api/packages"+q, w.a.user, nil); rec.Code != 400 || errCode(rec) != "bad_request" {
			t.Errorf("%s: %d %s, want 400 bad_request", q, rec.Code, rec.Body)
		}
	}
}

func mintPAT(t *testing.T, s *server, user int64, scope string, ws *int64) string {
	t.Helper()
	tok, _, err := auth.CreateToken(context.Background(), s.db, user, auth.TokenRequest{Name: "pkg", Scope: scope, ExpiresInDays: 30, WorkspaceID: ws})
	if err != nil {
		t.Fatal(err)
	}
	return tok
}

func TestPackageCatalogueErrorOnlyForAdminSessions(t *testing.T) {
	w := newPkgWorld(t)
	if _, err := w.s.db.Exec(`UPDATE packages SET error = 'boom' WHERE id = 'lexicon.zh'`); err != nil {
		t.Fatal(err)
	}
	has := func(rec *httptest.ResponseRecorder) bool {
		return strings.Contains(rec.Body.String(), `"error":"boom"`)
	}
	rec := w.get(t, "/api/packages?languages=all", w.a.admin, nil)
	if rec.Code != 200 || !has(rec) {
		t.Errorf("admin session: %d %s", rec.Code, rec.Body)
	}
	checkCatalogueShape(t, rec.Body.Bytes(), true)
	for who, tok := range map[string]string{"user": w.a.user, "admin token": w.tok.adminPatW} {
		if rec := w.get(t, "/api/packages?languages=all", tok, nil); rec.Code != 200 || has(rec) {
			t.Errorf("%s: %d %s", who, rec.Code, rec.Body)
		}
	}
}

func TestPackageDownload(t *testing.T) {
	w := newPkgWorld(t)
	cat, err := w.reg.Catalogue(context.Background(), []string{"es"}, false)
	if err != nil || len(cat.Packages) != 1 || cat.Packages[0].URL == nil {
		t.Fatalf("catalogue %+v %v", cat, err)
	}
	row := cat.Packages[0]
	url := *row.URL
	rec := w.get(t, url, w.a.user, nil)
	if rec.Code != 200 {
		t.Fatalf("download: %d %s", rec.Code, rec.Body)
	}
	full := rec.Body.Bytes()
	sum := sha256.Sum256(full)
	if hex.EncodeToString(sum[:]) != row.SHA256 || int64(len(full)) != row.Bytes {
		t.Errorf("file sha256/bytes differ from the catalogue")
	}
	hd := rec.Header()
	etag := `"` + row.SHA256 + `"`
	for k, v := range map[string]string{
		"ETag": etag, "Content-Length": strconv.Itoa(len(full)), "Accept-Ranges": "bytes",
		// no-cache, not immutable: after a restore a revision number may come
		// back with other bytes, so a cached copy revalidates by its ETag.
		"Cache-Control": "private, no-cache", "Content-Type": "application/zip", "X-Content-Type-Options": "nosniff",
	} {
		if hd.Get(k) != v {
			t.Errorf("%s = %q, want %q", k, hd.Get(k), v)
		}
	}
	if len(full) < 200 {
		t.Fatalf("package of %d bytes is too small for the range test", len(full))
	}
	rec = w.get(t, url, w.a.user, map[string]string{"Range": "bytes=100-199"})
	if rec.Code != 206 || !bytes.Equal(rec.Body.Bytes(), full[100:200]) || rec.Header().Get("Content-Range") != "bytes 100-199/"+strconv.Itoa(len(full)) {
		t.Errorf("range: %d %q", rec.Code, rec.Header().Get("Content-Range"))
	}
	rec = w.get(t, url, w.a.user, map[string]string{"Range": "bytes=100-199", "If-Range": etag})
	if rec.Code != 206 {
		t.Errorf("If-Range with the ETag: %d", rec.Code)
	}
	rec = w.get(t, url, w.a.user, map[string]string{"Range": "bytes=100-199", "If-Range": `"0000"`})
	if rec.Code != 200 || !bytes.Equal(rec.Body.Bytes(), full) {
		t.Errorf("If-Range with a wrong ETag: %d, want the full file", rec.Code)
	}
	if rec := w.get(t, url, w.a.user, map[string]string{"If-None-Match": etag}); rec.Code != 304 {
		t.Errorf("If-None-Match: %d", rec.Code)
	}

	// Not found: unknown id, bad grammar, traversal attempts, odd revisions.
	for _, p := range []string{
		"/api/packages/lexicon.fr/1", "/api/packages/Lexicon.es/1", "/api/packages/lexicon.es/2",
		"/api/packages/..%2F..%2Fqinqin.db/1", "/api/packages/lexicon.es%2F..%2F..%2Fx/1", "/api/packages/lexicon.zh%2F../1",
		"/api/packages/lexicon.es/x", "/api/packages/lexicon.es/0", "/api/packages/lexicon.es/-1", "/api/packages/lexicon.es/+1",
		"/api/packages/lexicon.es/01", "/api/packages/lexicon.es/1.0", "/api/packages/lexicon.es/99999999999999999999",
	} {
		if rec := w.get(t, p, w.a.user, nil); rec.Code != 404 || errCode(rec) != "package_not_found" {
			t.Errorf("%s: %d %q, want 404 package_not_found", p, rec.Code, errCode(rec))
		}
	}

	// A replaced revision whose file was purged is gone.
	if _, err := w.s.db.Exec(`INSERT INTO package_files (id, revision, sha256, bytes, retire_after) VALUES ('lexicon.es', 7, 'x', 1, '2000-01-01T00:00:00Z')`); err != nil {
		t.Fatal(err)
	}
	if rec := w.get(t, "/api/packages/lexicon.es/7", w.a.user, nil); rec.Code != 410 || errCode(rec) != "package_revision_gone" {
		t.Errorf("purged revision: %d %s", rec.Code, rec.Body)
	}

	// Tokens: read, workspace-limited and write tokens all download.
	for who, tok := range map[string]string{"read": w.tok.patR, "limited": w.tok.patL, "write": w.tok.patW} {
		if rec := w.get(t, url, tok, nil); rec.Code != 200 {
			t.Errorf("%s token download: %d %s", who, rec.Code, rec.Body)
		}
		if rec := w.get(t, "/api/packages", tok, nil); rec.Code != 200 {
			t.Errorf("%s token catalogue: %d %s", who, rec.Code, rec.Body)
		}
	}
}

func TestPackageDownloadsAreLimitedPerUser(t *testing.T) {
	w := newPkgWorld(t)
	url := "/api/packages/lexicon.es/1"
	// Two downloads of gate-user are running.
	if !w.s.downloads.acquire(w.user1) || !w.s.downloads.acquire(w.user1) {
		t.Fatal("the first two slots must be free")
	}
	rec := w.get(t, url, w.a.user, nil)
	if rec.Code != 429 || errCode(rec) != "download_busy" || rec.Header().Get("Retry-After") != "5" {
		t.Errorf("third download: %d %q %q", rec.Code, rec.Header().Get("Retry-After"), errCode(rec))
	}
	// Its tokens share the user's slots; another user is unaffected.
	if rec := w.get(t, url, w.tok.patR, nil); rec.Code != 429 {
		t.Errorf("third download through a token: %d", rec.Code)
	}
	var u2 int64
	w.s.db.QueryRow(`SELECT id FROM users WHERE username = 'gate-user2'`).Scan(&u2)
	if rec := w.get(t, url, mintPAT(t, w.s, u2, "read", nil), nil); rec.Code != 200 {
		t.Errorf("another user: %d %s", rec.Code, rec.Body)
	}
	// The catalogue is never limited.
	if rec := w.get(t, "/api/packages", w.a.user, nil); rec.Code != 200 {
		t.Errorf("catalogue while downloads run: %d", rec.Code)
	}
	w.s.downloads.release(w.user1)
	if rec := w.get(t, url, w.a.user, nil); rec.Code != 200 {
		t.Errorf("after one finished: %d %s", rec.Code, rec.Body)
	}
	// A finished (or refused) download gives its slot back.
	w.s.downloads.release(w.user1)
	for i := 0; i < 3; i++ {
		if rec := w.get(t, url, w.a.user, nil); rec.Code != 200 {
			t.Errorf("sequential download %d: %d", i, rec.Code)
		}
	}
	if rec := w.get(t, "/api/packages/lexicon.es/1", w.a.user, map[string]string{"Range": "bytes=999999999-"}); rec.Code != 416 {
		t.Errorf("unsatisfiable range: %d", rec.Code)
	}
	if n := w.s.downloads.count(w.user1); n != 0 {
		t.Errorf("%d slots still held", n)
	}
}

// TestPullScopeCatalogueIsTheDefaultCatalogueETag pins that a v2 first page's
// scope.catalogue is the ETag GET /api/packages gives the same caller by
// default — for a user, an administrator's session (build errors shown) and
// an administrator's token (errors hidden).
func TestPullScopeCatalogueIsTheDefaultCatalogueETag(t *testing.T) {
	w := newPkgWorld(t)
	if _, err := w.s.db.Exec(`UPDATE packages SET error = 'boom'`); err != nil {
		t.Fatal(err)
	}
	if _, err := w.s.db.Exec(`INSERT INTO workspaces (user_id, language, name, updated_at)
		SELECT id, 'zh', 'Admin zh', '2026-01-01T00:00:00Z' FROM users WHERE username = 'gate-admin'
		AND NOT EXISTS (SELECT 1 FROM workspaces w JOIN users u ON u.id = w.user_id WHERE u.username = 'gate-admin' AND w.language = 'zh')`); err != nil {
		t.Fatal(err)
	}
	etags := map[string]string{}
	for who, tok := range map[string]string{"user": w.a.user, "admin session": w.a.admin, "admin token": w.tok.adminPatW} {
		cat := w.get(t, "/api/packages", tok, nil)
		if cat.Code != 200 || cat.Header().Get("ETag") == "" {
			t.Fatalf("%s catalogue: %d %s", who, cat.Code, cat.Body)
		}
		pull := w.get(t, "/api/sync/pull?v=2&collections=workspaces", tok, nil)
		if pull.Code != 200 {
			t.Fatalf("%s pull: %d %s", who, pull.Code, pull.Body)
		}
		var page struct {
			Scope *struct {
				Catalogue string `json:"catalogue"`
			} `json:"scope"`
		}
		if err := json.Unmarshal(pull.Body.Bytes(), &page); err != nil || page.Scope == nil {
			t.Fatalf("%s pull body: %v %s", who, err, pull.Body)
		}
		if page.Scope.Catalogue != cat.Header().Get("ETag") {
			t.Errorf("%s: scope.catalogue %s, catalogue ETag %s", who, page.Scope.Catalogue, cat.Header().Get("ETag"))
		}
		etags[who] = cat.Header().Get("ETag")
	}
	if etags["admin session"] == etags["admin token"] {
		t.Errorf("the admin session's catalogue should show the build errors (ETag %s for both)", etags["admin session"])
	}
}
