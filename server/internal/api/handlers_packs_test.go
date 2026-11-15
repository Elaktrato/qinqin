package api_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/dict"
	"qinqin/internal/packs"
)

const (
	packTestDict = `{"entries":[
 {"written":"hola","kind":"word","readings":[{"type":"latin","value":"hola"}],"glosses":["hello"]},
 {"written":"agua","kind":"word","readings":[{"type":"latin","value":"agua"}],"glosses":["water"]}]}`
	packTestDictManifest = `{"id":"es-test","name":"Spanish test","version":"1.0","type":"dictionary","language":"es","license":"CC0-1.0","attribution":"Qinqin test fixtures","format":"json","notice":"Hand-written."}`
	packTestSentManifest = `{"id":"es-sent","name":"Spanish sentences","version":"2.0","type":"sentences","language":"es","license":"CC BY-SA 4.0","attribution":"Qinqin test fixtures","format":"json"}`
	packTestSentences    = `{"entries":[{"word":"hola","sentences":[{"hanzi":"Hola, amigo.","pinyin":"hola","translation":"Hello, friend."}]}]}`
)

// installTestPacks imports an es dictionary and an es sentence pack
// through packs.Import.
func installTestPacks(t *testing.T, sqlDB *sql.DB) {
	t.Helper()
	d, err := dict.LoadPack(buildPackDir(t, packTestDictManifest, packTestDict))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := packs.Import(context.Background(), sqlDB, d); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), []byte(packTestSentManifest), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "sentences.json"), []byte(packTestSentences), 0o644); err != nil {
		t.Fatal(err)
	}
	s, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := packs.Import(context.Background(), sqlDB, s); err != nil {
		t.Fatal(err)
	}
}

func TestAdminPacksRequireAdmin(t *testing.T) {
	ts, _ := newServer(t)
	admin := registerUser(t, ts.URL, "admin", "")
	user := registerUser(t, ts.URL, "learner", admin)
	for _, tc := range []struct{ method, path string }{
		{http.MethodGet, "/api/admin/packs"},
		{http.MethodDelete, "/api/admin/packs/dictionary/es-test"},
	} {
		for name, token := range map[string]string{"anonymous": "", "non-admin": user} {
			resp := doJSON(t, tc.method, ts.URL, tc.path, token, nil)
			resp.Body.Close()
			if resp.StatusCode != http.StatusForbidden {
				t.Errorf("%s %s as %s = %d, want 403", tc.method, tc.path, name, resp.StatusCode)
			}
		}
	}
}

func TestAdminPackListAndUninstall(t *testing.T) {
	ts, sqlDB := newServer(t)
	admin := registerUser(t, ts.URL, "admin", "")
	installTestPacks(t, sqlDB)

	list := func() []packs.Installed {
		resp := doJSON(t, http.MethodGet, ts.URL, "/api/admin/packs", admin, nil)
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("list status = %d", resp.StatusCode)
		}
		var got []packs.Installed
		if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
			t.Fatal(err)
		}
		return got
	}
	got := list()
	if len(got) != 2 || got[0].Type != "dictionary" || got[1].Type != "sentences" {
		t.Fatalf("list = %+v", got)
	}
	d := got[0]
	if d.PackID != "es-test" || d.Name != "Spanish test" || d.Version != "1.0" || d.Language != "es" ||
		d.License != "CC0-1.0" || d.Attribution != "Qinqin test fixtures" || d.Notice != "Hand-written." || d.UpdatedAt == "" {
		t.Errorf("dictionary row = %+v", d)
	}
	if s := got[1]; s.PackID != "es-sent" || s.Version != "2.0" || s.License != "CC BY-SA 4.0" {
		t.Errorf("sentence row = %+v", s)
	}

	resp := doJSON(t, http.MethodDelete, ts.URL, "/api/admin/packs/dictionary/es-test", admin, nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete status = %d, want 204", resp.StatusCode)
	}
	if got := list(); len(got) != 1 || got[0].Type != "sentences" {
		t.Errorf("list after delete = %+v", got)
	}

	for _, tc := range []struct {
		path, msg string
	}{
		{"/api/admin/packs/dictionary/es-test", "pack not found"},
		{"/api/admin/packs/audio/x", "pack not found"},
		{"/api/admin/packs/bogus/x", "unknown pack type"},
	} {
		resp := doJSON(t, http.MethodDelete, ts.URL, tc.path, admin, nil)
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != http.StatusNotFound || !strings.Contains(string(body), tc.msg) {
			t.Errorf("DELETE %s = %d %q, want 404 %q", tc.path, resp.StatusCode, body, tc.msg)
		}
	}
}

