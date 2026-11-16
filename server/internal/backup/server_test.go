package backup

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

func untar(t *testing.T, data []byte) (map[string][]byte, []string) {
	t.Helper()
	zr, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	tr := tar.NewReader(zr)
	out := map[string][]byte{}
	var order []string
	for {
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(tr)
		out[h.Name] = b
		order = append(order, h.Name)
	}
	return out, order
}

func writeFileAt(t *testing.T, root string, rel string, content string) {
	p := filepath.Join(root, filepath.FromSlash(rel))
	os.MkdirAll(filepath.Dir(p), 0o755)
	os.WriteFile(p, []byte(content), 0o644)
}

func TestWriteServerContentsAndExclusions(t *testing.T) {
	w := newWorld(t)
	// the world's DB lives elsewhere; give the data dir the layout of a server
	for rel, c := range map[string]string{
		"books/1/1.json": "[]", "books/1/.restore-abc/9.json": "STAGING", "packs/p/manifest.json": "{}", "packs/.stage-x/m.json": "STAGE",
		"audio/aa/clip.mp3": "AUDIO", "journal/1/photo": "PHOTO", "cache/sources/x": "CACHE", "tmp/restore/z.zip": "TMP",
		"backups/pre-restore/1/a.zip": "SAFETY", "qinqin.db-wal": "",
	} {
		writeFileAt(t, w.Data, rel, c)
	}
	os.Symlink("/etc/passwd", filepath.Join(w.Data, "books", "link"))
	t.Setenv("QINQIN_SECRET", "SUPER-SECRET-VALUE-0123456789")
	var buf bytes.Buffer
	if err := WriteServer(context.Background(), w.DB, w.Data, AllIncluded, &buf, testMeta); err != nil {
		t.Fatal(err)
	}
	files, order := untar(t, buf.Bytes())
	if order[len(order)-1] != "BACKUP-INFO.json" {
		t.Errorf("order %v", order)
	}
	for _, want := range []string{"qinqin.db", "books/1/1.json", "packs/p/manifest.json", "audio/aa/clip.mp3"} {
		if files[want] == nil {
			t.Errorf("%s missing from %v", want, order)
		}
	}
	for name := range files {
		for _, bad := range []string{"journal/", "cache/", "tmp/", "backups/", ".restore-", ".stage-", "link"} {
			if strings.Contains(name, bad) {
				t.Errorf("%s must not be in a server backup", name)
			}
		}
	}
	var info ServerInfo
	if err := json.Unmarshal(files["BACKUP-INFO.json"], &info); err != nil || info.Format != ServerFormat || len(info.Files) != len(files)-1 {
		t.Fatalf("info %+v %v", info, err)
	}
	for _, f := range info.Files {
		sum := sha256.Sum256(files[f.Name])
		if hex.EncodeToString(sum[:]) != f.SHA256 || f.Bytes != int64(len(files[f.Name])) {
			t.Errorf("%s: sha or size differs", f.Name)
		}
	}
	if bytes.Contains(buf.Bytes(), []byte("SUPER-SECRET-VALUE")) || bytes.Contains(files["qinqin.db"], []byte("SUPER-SECRET-VALUE")) {
		t.Error("QINQIN_SECRET is in the archive")
	}
	// the database opens and is intact
	p := filepath.Join(t.TempDir(), "copy.db")
	os.WriteFile(p, files["qinqin.db"], 0o600)
	c, err := sql.Open("sqlite", p)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	var ic string
	c.QueryRow(`PRAGMA integrity_check`).Scan(&ic)
	var n int
	c.QueryRow(`SELECT COUNT(*) FROM study_events`).Scan(&n)
	if ic != "ok" || n != 8 {
		t.Errorf("integrity %q, events %d", ic, n)
	}
	// the temp snapshot is gone
	if m, _ := filepath.Glob(filepath.Join(w.Data, "tmp", "backup-*")); len(m) != 0 {
		t.Errorf("snapshot files left: %v", m)
	}
}

