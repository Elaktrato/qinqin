package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"qinqin/internal/db"
)

func tarList(t *testing.T, data []byte) map[string][]byte {
	t.Helper()
	zr, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	tr := tar.NewReader(zr)
	out := map[string][]byte{}
	for {
		h, err := tr.Next()
		if err == io.EOF {
			return out
		}
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(tr)
		out[h.Name] = b
	}
}

func dataDirWithBooks(t *testing.T) (string, func()) {
	dir := t.TempDir()
	sqlDB, err := db.Open(filepath.Join(dir, "qinqin.db"))
	if err != nil {
		t.Fatal(err)
	}
	os.MkdirAll(filepath.Join(dir, "books", "1"), 0o755)
	os.WriteFile(filepath.Join(dir, "books", "1", "1.json"), []byte("[]"), 0o644)
	os.MkdirAll(filepath.Join(dir, "journal", "1"), 0o755)
	os.WriteFile(filepath.Join(dir, "journal", "1", "p"), []byte("x"), 0o644)
	_ = sqlDB
	return dir, func() { sqlDB.Close() }
}

func TestBackupWritesTheServerLayoutToAFileAndToStdout(t *testing.T) {
	dir, closeDB := dataDirWithBooks(t)
	defer closeDB()
	outFile := filepath.Join(t.TempDir(), "x.tar.gz")
	var stderr bytes.Buffer
	if err := backupCmd([]string{"--data", dir, "--out", outFile}, io.Discard, &stderr); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(outFile)
	files := tarList(t, b)
	if files["BACKUP-INFO.json"] == nil || files["qinqin.db"] == nil || files["books/1/1.json"] == nil || files["journal/1/p"] != nil {
		t.Errorf("entries %v", files)
	}
	if st, _ := os.Stat(outFile); st.Mode().Perm() != 0o600 {
		t.Errorf("mode %v", st.Mode())
	}
	var stdout bytes.Buffer
	if err := backupCmd([]string{"--data", dir, "--out", "-"}, &stdout, io.Discard); err != nil {
		t.Fatal(err)
	}
	if got := tarList(t, stdout.Bytes()); got["qinqin.db"] == nil {
		t.Errorf("stdout archive %v", got)
	}
	// --only narrows
	if err := backupCmd([]string{"--data", dir, "--out", outFile, "--only", "books"}, io.Discard, io.Discard); err != nil {
		t.Fatal(err)
	}
	b, _ = os.ReadFile(outFile)
	if got := tarList(t, b); got["qinqin.db"] != nil || got["books/1/1.json"] == nil {
		t.Errorf("--only books: %v", got)
	}
	if m, _ := filepath.Glob(filepath.Join(filepath.Dir(outFile), ".qinqin-backup-*")); len(m) != 0 {
		t.Errorf("temp files left: %v", m)
	}
}

func TestBackupUsageErrors(t *testing.T) {
	dir, closeDB := dataDirWithBooks(t)
	defer closeDB()
	if err := backupCmd([]string{"--data", dir}, io.Discard, io.Discard); !errors.Is(err, errUsage) {
		t.Errorf("no --out: %v", err)
	}
	if err := backupCmd([]string{"--data", dir, "--out", "-", "--only", "secrets"}, io.Discard, io.Discard); !errors.Is(err, errUsage) {
		t.Errorf("bad --only: %v", err)
	}
	if err := backupCmd([]string{"--data", filepath.Join(t.TempDir(), "nope"), "--out", "-"}, io.Discard, io.Discard); err == nil {
		t.Error("a missing database must be an error")
	}
	if _, err := os.Stat(filepath.Join(dir, "nope")); err == nil {
		t.Error("created something")
	}
}

func TestBackupNeverMigrates(t *testing.T) {
	dir, closeDB := dataDirWithBooks(t)
	// an older database: the newest migration never ran
	sqlDB, _ := db.Open(filepath.Join(dir, "qinqin.db"))
	sqlDB.Exec(`DROP TABLE user_time_zones`)
	sqlDB.Exec(`DELETE FROM schema_migrations WHERE version = '035_user_time_zones'`)
	sqlDB.Close()
	closeDB()
	if err := backupCmd([]string{"--data", dir, "--out", filepath.Join(t.TempDir(), "o.tar.gz")}, io.Discard, io.Discard); err != nil {
		t.Fatal(err)
	}
	ro, err := db.OpenReadOnly(filepath.Join(dir, "qinqin.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer ro.Close()
	var n int
	ro.QueryRow(`SELECT COUNT(*) FROM schema_migrations WHERE version = '035_user_time_zones'`).Scan(&n)
	var tbl int
	ro.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE name = 'user_time_zones'`).Scan(&tbl)
	if n != 0 || tbl != 0 {
		t.Errorf("the backup migrated the database (migration rows %d, table %d)", n, tbl)
	}
}

func TestBackupBesideARunningServerIsConsistent(t *testing.T) {
	dir, closeDB := dataDirWithBooks(t)
	defer closeDB()
	live, err := db.Open(filepath.Join(dir, "qinqin.db")) // "the server": WAL, a writer running
	if err != nil {
		t.Fatal(err)
	}
	defer live.Close()
	stop := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; ; i++ {
			select {
			case <-stop:
				return
			default:
			}
			live.Exec(`INSERT OR IGNORE INTO languages (code, name, updated_at) VALUES (?, 'x', 't')`, "l"+string(rune('a'+i%26))+string(rune('a'+i/26%26))+string(rune('a'+i/676%26)))
		}
	}()
	var stdout bytes.Buffer
	err = backupCmd([]string{"--data", dir, "--out", "-", "--only", "db"}, &stdout, io.Discard)
	close(stop)
	wg.Wait()
	if err != nil {
		t.Fatal(err)
	}
	files := tarList(t, stdout.Bytes())
	p := filepath.Join(t.TempDir(), "c.db")
	os.WriteFile(p, files["qinqin.db"], 0o600)
	c, err := db.OpenReadOnly(p)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	var ic string
	c.QueryRow(`PRAGMA integrity_check`).Scan(&ic)
	if ic != "ok" {
		t.Errorf("integrity_check = %q", ic)
	}
}
