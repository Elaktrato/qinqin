package api_test

import (
	"archive/zip"
	"bytes"
	"database/sql"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"qinqin/internal/api"
	"qinqin/internal/dbtest"
)

// packEnv is a server with a controllable clock and import hook.
type packEnv struct {
	ts      *httptest.Server
	db      *sql.DB
	dataDir string
	admin   string
	done    chan string
	lock    func()
	unlock  func()
	mu      sync.Mutex
	now     time.Time
}

func (e *packEnv) advance(d time.Duration) {
	e.mu.Lock()
	e.now = e.now.Add(d)
	e.mu.Unlock()
}

func newPackEnv(t *testing.T, opts ...api.Option) *packEnv {
	t.Helper()
	return newPackEnvWith(t, make(chan string, 8), opts...)
}

func newPackEnvWith(t *testing.T, done chan string, opts ...api.Option) *packEnv {
	t.Helper()
	e := &packEnv{now: time.Now(), done: done, dataDir: t.TempDir()}
	sqlDB := dbtest.Open(t)
	e.db = sqlDB
	clock := func() time.Time { e.mu.Lock(); defer e.mu.Unlock(); return e.now }
	opts = append([]api.Option{api.WithClock(clock), api.WithImportDone(e.done), api.WithPackLock(&e.lock, &e.unlock)}, opts...)
	e.ts = httptest.NewServer(api.New(sqlDB, e.dataDir, nil, opts...))
	t.Cleanup(e.ts.Close)
	e.admin = registerUser(t, e.ts.URL, "admin", "")
	return e
}

type stagedBody struct {
	Token     string `json:"token"`
	ExpiresAt string `json:"expiresAt"`
	Manifest  struct {
		ID, Name, Version, Type, Language, License, Attribution, Notice, Format string
	} `json:"manifest"`
	Replaces *struct {
		Version, License, Attribution string
	} `json:"replaces"`
	Files int   `json:"files"`
	Bytes int64 `json:"bytes"`
}

func uploadPack(t *testing.T, e *packEnv, token string, body io.Reader, ctype string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, e.ts.URL+"/api/admin/packs", body)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", ctype)
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("upload: %v", err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}

func uploadZip(t *testing.T, e *packEnv, token string, zipBytes []byte) *http.Response {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	part, _ := mw.CreateFormFile("pack", "pack.zip")
	part.Write(zipBytes)
	mw.Close()
	return uploadPack(t, e, token, &buf, mw.FormDataContentType())
}

func stageZip(t *testing.T, e *packEnv, zipBytes []byte) stagedBody {
	t.Helper()
	resp := uploadZip(t, e, e.admin, zipBytes)
	if resp.StatusCode != http.StatusCreated {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("stage status = %d %s", resp.StatusCode, b)
	}
	var s stagedBody
	decodeJSON(t, resp, &s)
	return s
}

func bodyText(resp *http.Response) string {
	b, _ := io.ReadAll(resp.Body)
	return errorText(b)
}

func esPackZip(t *testing.T, manifest string) []byte {
	return zipDirToBytes(t, buildPackDir(t, manifest, packTestDict))
}

func stageDirs(t *testing.T, dataDir string) []string {
	t.Helper()
	entries, _ := os.ReadDir(filepath.Join(dataDir, "packs"))
	var out []string
	for _, en := range entries {
		if strings.HasPrefix(en.Name(), ".stage-") {
			out = append(out, en.Name())
		}
	}
	return out
}

