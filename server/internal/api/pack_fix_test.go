package api_test

import (
	"archive/zip"
	"bytes"
	"context"
	"database/sql"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"qinqin/internal/api"
	"qinqin/internal/pack"
	"qinqin/internal/packs"
)

// Finished and failed imports must not occupy stage slots.
func TestFourSequentialInstallsSucceed(t *testing.T) {
	e := newPackEnv(t)
	for i := 0; i < 4; i++ {
		s := stageZip(t, e, esPackZip(t, packTestDictManifest))
		if code, txt := e.install(t, s.Token, "CC0-1.0"); code != http.StatusAccepted {
			t.Fatalf("install %d: %d %s", i, code, txt)
		}
		e.waitDone(t, 1)
	}
	// A failed import frees its slot too.
	for i := 0; i < 4; i++ {
		s := stageZip(t, e, zipDirToBytes(t, buildPackDir(t, packTestDictManifest, `{bad`)))
		e.install(t, s.Token, "CC0-1.0")
		e.waitDone(t, 1)
	}
	stageZip(t, e, esPackZip(t, packTestDictManifest))
}

func installZip(t *testing.T, e *packEnv, z []byte, lic string) {
	t.Helper()
	s := stageZip(t, e, z)
	if code, txt := e.install(t, s.Token, lic); code != http.StatusAccepted {
		t.Fatalf("install: %d %s", code, txt)
	}
	e.waitDone(t, 1)
	if _, b := e.status(t, s.Token); b.Status != "done" {
		t.Fatalf("status = %+v", b)
	}
}

func TestPackDirsDoNotCollide(t *testing.T) {
	e := newPackEnv(t)
	a := `{"id":"es-test","name":"A","version":"1.0","type":"dictionary","language":"es","license":"CC0-1.0","attribution":"x","format":"json"}`
	b := `{"id":"es","name":"B","version":"test-1.0","type":"dictionary","language":"es","license":"CC0-1.0","attribution":"x","format":"json"}`
	installZip(t, e, esPackZip(t, a), "CC0-1.0")
	var marker string
	if err := filepath.WalkDir(filepath.Join(e.dataDir, "packs"), func(p string, d os.DirEntry, err error) error {
		if err == nil && d.Name() == "manifest.json" {
			marker = filepath.Join(filepath.Dir(p), "MARKER")
		}
		return nil
	}); err != nil || marker == "" {
		t.Fatalf("no installed pack dir: %v", err)
	}
	os.WriteFile(marker, []byte("a"), 0o644)
	installZip(t, e, esPackZip(t, b), "CC0-1.0")
	if _, err := os.Stat(marker); err != nil {
		t.Errorf("installing B replaced A's directory: %v", err)
	}

	// Same id and version, different types.
	mk := func(typ, format, file, data string) []byte {
		dir := t.TempDir()
		os.WriteFile(filepath.Join(dir, "manifest.json"), []byte(`{"id":"x","name":"X","version":"1","type":"`+typ+`","language":"es","license":"MIT","attribution":"a","format":"`+format+`"}`), 0o644)
		os.WriteFile(filepath.Join(dir, file), []byte(data), 0o644)
		return zipDirToBytes(t, dir)
	}
	installZip(t, e, mk("frequency", "freq-csv", "freq.csv", "term,reading,rank\nhola,,1\n"), "MIT")
	installZip(t, e, mk("levels", "json", "levels.json", `{"unit":"word","levels":[{"name":"1","entries":["hola"]}]}`), "MIT")
	for _, typ := range []string{"frequency", "levels"} {
		if _, err := os.Stat(filepath.Join(e.dataDir, "packs", typ, "x", "1", "manifest.json")); err != nil {
			t.Errorf("%s pack dir missing: %v", typ, err)
		}
	}
}

