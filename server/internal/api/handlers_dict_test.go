package api_test

import (
	"archive/zip"
	"bytes"
	"database/sql"
	"io/fs"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"qinqin/internal/api"
	"qinqin/internal/db"
	"qinqin/internal/lang"
)

// dictFixture is the shared dictionary pack fixture, relative to this
// package's test working directory.
const dictFixture = "../dict/testdata/mkgloss"

// newServerWithDir opens a fresh migrated database and serves the API on
// it with its own data directory, which is also returned.
func newServerWithDir(t *testing.T) (*httptest.Server, *sql.DB, string) {
	t.Helper()
	dataDir := t.TempDir()
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	ts := httptest.NewServer(api.New(sqlDB, dataDir, nil))
	t.Cleanup(ts.Close)
	return ts, sqlDB, dataDir
}

// dictionaryBody mirrors the JSON body of the /api/dictionaries routes.
type dictionaryBody struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	Version     string `json:"version"`
	License     string `json:"license"`
	Attribution string `json:"attribution"`
}

// buildPackDir writes manifest.json and dictionary.json into a fresh temp
// directory and returns its path.
func buildPackDir(t *testing.T, manifest, dictionary string) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), []byte(manifest), 0o644); err != nil {
		t.Fatalf("write manifest.json: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "dictionary.json"), []byte(dictionary), 0o644); err != nil {
		t.Fatalf("write dictionary.json: %v", err)
	}
	return dir
}

// zipDirToBytes zips every file under dir, preserving relative names,
// into an in-memory zip.
func zipDirToBytes(t *testing.T, dir string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	err := filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(dir, path)
		if err != nil {
			return err
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		w, err := zw.Create(filepath.ToSlash(rel))
		if err != nil {
			return err
		}
		_, err = w.Write(data)
		return err
	})
	if err != nil {
		t.Fatalf("zip %s: %v", dir, err)
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("close zip of %s: %v", dir, err)
	}
	return buf.Bytes()
}