func TestStageUploadReturnsManifestAndReplaces(t *testing.T) {
	e := newPackEnv(t)
	s := stageZip(t, e, esPackZip(t, packTestDictManifest))
	if len(s.Token) != 32 || s.ExpiresAt == "" || s.Replaces != nil || s.Files != 2 || s.Bytes <= 0 {
		t.Errorf("stage = %+v", s)
	}
	m := s.Manifest
	if m.ID != "es-test" || m.Name != "Spanish test" || m.Version != "1.0" || m.Type != "dictionary" || m.Language != "es" ||
		m.License != "CC0-1.0" || m.Attribution != "Qinqin test fixtures" || m.Notice != "Hand-written." || m.Format != "json" {
		t.Errorf("manifest = %+v", m)
	}
	if exp, err := time.Parse(time.RFC3339, s.ExpiresAt); err != nil || exp.Before(e.now.Add(29*time.Minute)) {
		t.Errorf("expiresAt = %q (%v)", s.ExpiresAt, err)
	}
	// Installed pack with the same type and id: the stage says what it replaces.
	installTestPacks(t, e.db)
	newer := strings.Replace(packTestDictManifest, `"version":"1.0"`, `"version":"2.0"`, 1)
	newer = strings.Replace(newer, `"CC0-1.0"`, `"CC BY 4.0"`, 1)
	s2 := stageZip(t, e, esPackZip(t, newer))
	if s2.Replaces == nil || s2.Replaces.Version != "1.0" || s2.Replaces.License != "CC0-1.0" || s2.Replaces.Attribution != "Qinqin test fixtures" {
		t.Errorf("replaces = %+v", s2.Replaces)
	}
}

func TestStageUploadUnwrapsSingleFolder(t *testing.T) {
	e := newPackEnv(t)
	dir := t.TempDir()
	inner := filepath.Join(dir, "es-test")
	os.MkdirAll(inner, 0o755)
	os.WriteFile(filepath.Join(inner, "manifest.json"), []byte(packTestDictManifest), 0o644)
	os.WriteFile(filepath.Join(inner, "dictionary.json"), []byte(packTestDict), 0o644)
	s := stageZip(t, e, zipDirToBytes(t, dir))
	if s.Manifest.ID != "es-test" {
		t.Errorf("manifest = %+v", s.Manifest)
	}
}

func TestStageUploadTooLarge(t *testing.T) {
	e := newPackEnv(t)
	var prefix bytes.Buffer
	mw := multipart.NewWriter(&prefix)
	mw.CreateFormFile("pack", "big.zip")
	body := io.MultiReader(&prefix, io.LimitReader(zeroReader{}, 129<<20))
	resp := uploadPack(t, e, e.admin, body, mw.FormDataContentType())
	text := bodyText(resp)
	if resp.StatusCode != http.StatusRequestEntityTooLarge || !strings.HasPrefix(text, "too_large: ") || !strings.Contains(text, "128 MiB — use qinqin seed for larger packs") {
		t.Errorf("status = %d %q", resp.StatusCode, text)
	}
	if d := stageDirs(t, e.dataDir); len(d) != 0 {
		t.Errorf("stage dirs left: %v", d)
	}
}

type zeroReader struct{}

func (zeroReader) Read(p []byte) (int, error) { clear(p); return len(p), nil }

func TestStageUploadInvalidPackLeaksNoPath(t *testing.T) {
	e := newPackEnv(t)
	noLicense := strings.Replace(packTestDictManifest, `"license":"CC0-1.0",`, "", 1)
	resp := uploadZip(t, e, e.admin, esPackZip(t, noLicense))
	text := bodyText(resp)
	if resp.StatusCode != http.StatusBadRequest || !strings.HasPrefix(text, "pack_invalid: ") || !strings.Contains(text, "license is required") {
		t.Errorf("status = %d %q", resp.StatusCode, text)
	}
	if strings.Contains(text, e.dataDir) || strings.Contains(text, os.TempDir()) {
		t.Errorf("body leaks a path: %q", text)
	}
	if d := stageDirs(t, e.dataDir); len(d) != 0 {
		t.Errorf("stage dirs left: %v", d)
	}
	// Zip limit and traversal errors read the same way.
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, _ := zw.Create("../evil")
	w.Write([]byte("x"))
	zw.Close()
	resp = uploadZip(t, e, e.admin, buf.Bytes())
	text = bodyText(resp)
	if resp.StatusCode != http.StatusBadRequest || strings.Contains(text, e.dataDir) {
		t.Errorf("traversal: status = %d %q", resp.StatusCode, text)
	}
	// Not a zip at all.
	resp = uploadZip(t, e, e.admin, []byte("plain text"))
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("non-zip status = %d", resp.StatusCode)
	}
}

