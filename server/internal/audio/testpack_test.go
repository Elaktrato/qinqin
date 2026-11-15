package audio_test

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/db"
	"qinqin/internal/dict"
)

// Synthetic clips: valid magic bytes plus a distinguishing tail. They are
// generated here, never committed.
func oggClip(tag string) []byte { return append([]byte("OggS\x00\x02"), []byte(tag)...) }
func mp3Clip(tag string) []byte { return append([]byte("ID3\x04\x00"), []byte(tag)...) }

type clipFile struct {
	name string // under audio/
	data []byte
}

// makePack writes a pack directory and loads it.
func makePack(t *testing.T, id, language, license string, index []string, files []clipFile) dict.Pack {
	t.Helper()
	dir := t.TempDir()
	manifest := fmt.Sprintf(`{"id":%q,"name":"Test %s","version":"1","type":"audio","language":%q,"license":%q,"attribution":"Tester","format":"audio-index"}`,
		id, id, language, license)
	write(t, filepath.Join(dir, "manifest.json"), []byte(manifest))
	write(t, filepath.Join(dir, "index.tsv"), []byte("kind\tform\treading\tfile\tlicense\tattribution\tsource\n"+strings.Join(index, "\n")+"\n"))
	for _, f := range files {
		write(t, filepath.Join(dir, "audio", f.name), f.data)
	}
	p, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func write(t *testing.T, path string, data []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
}

func newDB(t *testing.T) *sql.DB {
	t.Helper()
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	return sqlDB
}

// blobs lists every file under the store.
func blobs(t *testing.T, store string) []string {
	t.Helper()
	var out []string
	_ = filepath.WalkDir(store, func(p string, d os.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			out = append(out, p)
		}
		return nil
	})
	return out
}
