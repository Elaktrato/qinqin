package fonts_test

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"testing"

	"qinqin/internal/db"
	"qinqin/internal/dict"
)

// Synthetic slices: the WOFF2 magic plus a distinguishing tail. They are
// generated here, never committed; the store checks the magic, the size
// and the hash, never the font inside.
func woff2(tag string) []byte { return append([]byte("wOF2\x00\x01\x00\x00"), []byte(tag)...) }

func shaOf(b []byte) string {
	s := sha256.Sum256(b)
	return hex.EncodeToString(s[:])
}

type sliceSpec struct {
	data  []byte
	rng   string
	write func(path string, data []byte) // nil: a regular file
}

type faceSpec struct {
	face, script, weight string
	slices               []sliceSpec
}

// writePack writes a font pack directory with the given faces and loads it.
func writePack(t *testing.T, id string, faces ...faceSpec) dict.Pack {
	t.Helper()
	dir := t.TempDir()
	manifest := fmt.Sprintf(`{"id":%q,"name":"Test %s","version":"1","type":"font","license":"OFL-1.1",
		"attribution":"Test faces","notice":"modified","format":"font-slices"}`, id, id)
	write(t, filepath.Join(dir, "manifest.json"), []byte(manifest))
	write(t, filepath.Join(dir, "LICENSE"), []byte("SIL OPEN FONT LICENSE Version 1.1 (test stand-in)\n"))
	type sl struct {
		File         string `json:"file"`
		UnicodeRange string `json:"unicodeRange"`
	}
	type fc struct {
		Face     string `json:"face"`
		Script   string `json:"script"`
		Original string `json:"original"`
		Weight   string `json:"weight"`
		Style    string `json:"style"`
		Slices   []sl   `json:"slices"`
	}
	doc := struct {
		Version int  `json:"version"`
		Faces   []fc `json:"faces"`
	}{Version: 1}
	for _, f := range faces {
		out := fc{Face: f.face, Script: f.script, Original: "Test " + f.face, Weight: f.weight, Style: "normal"}
		for _, s := range f.slices {
			name := "slices/" + shaOf(s.data) + ".woff2"
			path := filepath.Join(dir, filepath.FromSlash(name))
			if s.write != nil {
				os.MkdirAll(filepath.Dir(path), 0o755)
				s.write(path, s.data)
			} else {
				write(t, path, s.data)
			}
			out.Slices = append(out.Slices, sl{name, s.rng})
		}
		doc.Faces = append(doc.Faces, out)
	}
	raw, _ := json.Marshal(doc)
	write(t, filepath.Join(dir, "faces.json"), raw)
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

// blobs lists every file under the store, relative and sorted.
func blobs(t *testing.T, store string) []string {
	t.Helper()
	var out []string
	_ = filepath.WalkDir(store, func(p string, d os.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			rel, _ := filepath.Rel(store, p)
			out = append(out, filepath.ToSlash(rel))
		}
		return nil
	})
	sort.Strings(out)
	return out
}

func blobName(data []byte) string {
	sha := shaOf(data)
	return sha[:2] + "/" + sha + ".woff2"
}