func TestStageLimitAndDiscard(t *testing.T) {
	e := newPackEnv(t)
	var tokens []string
	for i := 0; i < 3; i++ {
		tokens = append(tokens, stageZip(t, e, esPackZip(t, packTestDictManifest)).Token)
	}
	resp := uploadZip(t, e, e.admin, esPackZip(t, packTestDictManifest))
	if text := bodyText(resp); resp.StatusCode != http.StatusTooManyRequests || !strings.HasPrefix(text, "pack_staged: ") {
		t.Errorf("4th stage = %d %q", resp.StatusCode, text)
	}
	if d := stageDirs(t, e.dataDir); len(d) != 3 {
		t.Errorf("stage dirs = %v, want 3", d)
	}
	resp = doJSON(t, http.MethodDelete, e.ts.URL, "/api/admin/packs/staged/"+tokens[0], e.admin, nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Errorf("discard = %d", resp.StatusCode)
	}
	if d := stageDirs(t, e.dataDir); len(d) != 2 {
		t.Errorf("stage dirs after discard = %v", d)
	}
	resp = doJSON(t, http.MethodDelete, e.ts.URL, "/api/admin/packs/staged/"+tokens[0], e.admin, nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("second discard = %d", resp.StatusCode)
	}
	// A slot is free again.
	stageZip(t, e, esPackZip(t, packTestDictManifest))
}

func TestStageBoundToUploadingAdmin(t *testing.T) {
	e := newPackEnv(t)
	other := registerUser(t, e.ts.URL, "admin2", e.admin)
	// admin2 is a regular user; promote.
	if _, err := e.db.Exec(`UPDATE users SET admin = 1 WHERE username = 'admin2'`); err != nil {
		t.Fatal(err)
	}
	s := stageZip(t, e, esPackZip(t, packTestDictManifest))
	resp := doJSON(t, http.MethodDelete, e.ts.URL, "/api/admin/packs/staged/"+s.Token, other, nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("other admin discard = %d, want 404", resp.StatusCode)
	}
	for _, token := range []string{"", ""} {
		resp := doJSON(t, http.MethodDelete, e.ts.URL, "/api/admin/packs/staged/"+s.Token, token, nil)
		resp.Body.Close()
		if resp.StatusCode != http.StatusForbidden {
			t.Errorf("anonymous discard = %d, want 403", resp.StatusCode)
		}
	}
}

func TestStageExpiryAndSweep(t *testing.T) {
	e := newPackEnv(t)
	s := stageZip(t, e, esPackZip(t, packTestDictManifest))
	// A directory a restart left behind: older than an hour.
	packsDir := filepath.Join(e.dataDir, "packs")
	old := filepath.Join(packsDir, ".stage-old")
	os.MkdirAll(old, 0o755)
	os.Chtimes(old, e.now.Add(-2*time.Hour), e.now.Add(-2*time.Hour))
	recent := filepath.Join(packsDir, ".stage-recent")
	os.MkdirAll(recent, 0o755)

	e.advance(31 * time.Minute)
	resp := doJSON(t, http.MethodDelete, e.ts.URL, "/api/admin/packs/staged/"+s.Token, e.admin, nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("expired discard = %d, want 404", resp.StatusCode)
	}
	// The next upload sweeps the expired stage, so the slots are free.
	stageZip(t, e, esPackZip(t, packTestDictManifest))
	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Errorf(".stage-old not swept: %v", err)
	}
	if _, err := os.Stat(filepath.Join(packsDir, ".stage-"+s.Token)); !os.IsNotExist(err) {
		t.Errorf("expired stage dir not swept: %v", err)
	}
	if _, err := os.Stat(recent); err != nil {
		t.Errorf("recent unknown stage dir removed too early: %v", err)
	}
}