// postPack posts a multipart form to the admin dictionary install route
// with the given bearer token. zipBytes is written under the file field
// named fieldName; an empty fieldName sends a form without any file.
func postPack(t *testing.T, tsURL, token, fieldName string, zipBytes []byte) *http.Response {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	if fieldName != "" {
		part, err := mw.CreateFormFile(fieldName, "pack.zip")
		if err != nil {
			t.Fatalf("create form file: %v", err)
		}
		if _, err := part.Write(zipBytes); err != nil {
			t.Fatalf("write form file: %v", err)
		}
	}
	if err := mw.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}
	req, err := http.NewRequest(http.MethodPost, tsURL+"/api/admin/dictionaries", &buf)
	if err != nil {
		t.Fatalf("build install request: %v", err)
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST /api/admin/dictionaries: %v", err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}

// listDictionaries fetches GET /api/dictionaries and returns its list.
func listDictionaries(t *testing.T, tsURL string) []dictionaryBody {
	t.Helper()
	resp := doJSON(t, http.MethodGet, tsURL, "/api/dictionaries", "", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /api/dictionaries: status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	var list []dictionaryBody
	decodeJSON(t, resp, &list)
	return list
}

func TestDictionaryRoutes(t *testing.T) {
	// zh registers as a code pack, exactly as main.go does for the server:
	// imported entries derive their bopomofo readings through it.
	lang.Register(lang.Zh{})

	ts, sqlDB, dataDir := newServerWithDir(t)
	admin := registerUser(t, ts.URL, "admin", "") // first user = instance admin
	bob := registerUser(t, ts.URL, "bob", admin)

	// The registry starts empty.
	if list := listDictionaries(t, ts.URL); len(list) != 0 {
		t.Fatalf("GET /api/dictionaries = %+v, want empty", list)
	}

	// Install and uninstall are admin-only.
	if resp := postPack(t, ts.URL, "", "pack", nil); resp.StatusCode != http.StatusForbidden {
		t.Errorf("POST without token: status = %d, want %d", resp.StatusCode, http.StatusForbidden)
	}
	if resp := postPack(t, ts.URL, bob, "pack", nil); resp.StatusCode != http.StatusForbidden {
		t.Errorf("POST as non-admin: status = %d, want %d", resp.StatusCode, http.StatusForbidden)
	}
	for _, path := range []string{"/api/admin/dictionaries/1", "/api/admin/dictionaries/NaN"} {
		if resp := doJSON(t, http.MethodDelete, ts.URL, path, "", nil); resp.StatusCode != http.StatusForbidden {
			t.Errorf("DELETE %s without token: status = %d, want %d", path, resp.StatusCode, http.StatusForbidden)
		}
	}

	// Malformed uploads are 400: not multipart, no pack field, not a zip,
	// an invalid manifest, a pack of another type.
	if resp := doJSON(t, http.MethodPost, ts.URL, "/api/admin/dictionaries", admin, "not multipart"); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("POST non-multipart body: status = %d, want %d", resp.StatusCode, http.StatusBadRequest)
	}
	if resp := postPack(t, ts.URL, admin, "", nil); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("POST form without pack field: status = %d, want %d", resp.StatusCode, http.StatusBadRequest)
	}
	if resp := postPack(t, ts.URL, admin, "pack", []byte("this is not a zip")); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("POST non-zip upload: status = %d, want %d", resp.StatusCode, http.StatusBadRequest)
	}
	if resp := postPack(t, ts.URL, admin, "wrong", zipDirToBytes(t, dictFixture)); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("POST wrong field name: status = %d, want %d", resp.StatusCode, http.StatusBadRequest)
	}
	broken := buildPackDir(t,
		`{"id":"broken","name":"Broken","version":"1.0","type":"dictionary","language":"zh","attribution":"x","format":"json"}`,
		`{}`)
	if resp := postPack(t, ts.URL, admin, "pack", zipDirToBytes(t, broken)); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("POST manifest without license: status = %d, want %d", resp.StatusCode, http.StatusBadRequest)
	}
	levels := buildPackDir(t,
		`{"id":"hsk","name":"HSK mini","version":"1.0","type":"levels","language":"zh","license":"CC BY-SA 4.0","attribution":"Qinqin fixtures","format":"json"}`,
		`{}`)
	if resp := postPack(t, ts.URL, admin, "pack", zipDirToBytes(t, levels)); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("POST levels pack: status = %d, want %d", resp.StatusCode, http.StatusBadRequest)
	}

	// Install the fixture pack.
	resp := postPack(t, ts.URL, admin, "pack", zipDirToBytes(t, dictFixture))
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("POST fixture pack: status = %d, want %d", resp.StatusCode, http.StatusCreated)
	}
	var installed dictionaryBody
	decodeJSON(t, resp, &installed)
	if installed.ID == 0 || installed.Name != "Mkgloss demo dictionary" || installed.Version != "1.0" ||
		installed.License != "CC BY-SA 4.0" || installed.Attribution != "Qinqin test fixtures" {
		t.Errorf("installed dictionary = %+v, want the fixture pack's registry row", installed)
	}

	// The pack persists under <data>/packs/<id>-<version>/.
	if _, err := os.Stat(filepath.Join(dataDir, "packs", "mkgloss-1.0", "manifest.json")); err != nil {
		t.Errorf("installed pack files: %v (want manifest.json under packs/mkgloss-1.0/)", err)
	}

	// The registry lists it.
	if list := listDictionaries(t, ts.URL); len(list) != 1 || list[0] != installed {
		t.Errorf("GET /api/dictionaries = %+v, want [%+v]", list, installed)
	}

	// The imported entries are served, with derived readings.
	var nihaoID int64
	if err := sqlDB.QueryRow(`SELECT id FROM entries
		WHERE written = '你好' AND kind = 'word' AND language = 'zh'`).Scan(&nihaoID); err != nil {
		t.Fatalf("find imported 你好: %v", err)
	}
	entryResp := getEntry(t, ts.URL, "/api/entries/"+strconv.FormatInt(nihaoID, 10))
	if entryResp.StatusCode != http.StatusOK {
		t.Fatalf("GET imported entry: status = %d, want %d", entryResp.StatusCode, http.StatusOK)
	}
	var body entryBody
	decodeJSON(t, entryResp, &body)
	if bm := findReading(body.Entry, "bopomofo"); bm == nil || bm.Value != "ㄋㄧˇ ㄏㄠˇ" {
		t.Errorf("imported entry readings = %+v, want derived bopomofo ㄋㄧˇ ㄏㄠˇ", body.Readings)
	}

	// Re-installing the same pack replaces it: still one registry row.
	if resp := postPack(t, ts.URL, admin, "pack", zipDirToBytes(t, dictFixture)); resp.StatusCode != http.StatusCreated {
		t.Errorf("POST fixture pack again: status = %d, want %d", resp.StatusCode, http.StatusCreated)
	}
	if list := listDictionaries(t, ts.URL); len(list) != 1 {
		t.Errorf("GET /api/dictionaries after re-install = %+v, want one row", list)
	}

	// Uninstall: the dictionary and its senses are soft-deleted; the
	// entries survive.
	if resp := doJSON(t, http.MethodDelete, ts.URL,
		"/api/admin/dictionaries/"+strconv.FormatInt(installed.ID, 10), admin, nil); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("DELETE dictionary: status = %d, want %d", resp.StatusCode, http.StatusNoContent)
	}
	if list := listDictionaries(t, ts.URL); len(list) != 0 {
		t.Errorf("GET /api/dictionaries after uninstall = %+v, want empty", list)
	}
	var activeSenses int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM senses
		WHERE dictionary_id = ? AND deleted_at IS NULL`, installed.ID).Scan(&activeSenses); err != nil {
		t.Fatalf("count active senses: %v", err)
	}
	if activeSenses != 0 {
		t.Errorf("active senses after uninstall = %d, want 0", activeSenses)
	}
	if resp := getEntry(t, ts.URL, "/api/entries/"+strconv.FormatInt(nihaoID, 10)); resp.StatusCode != http.StatusOK {
		t.Errorf("GET entry after uninstall: status = %d, want %d — entries survive", resp.StatusCode, http.StatusOK)
	}

	// Unknown, malformed, and already-uninstalled ids are 404.
	for _, id := range []string{"999999", "NaN", strconv.FormatInt(installed.ID, 10)} {
		if resp := doJSON(t, http.MethodDelete, ts.URL, "/api/admin/dictionaries/"+id, admin, nil); resp.StatusCode != http.StatusNotFound {
			t.Errorf("DELETE %s: status = %d, want %d", id, resp.StatusCode, http.StatusNotFound)
		}
	}
}
