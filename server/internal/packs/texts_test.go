package packs_test

import (
	"bytes"
	"compress/gzip"
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/dict"
	"qinqin/internal/packs"
)

// cedictRoot is the bundled CC-CEDICT pack: its licence files are the real ones.
var cedictRoot = filepath.Join("..", "..", "..", "plugins", "data", "cedict")

// smallCedict copies the bundled cedict pack's manifest and licence files
// next to a two-line dictionary, so the import is quick and the texts real.
func smallCedict(t *testing.T) dict.Pack {
	t.Helper()
	dir := t.TempDir()
	for _, name := range []string{"manifest.json", "LICENSE", "ATTRIBUTION.md"} {
		b, err := os.ReadFile(filepath.Join(cedictRoot, name))
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, name), b, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	var gz bytes.Buffer
	w := gzip.NewWriter(&gz)
	w.Write([]byte("你好 你好 [ni3 hao3] /hello/\n再見 再见 [zai4 jian4] /goodbye/\n"))
	w.Close()
	if err := os.WriteFile(filepath.Join(dir, "dictionary.txt.gz"), gz.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	p, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func texts(t *testing.T, sqlDB *sql.DB, typ, id string) map[string]string {
	t.Helper()
	list, err := packs.Texts(context.Background(), sqlDB, typ, id)
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]string{}
	var names []string
	for _, x := range list {
		out[x.Name] = x.Text
		names = append(names, x.Name)
	}
	for i := 1; i < len(names); i++ {
		if names[i-1] >= names[i] {
			t.Errorf("Texts not sorted by name: %v", names)
		}
	}
	return out
}

func TestImportKeepsTheLicenceTextsVerbatim(t *testing.T) {
	sqlDB := dbtest.Open(t)
	if _, err := packs.Import(context.Background(), sqlDB, smallCedict(t)); err != nil {
		t.Fatal(err)
	}
	got := texts(t, sqlDB, dict.TypeDictionary, "cedict")
	if len(got) != 2 {
		t.Fatalf("texts = %v, want LICENSE and ATTRIBUTION.md", keys(got))
	}
	for _, name := range []string{"LICENSE", "ATTRIBUTION.md"} {
		want, _ := os.ReadFile(filepath.Join(cedictRoot, name))
		if got[name] != string(want) {
			t.Errorf("%s differs from the pack's file (%d vs %d bytes)", name, len(got[name]), len(want))
		}
	}
	if ok, err := packs.TextsStored(context.Background(), sqlDB, dict.TypeDictionary, "cedict"); err != nil || !ok {
		t.Errorf("TextsStored = %v, %v; want true", ok, err)
	}
}

func keys(m map[string]string) []string {
	var out []string
	for k := range m {
		out = append(out, k)
	}
	return out
}

func writeFiles(t *testing.T, dir string, files map[string][]byte) {
	t.Helper()
	for n, b := range files {
		if err := os.WriteFile(filepath.Join(dir, n), b, 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

func storeTexts(t *testing.T, sqlDB *sql.DB, typ, id, dir string) int {
	t.Helper()
	tx, err := sqlDB.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	n, err := packs.StoreTexts(context.Background(), tx, typ, id, dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	return n
}

// Only regular, valid UTF-8 files of at most 256 KiB whose names start with
// LICENSE, LICENCE, ATTRIBUTION, NOTICE or COPYING (any case) are kept, at
// most 8 per pack in name order; every skipped candidate is logged.
func TestStoreTextsSkipsWhatItMustNotKeep(t *testing.T) {
	sqlDB := dbtest.Open(t)
	var logged []string
	defer packs.SetLogfForTest(func(f string, a ...any) { logged = append(logged, fmt.Sprintf(f, a...)) })()

	dir := t.TempDir()
	writeFiles(t, dir, map[string][]byte{
		"LICENSE":        []byte("MIT License\r\n\r\nCopyright (c) 2026\r\n"),
		"license-extra":  []byte("lower case counts"),
		"Licence.md":     []byte("British spelling"),
		"NOTICE.txt":     bytes.Repeat([]byte("n"), 300<<10),
		"ATTRIBUTION.md": {0xff, 0xfe, 'x'},
		"README.md":      []byte("not a licence file"),
		"dictionary.txt": []byte("data"),
	})
	if err := os.Symlink(filepath.Join(dir, "LICENSE"), filepath.Join(dir, "COPYING")); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(dir, "LICENSES"), 0o755); err != nil {
		t.Fatal(err)
	}
	if n := storeTexts(t, sqlDB, "dictionary", "p", dir); n != 3 {
		t.Errorf("stored %d texts, want 3", n)
	}
	got := texts(t, sqlDB, "dictionary", "p")
	if got["LICENSE"] != "MIT License\r\n\r\nCopyright (c) 2026\r\n" || got["license-extra"] == "" || got["Licence.md"] == "" || len(got) != 3 {
		t.Errorf("texts = %v", keys(got))
	}
	for _, skipped := range []string{"NOTICE.txt", "ATTRIBUTION.md", "COPYING", "LICENSES"} {
		if !anyContains(logged, skipped) {
			t.Errorf("skipping %s was not logged: %q", skipped, logged)
		}
	}
	if anyContains(logged, "README.md") || anyContains(logged, "dictionary.txt") {
		t.Errorf("a file that is no licence candidate was logged: %q", logged)
	}

	// A ninth candidate is skipped (name order) and logged.
	logged = nil
	many := t.TempDir()
	files := map[string][]byte{}
	for _, c := range "ABCDEFGHI" {
		files["LICENSE-"+string(c)] = []byte("text " + string(c))
	}
	writeFiles(t, many, files)
	if n := storeTexts(t, sqlDB, "dictionary", "many", many); n != 8 {
		t.Errorf("stored %d texts, want 8", n)
	}
	got = texts(t, sqlDB, "dictionary", "many")
	if _, ok := got["LICENSE-I"]; ok || len(got) != 8 {
		t.Errorf("texts = %v, want LICENSE-A..H", keys(got))
	}
	if !anyContains(logged, "LICENSE-I") {
		t.Errorf("the ninth file was not logged: %q", logged)
	}
}

func anyContains(list []string, s string) bool {
	for _, l := range list {
		if strings.Contains(l, s) {
			return true
		}
	}
	return false
}

func TestReimportReplacesAndUninstallDeletesTexts(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	p := dictPack(t)
	writeFiles(t, p.Dir, map[string][]byte{"LICENSE": []byte("v1"), "ATTRIBUTION.md": []byte("by us")})
	if _, err := packs.Import(ctx, sqlDB, p); err != nil {
		t.Fatal(err)
	}
	if got := texts(t, sqlDB, "dictionary", "es-test"); got["LICENSE"] != "v1" || got["ATTRIBUTION.md"] != "by us" {
		t.Fatalf("texts after import = %v", got)
	}

	os.Remove(filepath.Join(p.Dir, "ATTRIBUTION.md"))
	writeFiles(t, p.Dir, map[string][]byte{"LICENSE": []byte("v2")})
	if _, err := packs.Import(ctx, sqlDB, p); err != nil {
		t.Fatal(err)
	}
	if got := texts(t, sqlDB, "dictionary", "es-test"); len(got) != 1 || got["LICENSE"] != "v2" {
		t.Fatalf("texts after re-import = %v", got)
	}

	// Another pack's texts are untouched by this pack's uninstall.
	f := freqPack(t)
	writeFiles(t, f.Dir, map[string][]byte{"LICENSE": []byte("freq")})
	if _, err := packs.Import(ctx, sqlDB, f); err != nil {
		t.Fatal(err)
	}
	if err := packs.Uninstall(ctx, sqlDB, "dictionary", "es-test"); err != nil {
		t.Fatal(err)
	}
	if got := texts(t, sqlDB, "dictionary", "es-test"); len(got) != 0 {
		t.Errorf("texts after uninstall = %v", got)
	}
	if ok, _ := packs.TextsStored(ctx, sqlDB, "dictionary", "es-test"); ok {
		t.Error("TextsStored true after uninstall")
	}
	if got := texts(t, sqlDB, "frequency", "es-freq"); got["LICENSE"] != "freq" {
		t.Errorf("frequency texts = %v", got)
	}
}

// A pack that ships no licence file is recorded as collected (nothing to
// keep), unlike a pack imported before texts were kept.
func TestTextsStoredTellsEmptyFromNeverCollected(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	if _, err := packs.Import(ctx, sqlDB, levelsPackAfterDict(t, sqlDB)); err != nil {
		t.Fatal(err)
	}
	if ok, err := packs.TextsStored(ctx, sqlDB, "levels", "es-levels"); err != nil || !ok {
		t.Errorf("TextsStored of a pack without files = %v, %v; want true", ok, err)
	}
	if got := texts(t, sqlDB, "levels", "es-levels"); len(got) != 0 {
		t.Errorf("texts = %v, want none", got)
	}
	// The dictionary was imported, then its rows removed: as a pack from before.
	if _, err := sqlDB.Exec(`DELETE FROM pack_texts WHERE pack_type = 'dictionary'`); err != nil {
		t.Fatal(err)
	}
	if ok, err := packs.TextsStored(ctx, sqlDB, "dictionary", "es-test"); err != nil || ok {
		t.Errorf("TextsStored of a pack never collected = %v, %v; want false", ok, err)
	}
}

func levelsPackAfterDict(t *testing.T, sqlDB *sql.DB) dict.Pack {
	t.Helper()
	if _, err := packs.Import(context.Background(), sqlDB, dictPack(t)); err != nil {
		t.Fatal(err)
	}
	return levelsPack(t)
}

// The registry id decides: kanjidic2 and unihan register fixed ids
// whatever the manifest id is, and their texts follow the registry row.
func TestTextsUseTheRegistryPackID(t *testing.T) {
	m := dict.Manifest{ID: "my-unihan", Type: dict.TypeDictionary, Format: dict.FormatUnihan}
	if got := packs.RegistryID(m); got != "unihan" {
		t.Errorf("RegistryID(unihan format) = %q, want unihan", got)
	}
	m = dict.Manifest{ID: "es-freq", Type: dict.TypeFrequency}
	if got := packs.RegistryID(m); got != "es-freq" {
		t.Errorf("RegistryID(frequency) = %q, want the manifest id", got)
	}
}