func TestWriteServerSnapshotIsConsistentAndIncludeNarrows(t *testing.T) {
	w := newWorld(t)
	writeFileAt(t, w.Data, "books/1/1.json", "[]")
	afterSnapshot = func() {
		// a write that lands after the snapshot must not be in it
		exec(t, w.DB, `INSERT INTO languages (code, name, updated_at) VALUES ('late', 'late', 't')`)
	}
	t.Cleanup(func() { afterSnapshot = func() {} })
	exec(t, w.DB, `INSERT INTO languages (code, name, updated_at) VALUES ('early', 'early', 't')`)
	var buf bytes.Buffer
	if err := WriteServer(context.Background(), w.DB, w.Data, Include{DB: true}, &buf, testMeta); err != nil {
		t.Fatal(err)
	}
	files, order := untar(t, buf.Bytes())
	if len(order) != 2 || files["books/1/1.json"] != nil {
		t.Errorf("include db only: %v", order)
	}
	p := filepath.Join(t.TempDir(), "c.db")
	os.WriteFile(p, files["qinqin.db"], 0o600)
	c, _ := sql.Open("sqlite", p)
	defer c.Close()
	var early, late int
	c.QueryRow(`SELECT COUNT(*) FROM languages WHERE code = 'early'`).Scan(&early)
	c.QueryRow(`SELECT COUNT(*) FROM languages WHERE code = 'late'`).Scan(&late)
	if early != 1 || late != 0 {
		t.Errorf("early %d late %d", early, late)
	}
}

type failWriter struct{ n int }

func (f *failWriter) Write(p []byte) (int, error) {
	f.n += len(p)
	if f.n > 200 {
		return 0, errors.New("client went away")
	}
	return len(p), nil
}

func TestWriteServerRemovesTheSnapshotOnErrorAndCancel(t *testing.T) {
	w := newWorld(t)
	writeFileAt(t, w.Data, "audio/big.bin", strings.Repeat("x", 1<<20))
	if err := WriteServer(context.Background(), w.DB, w.Data, AllIncluded, &failWriter{}, testMeta); err == nil {
		t.Error("a failing writer did not fail the backup")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := WriteServer(ctx, w.DB, w.Data, AllIncluded, io.Discard, testMeta); err == nil {
		t.Error("a cancelled context did not stop the backup")
	}
	if m, _ := filepath.Glob(filepath.Join(w.Data, "tmp", "backup-*")); len(m) != 0 {
		t.Errorf("snapshot files left: %v", m)
	}
}

func TestCheckSpace(t *testing.T) {
	w := newWorld(t)
	old := freeBytes
	t.Cleanup(func() { freeBytes = old })
	freeBytes = func(string) (uint64, error) { return 1 << 20, nil }
	if err := CheckSpace(w.Data, 0); !errors.Is(err, ErrInsufficientStorage) {
		t.Errorf("low space: %v", err)
	}
	freeBytes = func(string) (uint64, error) { return 10 << 30, nil }
	if err := CheckSpace(w.Data, 0); err != nil {
		t.Errorf("plenty: %v", err)
	}
	if _, err := ParseInclude([]string{"db", "secrets"}); err == nil {
		t.Error("an unknown part was accepted")
	}
	if inc, _ := ParseInclude(nil); inc != AllIncluded {
		t.Error("empty include is all")
	}
}

func TestCheckSpaceCountsTheOutputArchive(t *testing.T) {
	w := newWorld(t)
	old := freeBytes
	t.Cleanup(func() { freeBytes = old })
	freeBytes = func(string) (uint64, error) { return 100 << 20, nil }
	if err := CheckSpace(w.Data, 0); err != nil {
		t.Fatalf("snapshot alone: %v", err)
	}
	if err := CheckSpace(w.Data, 200<<20); !errors.Is(err, ErrInsufficientStorage) {
		t.Errorf("snapshot plus a 200 MiB archive on the same volume: %v", err)
	}
	clean := t.TempDir()
	writeFileAt(t, clean, "books/1/1.json", strings.Repeat("x", 1000))
	writeFileAt(t, clean, "audio/a.bin", strings.Repeat("y", 500))
	if got := EstimateServerBytes(clean, Include{Books: true, Audio: true}); got != 1500 {
		t.Errorf("estimate %d, want 1500", got)
	}
	if got := EstimateServerBytes(clean, Include{Books: true}); got != 1000 {
		t.Errorf("estimate %d, want 1000", got)
	}
}