func TestPublicSentencePacks(t *testing.T) {
	ts, sqlDB := newServer(t)
	installTestPacks(t, sqlDB)
	// A legacy sentence pack has sentences but no registry row.
	var entryID int64
	if err := sqlDB.QueryRow(`SELECT id FROM entries LIMIT 1`).Scan(&entryID); err != nil {
		t.Fatal(err)
	}
	if _, err := sqlDB.Exec(`INSERT INTO sentences (entry_id, source_pack, user_id, hanzi, pinyin, translation, updated_at) VALUES (?, 'legacy', NULL, 'a', 'b', 'c', 't')`, entryID); err != nil {
		t.Fatal(err)
	}
	resp := doJSON(t, http.MethodGet, ts.URL, "/api/sentence-packs", "", nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200 without a token", resp.StatusCode)
	}
	var got []map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 {
		t.Fatalf("list = %+v, want only the registered pack", got)
	}
	want := map[string]string{"packId": "es-sent", "name": "Spanish sentences", "version": "2.0", "language": "es",
		"license": "CC BY-SA 4.0", "attribution": "Qinqin test fixtures", "notice": ""}
	for k, v := range want {
		if got[0][k] != v {
			t.Errorf("%s = %q, want %q", k, got[0][k], v)
		}
	}
}

func TestPublicSentencePacksEmptyIsArray(t *testing.T) {
	ts, _ := newServer(t)
	resp := doJSON(t, http.MethodGet, ts.URL, "/api/sentence-packs", "", nil)
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if strings.TrimSpace(string(body)) != "[]" {
		t.Errorf("empty list body = %q, want []", body)
	}
}

// Audio packs are listed and uninstalled through the same admin routes (the
// Data tab), and the uninstall frees their blobs under <data>/audio.
func TestAdminAudioPackListAndUninstall(t *testing.T) {
	ts, sqlDB, dataDir := newServerWithDir(t)
	admin := registerUser(t, ts.URL, "admin", "")
	store := filepath.Join(dataDir, "audio")
	pdir := t.TempDir()
	for name, body := range map[string]string{
		"manifest.json": `{"id":"audio-test","name":"Audio test","version":"1","type":"audio","language":"ja","license":"CC0","attribution":"Tester","format":"audio-index"}`,
		"index.tsv":     "kind\tform\treading\tfile\tlicense\tattribution\tsource\nterm\t風\tかぜ\taudio/a.opus\t\t\t\n",
		"audio/a.opus":  "OggS-one",
	} {
		p := filepath.Join(pdir, name)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	pack, err := dict.LoadPack(pdir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := packs.Import(context.Background(), sqlDB, pack, packs.WithAudioStore(store)); err != nil {
		t.Fatal(err)
	}

	resp := doJSON(t, http.MethodGet, ts.URL, "/api/admin/packs", admin, nil)
	var got []packs.Installed
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil || len(got) != 1 || got[0].Type != "audio" || got[0].PackID != "audio-test" {
		t.Fatalf("list = %+v, %v", got, err)
	}
	resp = doJSON(t, http.MethodDelete, ts.URL, "/api/admin/packs/audio/audio-test", admin, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete = %d", resp.StatusCode)
	}
	if entries, _ := os.ReadDir(store); countFiles(store) != 0 {
		t.Errorf("blobs left under %s: %v", store, entries)
	}
}

func countFiles(root string) int {
	n := 0
	_ = filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			n++
		}
		return nil
	})
	return n
}