func TestInstallPanicIsRecovered(t *testing.T) {
	var calls int
	done := make(chan string, 4)
	e := newPackEnvWith(t, done, api.WithImporter(func(ctx context.Context, db *sql.DB, p pack.Pack) (string, error) {
		calls++
		if calls == 1 {
			panic("boom")
		}
		return packs.Import(ctx, db, p)
	}))
	s := stageZip(t, e, esPackZip(t, packTestDictManifest))
	if code, _ := e.install(t, s.Token, "CC0-1.0"); code != http.StatusAccepted {
		t.Fatal(code)
	}
	e.waitDone(t, 1)
	_, b := e.status(t, s.Token)
	if b.Status != "failed" || !strings.Contains(b.Error, "import failed") || strings.Contains(b.Error, "boom") {
		t.Errorf("status = %+v", b)
	}
	if d := stageDirs(t, e.dataDir); len(d) != 0 {
		t.Errorf("stage dirs left: %v", d)
	}
	// The pack mutex was released: the next install works.
	installZip(t, e, esPackZip(t, packTestDictManifest), "CC0-1.0")
}

func TestInstallWarnsWhenFilesCannotBeMoved(t *testing.T) {
	e := newPackEnv(t)
	// A plain file where the type directory belongs makes the move fail.
	os.MkdirAll(filepath.Join(e.dataDir, "packs"), 0o755)
	os.WriteFile(filepath.Join(e.dataDir, "packs", "dictionary"), []byte("in the way"), 0o644)
	s := stageZip(t, e, esPackZip(t, packTestDictManifest))
	e.install(t, s.Token, "CC0-1.0")
	e.waitDone(t, 1)
	_, b := e.status(t, s.Token)
	if b.Status != "done" || !strings.Contains(b.Warning, "could not be moved") || b.Pack == nil {
		t.Errorf("status = %+v, want done with a files warning", b)
	}
	list, _ := packs.List(context.Background(), e.db)
	if len(list) != 1 {
		t.Errorf("the committed import must stay listed: %+v", list)
	}
}

func TestFailedMoveKeepsOldFiles(t *testing.T) {
	e := newPackEnv(t)
	installZip(t, e, esPackZip(t, packTestDictManifest), "CC0-1.0")
	old := filepath.Join(e.dataDir, "packs", "dictionary", "es-test", "1.0")
	os.WriteFile(filepath.Join(old, "MARKER"), []byte("old"), 0o644)
	installZip(t, e, esPackZip(t, packTestDictManifest), "CC0-1.0")
	if _, err := os.Stat(filepath.Join(old, "manifest.json")); err != nil {
		t.Errorf("replacement lost the pack files: %v", err)
	}
	entries, _ := os.ReadDir(filepath.Dir(old))
	if len(entries) != 1 {
		t.Errorf("leftover aside dirs: %v", entries)
	}
}

func TestKanjidic2UsesRegistryTerms(t *testing.T) {
	e := newPackEnv(t)
	xml, err := os.ReadFile("../dict/testdata/kanjidic2-sample.xml")
	if err != nil {
		t.Fatal(err)
	}
	mk := func(id string) []byte {
		dir := t.TempDir()
		os.WriteFile(filepath.Join(dir, "manifest.json"), []byte(`{"id":"`+id+`","name":"KD","version":"1","type":"dictionary","language":"ja","license":"Whatever the manifest says","attribution":"Mine","format":"kanjidic2"}`), 0o644)
		os.WriteFile(filepath.Join(dir, "kanjidic2.xml"), xml, 0o644)
		return zipDirToBytes(t, dir)
	}
	s := stageZip(t, e, mk("my-kanji"))
	if s.Manifest.License != "CC BY-SA 4.0" {
		t.Errorf("staged licence = %q, want the one that will be stored", s.Manifest.License)
	}
	if code, _ := e.install(t, s.Token, "Whatever the manifest says"); code != http.StatusConflict {
		t.Errorf("echoing the manifest's licence = %d, want 409", code)
	}
	if code, txt := e.install(t, s.Token, "CC BY-SA 4.0"); code != http.StatusAccepted {
		t.Fatalf("install = %d %s", code, txt)
	}
	e.waitDone(t, 1)
	_, b := e.status(t, s.Token)
	if b.Status != "done" || b.Pack == nil || b.Pack.PackID != "kanjidic2" {
		t.Fatalf("status = %+v", b)
	}
	// A second pack under another id replaces the stored "kanjidic2".
	s2 := stageZip(t, e, mk("other-kanji"))
	if s2.Replaces == nil || s2.Replaces.License != "CC BY-SA 4.0" {
		t.Errorf("replaces = %+v", s2.Replaces)
	}
}

