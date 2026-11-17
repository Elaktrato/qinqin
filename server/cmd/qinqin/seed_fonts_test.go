package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/dict"
	"qinqin/internal/fonts"
)

// `qinqin seed` installs a font pack found in a pack root; its slices go
// to <data>/fonts.
func TestSeedImportsFontPack(t *testing.T) {
	sqlDB, _ := openTestDB(t)
	root, data := t.TempDir(), t.TempDir()
	dir := filepath.Join(root, "font-test")
	slice := []byte("wOF2\x00\x01\x00\x00seed")
	sum := sha256.Sum256(slice)
	sha := hex.EncodeToString(sum[:])
	for name, body := range map[string]string{
		"manifest.json": `{"id":"font-test","name":"Font test","version":"1","type":"font","license":"OFL-1.1","attribution":"Tester","format":"font-slices"}`,
		"faces.json": `{"version":1,"faces":[{"face":"serif","script":"Hant","original":"Test Serif","weight":"400","style":"normal",
			"slices":[{"file":"slices/` + sha + `.woff2","unicodeRange":"U+4E00-9FFF"}]}]}`,
		"slices/" + sha + ".woff2": string(slice),
	} {
		path := filepath.Join(dir, filepath.FromSlash(name))
		os.MkdirAll(filepath.Dir(path), 0o755)
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	var out strings.Builder
	if err := seed(context.Background(), sqlDB, data, []string{root}, &out); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if !regexpLine(out.String(), `^font-test\s+font\s+1 faces, 1 slices$`) {
		t.Errorf("seed output = %q", out.String())
	}
	if _, err := os.Stat(fonts.BlobPath(filepath.Join(data, "fonts"), sha)); err != nil {
		t.Errorf("slice not under <data>/fonts: %v", err)
	}
	if importOrder[dict.TypeFont] <= importOrder[dict.TypeSentences] {
		t.Errorf("importOrder[font] = %d, want after sentences", importOrder[dict.TypeFont])
	}
}
