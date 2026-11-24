package packs_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/pack"
	"qinqin/internal/packs"
)

// fontPack writes a one-face, one-slice font pack (a synthetic WOFF2).
func fontPack(t *testing.T) (pack.Pack, string) {
	t.Helper()
	dir := t.TempDir()
	slice := []byte("wOF2\x00\x01\x00\x00test")
	sum := sha256.Sum256(slice)
	sha := hex.EncodeToString(sum[:])
	files := map[string]string{
		"manifest.json": `{"id":"test-font","name":"Test font","version":"1.0","type":"font","license":"OFL-1.1",
			"attribution":"Qinqin test fixtures","format":"font-slices"}`,
		"faces.json": `{"version":1,"faces":[{"face":"sans","script":"Hans","original":"Test Sans","weight":"400","style":"normal",
			"slices":[{"file":"slices/` + sha + `.woff2","unicodeRange":"U+4E00-9FFF"}]}]}`,
		"LICENSE":                  "SIL OPEN FONT LICENSE Version 1.1 (test stand-in)\n",
		"ATTRIBUTION.md":           "Test Sans, modified (subset, renamed)\n",
		"slices/" + sha + ".woff2": string(slice),
	}
	for name, body := range files {
		path := filepath.Join(dir, filepath.FromSlash(name))
		os.MkdirAll(filepath.Dir(path), 0o755)
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	p, err := pack.LoadPack(dir)
	if err != nil {
		t.Fatalf("LoadPack: %v", err)
	}
	return p, sha
}

func TestFontPacks(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	importAll(t, sqlDB)
	store := t.TempDir()
	p, sha := fontPack(t)
	if _, err := packs.Import(ctx, sqlDB, p); err == nil {
		t.Fatal("a font pack imported without a font store")
	}
	var changed []string
	onChange := packs.WithOnChange(func(typ, id, lang string) { changed = append(changed, typ+"/"+id+"/"+lang) })
	got, err := packs.Import(ctx, sqlDB, p, packs.WithFontStore(store), onChange)
	if err != nil || got != "1 faces, 1 slices" {
		t.Fatalf("Import = %q, %v", got, err)
	}
	if len(changed) != 1 || changed[0] != "font/test-font/" {
		t.Errorf("onChange = %v", changed)
	}
	if _, err := os.Stat(filepath.Join(store, sha[:2], sha+".woff2")); err != nil {
		t.Errorf("slice not stored: %v", err)
	}
	if !packs.Supported("font") || !packs.Installable("font") {
		t.Errorf("font must be supported and installable (admin upload)")
	}
	list, _ := packs.List(ctx, sqlDB)
	last := list[len(list)-1]
	if last.Type != "font" || last.PackID != "test-font" || last.License != "OFL-1.1" || last.Version != "1.0" ||
		last.UpdatedAt == "" || last.Language != "" || last.Languages != nil {
		t.Fatalf("font row (listed last) = %+v", last)
	}
	if _, err := packs.Find(ctx, sqlDB, "font", "test-font"); err != nil {
		t.Errorf("Find = %v", err)
	}
	texts, err := packs.Texts(ctx, sqlDB, "font", "test-font")
	if err != nil || len(texts) != 2 {
		t.Errorf("Texts = %+v, %v", texts, err)
	}
	if err := packs.Uninstall(ctx, sqlDB, "font", "test-font"); err == nil {
		t.Error("a font pack uninstalled without a font store")
	}
	if err := packs.Uninstall(ctx, sqlDB, "font", "test-font", packs.WithFontStore(store), onChange); err != nil {
		t.Fatal(err)
	}
	if len(changed) != 2 || changed[1] != "font/test-font/" {
		t.Errorf("onChange after uninstall = %v", changed)
	}
	if _, err := os.Stat(filepath.Join(store, sha[:2], sha+".woff2")); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("slice left behind: %v", err)
	}
	if err := packs.Uninstall(ctx, sqlDB, "font", "test-font", packs.WithFontStore(store)); !errors.Is(err, packs.ErrNotFound) {
		t.Errorf("second uninstall = %v", err)
	}
	if texts, _ := packs.Texts(ctx, sqlDB, "font", "test-font"); len(texts) != 0 {
		t.Errorf("texts after uninstall = %+v", texts)
	}
}