// The upload slot is reserved before the body is read.
func TestConcurrentUploadsReserveSlots(t *testing.T) {
	e := newPackEnv(t)
	dial := func() net.Conn {
		conn, err := net.Dial("tcp", strings.TrimPrefix(e.ts.URL, "http://"))
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { conn.Close() })
		// Headers promise a large body; only its first bytes ever arrive.
		fmt.Fprintf(conn, "POST /api/admin/packs HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer %s\r\n"+
			"Content-Type: multipart/form-data; boundary=B\r\nContent-Length: 100000\r\n\r\n"+
			"--B\r\nContent-Disposition: form-data; name=\"pack\"; filename=\"p.zip\"\r\n\r\nPK", e.admin)
		return conn
	}
	conns := []net.Conn{dial(), dial(), dial()}
	deadline := time.Now().Add(30 * time.Second)
	for {
		// A connection that already got an answer was refused (429): its
		// slot was taken by an upload of ours below, so hold another.
		for i, c := range conns {
			c.SetReadDeadline(time.Now().Add(100 * time.Millisecond))
			if n, _ := c.Read(make([]byte, 1)); n > 0 {
				c.Close()
				conns[i] = dial()
			}
		}
		time.Sleep(200 * time.Millisecond)
		resp := uploadZip(t, e, e.admin, esPackZip(t, packTestDictManifest))
		if resp.StatusCode == http.StatusTooManyRequests {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("4th upload while 3 are in flight: %d", resp.StatusCode)
		}
		e.discardAll(t)
	}
}

func (e *packEnv) discardAll(t *testing.T) {
	t.Helper()
	entries, _ := os.ReadDir(filepath.Join(e.dataDir, "packs"))
	for _, en := range entries {
		if strings.HasPrefix(en.Name(), ".stage-") && en.IsDir() {
			resp := doJSON(t, http.MethodDelete, e.ts.URL, "/api/admin/packs/staged/"+strings.TrimPrefix(en.Name(), ".stage-"), e.admin, nil)
			resp.Body.Close()
		}
	}
}

func TestStageSweeperRemovesExpiredStages(t *testing.T) {
	e := newPackEnv(t, api.WithStageSweeper(context.Background(), 10*time.Millisecond))
	s := stageZip(t, e, esPackZip(t, packTestDictManifest))
	dir := filepath.Join(e.dataDir, "packs", ".stage-"+s.Token)
	e.advance(31 * time.Minute)
	deadline := time.Now().Add(5 * time.Second)
	for {
		if _, err := os.Stat(dir); os.IsNotExist(err) {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("expired stage dir was not removed by the sweeper")
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestMacOSZipUnwrapsAndSkipsMetadata(t *testing.T) {
	e := newPackEnv(t)
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	add := func(name, body string) {
		w, _ := zw.Create(name)
		w.Write([]byte(body))
	}
	add("es-test/", "")
	add("es-test/manifest.json", packTestDictManifest)
	add("es-test/dictionary.json", packTestDict)
	add("es-test/.DS_Store", "x")
	add("__MACOSX/es-test/._manifest.json", "x")
	add(".DS_Store", "x")
	zw.Close()
	s := stageZip(t, e, buf.Bytes())
	if s.Manifest.ID != "es-test" || s.Files != 2 {
		t.Errorf("stage = %+v, want 2 files and the unwrapped manifest", s)
	}
}

func TestStageRejectsUnsupportedTypeWithClientError(t *testing.T) {
	e := newPackEnv(t)
	m := strings.Replace(packTestDictManifest, `"type":"dictionary"`, `"type":"audio"`, 1)
	resp := uploadZip(t, e, e.admin, esPackZip(t, m))
	text := bodyText(resp)
	if resp.StatusCode != http.StatusBadRequest && resp.StatusCode != http.StatusUnprocessableEntity {
		t.Errorf("audio manifest = %d %q, want a 4xx", resp.StatusCode, text)
	}
	// Audio packs are managed (listed, uninstalled) but never installable by upload.
	if packs.Installable("audio") || !packs.Supported("audio") || packs.Supported("bogus") || !packs.Installable("dictionary") || !packs.Installable("grammar") {
		t.Error("packs.Supported / Installable disagree with the managed types")
	}
}
