package dict_test

import (
	"archive/zip"
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"qinqin/internal/db"
	"qinqin/internal/dict"
	"qinqin/internal/entries"
	"qinqin/internal/lang"
	"qinqin/internal/model"
)

// The zh and ja packs register for these tests the same way main.go
// registers them; import normalizes and derives readings through them.
func init() {
	lang.Register(lang.Zh{})
	lang.Register(lang.Ja{})
}

// fixturePack is the on-disk fixture pack, relative to this package's
// test working directory.
const fixturePack = "testdata/mkgloss"

// fixtureManifest mirrors testdata/mkgloss/manifest.json.
var fixtureManifest = dict.Manifest{
	ID:          "mkgloss",
	Name:        "Mkgloss demo dictionary",
	Version:     "1.0",
	Type:        "dictionary",
	Language:    "zh",
	License:     "CC BY-SA 4.0",
	Attribution: "Qinqin test fixtures",
	Format:      "json",
}

// newDB opens a fresh migrated database for import tests.
func newDB(t *testing.T) *sql.DB {
	t.Helper()
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	return sqlDB
}

// mustWriteFile writes data to path, creating parent directories.
func mustWriteFile(t *testing.T, path, data string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("create dir of %s: %v", path, err)
	}
	if err := os.WriteFile(path, []byte(data), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

// writePack writes manifest.json and dictionary.json into a fresh temp
// directory and returns its path, for packs built inline in tests.
func writePack(t *testing.T, m dict.Manifest, dictionary string) string {
	t.Helper()
	dir := t.TempDir()
	manifest, err := json.Marshal(m)
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	mustWriteFile(t, filepath.Join(dir, "manifest.json"), string(manifest))
	mustWriteFile(t, filepath.Join(dir, "dictionary.json"), dictionary)
	return dir
}

// zipDir zips every file under dir, preserving relative names, into a new
// temp .zip file and returns its path.
func zipDir(t *testing.T, dir string) string {
	t.Helper()
	f, err := os.CreateTemp("", "pack-*.zip")
	if err != nil {
		t.Fatalf("create temp zip: %v", err)
	}
	name := f.Name()
	t.Cleanup(func() { os.Remove(name) })

	zw := zip.NewWriter(f)
	err = filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
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
	if err := f.Close(); err != nil {
		t.Fatalf("close zip file: %v", err)
	}
	return name
}

// loadFixture loads the on-disk fixture pack.
func loadFixture(t *testing.T) dict.Pack {
	t.Helper()
	pack, err := dict.LoadPack(fixturePack)
	if err != nil {
		t.Fatalf("LoadPack(%s): %v", fixturePack, err)
	}
	return pack
}

// importFixture loads and imports the on-disk fixture pack.
func importFixture(t *testing.T, ctx context.Context, sqlDB *sql.DB) dict.Result {
	t.Helper()
	res, err := dict.Import(ctx, sqlDB, loadFixture(t))
	if err != nil {
		t.Fatalf("import fixture pack: %v", err)
	}
	return res
}

// mustGet fetches the entry (written, kind, language), failing the test
// when it is missing.
func mustGet(t *testing.T, st entries.Store, written, kind, language string) model.Entry {
	t.Helper()
	e, err := st.GetByWritten(context.Background(), written, kind, language)
	if err != nil {
		t.Fatalf("GetByWritten(%s, %s, %s): %v", written, kind, language, err)
	}
	return *e
}

// findReading returns e's reading of the given type, or nil.
func findReading(e model.Entry, readType string) *model.Reading {
	for i := range e.Readings {
		if e.Readings[i].Type == readType {
			return &e.Readings[i]
		}
	}
	return nil
}

// dictionaryID returns the row id of the dictionary installed from
// packID, failing when it is missing.
func dictionaryID(t *testing.T, sqlDB *sql.DB, packID string) int64 {
	t.Helper()
	var id int64
	if err := sqlDB.QueryRow(`SELECT id FROM dictionaries WHERE pack_id = ?`, packID).Scan(&id); err != nil {
		t.Fatalf("dictionary %s: %v", packID, err)
	}
	return id
}

// activeGlosses returns the entry's active glosses under the dictionary,
// in ord order.
func activeGlosses(t *testing.T, sqlDB *sql.DB, dictID, entryID int64) []string {
	t.Helper()
	rows, err := sqlDB.Query(`SELECT gloss FROM senses
		WHERE dictionary_id = ? AND entry_id = ? AND deleted_at IS NULL
		ORDER BY ord`, dictID, entryID)
	if err != nil {
		t.Fatalf("load glosses of entry %d: %v", entryID, err)
	}
	defer rows.Close()
	glosses := []string{}
	for rows.Next() {
		var g string
		if err := rows.Scan(&g); err != nil {
			t.Fatalf("scan gloss of entry %d: %v", entryID, err)
		}
		glosses = append(glosses, g)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("load glosses of entry %d: %v", entryID, err)
	}
	return glosses
}

// senseCounts returns the dictionary's active and tombstoned sense rows.
func senseCounts(t *testing.T, sqlDB *sql.DB, dictID int64) (active, tombstoned int) {
	t.Helper()
	err := sqlDB.QueryRow(`SELECT
			COUNT(CASE WHEN deleted_at IS NULL THEN 1 END),
			COUNT(CASE WHEN deleted_at IS NOT NULL THEN 1 END)
		FROM senses WHERE dictionary_id = ?`, dictID).Scan(&active, &tombstoned)
	if err != nil {
		t.Fatalf("count senses of dictionary %d: %v", dictID, err)
	}
	return active, tombstoned
}

func TestManifestRequiresLicense(t *testing.T) {
	valid := fixtureManifest
	if err := valid.Validate(); err != nil {
		t.Fatalf("Validate of a complete manifest = %v, want nil", err)
	}
	for _, tc := range []struct {
		name   string
		mutate func(*dict.Manifest)
		want   string
	}{
		{"no license", func(m *dict.Manifest) { m.License = "" }, "license"},
		{"blank license", func(m *dict.Manifest) { m.License = "   " }, "license"},
		{"no attribution", func(m *dict.Manifest) { m.Attribution = "" }, "attribution"},
		{"no language", func(m *dict.Manifest) { m.Language = "" }, "language"},
		{"no id", func(m *dict.Manifest) { m.ID = "" }, "id"},
		{"no name", func(m *dict.Manifest) { m.Name = "" }, "name"},
		{"no version", func(m *dict.Manifest) { m.Version = "" }, "version"},
		{"unknown type", func(m *dict.Manifest) { m.Type = "plugin" }, "type"},
		{"unknown format", func(m *dict.Manifest) { m.Format = "yaml" }, "format"},
	} {
		m := valid
		tc.mutate(&m)
		err := m.Validate()
		if err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("%s: Validate() = %v, want an error mentioning %q", tc.name, err, tc.want)
		}
	}
}

func TestLoadPackDirectory(t *testing.T) {
	pack := loadFixture(t)
	if pack.Manifest != fixtureManifest {
		t.Errorf("manifest = %+v, want %+v", pack.Manifest, fixtureManifest)
	}
	if pack.Dir != fixturePack {
		t.Errorf("pack dir = %q, want %q", pack.Dir, fixturePack)
	}
}

func TestLoadPackZip(t *testing.T) {
	pack, err := dict.LoadPack(zipDir(t, fixturePack))
	if err != nil {
		t.Fatalf("LoadPack(zip of fixture): %v", err)
	}
	t.Cleanup(func() { os.RemoveAll(pack.Dir) }) // a zip's extraction is the caller's to clean up
	if pack.Manifest != fixtureManifest {
		t.Errorf("manifest = %+v, want %+v", pack.Manifest, fixtureManifest)
	}
	if pack.Dir == fixturePack {
		t.Fatal("zip pack kept the zip's path as its dir, want an extraction directory")
	}
	if _, err := os.Stat(filepath.Join(pack.Dir, "dictionary.json")); err != nil {
		t.Errorf("dictionary.json not extracted: %v", err)
	}

	// A zip-sourced pack imports like a directory-sourced one.
	sqlDB := newDB(t)
	res, err := dict.Import(context.Background(), sqlDB, pack)
	if err != nil {
		t.Fatalf("Import(zip-sourced pack): %v", err)
	}
	if res.Entries != 3 || res.Senses != 5 {
		t.Errorf("Import(zip-sourced pack) = %+v, want 3 entries and 5 senses", res)
	}
}

func TestLoadPackErrors(t *testing.T) {
	noManifest := t.TempDir()
	badJSON := t.TempDir()
	mustWriteFile(t, filepath.Join(badJSON, "manifest.json"), "not json")
	noLicense := t.TempDir()
	mustWriteFile(t, filepath.Join(noLicense, "manifest.json"),
		`{"id":"x","name":"X","version":"1","type":"dictionary","language":"zh","attribution":"a","format":"json"}`)
	looseFile := filepath.Join(t.TempDir(), "loose.txt")
	mustWriteFile(t, looseFile, "x")

	for _, tc := range []struct {
		name, path string
	}{
		{"missing path", filepath.Join(t.TempDir(), "absent")},
		{"directory without manifest.json", noManifest},
		{"file that is neither a directory nor a zip", looseFile},
		{"malformed manifest.json", badJSON},
		{"manifest without license", noLicense},
	} {
		if _, err := dict.LoadPack(tc.path); err == nil {
			t.Errorf("%s: LoadPack succeeded, want error", tc.name)
		}
	}

	// A zip without a manifest is rejected too.
	dataOnly := t.TempDir()
	mustWriteFile(t, filepath.Join(dataOnly, "dictionary.json"), "{}")
	if _, err := dict.LoadPack(zipDir(t, dataOnly)); err == nil {
		t.Error("LoadPack(zip without manifest.json) succeeded, want error")
	}
}

func TestExtractZipRejectsUnsafeNames(t *testing.T) {
	for _, name := range []string{"../evil.txt", "/etc/passwd", ".."} {
		var buf bytes.Buffer
		zw := zip.NewWriter(&buf)
		w, err := zw.Create(name)
		if err != nil {
			t.Fatalf("create zip entry %q: %v", name, err)
		}
		if _, err := w.Write([]byte("x")); err != nil {
			t.Fatalf("write zip entry %q: %v", name, err)
		}
		if err := zw.Close(); err != nil {
			t.Fatalf("close zip: %v", err)
		}
		if err := dict.ExtractZip(bytes.NewReader(buf.Bytes()), t.TempDir()); err == nil {
			t.Errorf("ExtractZip of entry %q succeeded, want rejection", name)
		}
	}

	// Well-formed entries extract under their relative paths.
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, data := range map[string]string{
		"manifest.json":   "{}",
		"nested/file.txt": "x",
		"dictionary.json": "{}",
	} {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatalf("create zip entry %q: %v", name, err)
		}
		if _, err := w.Write([]byte(data)); err != nil {
			t.Fatalf("write zip entry %q: %v", name, err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("close zip: %v", err)
	}
	dir := t.TempDir()
	if err := dict.ExtractZip(bytes.NewReader(buf.Bytes()), dir); err != nil {
		t.Fatalf("ExtractZip of valid entries: %v", err)
	}
	for _, name := range []string{"manifest.json", "dictionary.json", "nested/file.txt"} {
		if _, err := os.Stat(filepath.Join(dir, filepath.FromSlash(name))); err != nil {
			t.Errorf("zip entry %q not extracted: %v", name, err)
		}
	}
}

func TestImportJsonPack(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)
	res := importFixture(t, ctx, sqlDB)

	// The pack holds 好 and 你好 with its traditional form 妳好: three
	// entries, five senses (1 + 2 + 2 glosses).
	if res.Entries != 3 || res.Senses != 5 {
		t.Fatalf("Import = %+v, want 3 entries and 5 senses", res)
	}

	// Import registers the dictionary keyed by the manifest id, carrying
	// the manifest's license terms.
	var (
		name, version, license, attribution string
		deletedAt                           sql.NullString
	)
	err := sqlDB.QueryRow(`SELECT name, version, license, attribution, deleted_at
		FROM dictionaries WHERE pack_id = 'mkgloss'`).Scan(&name, &version, &license, &attribution, &deletedAt)
	if err != nil {
		t.Fatalf("read mkgloss dictionary row: %v", err)
	}
	if name != fixtureManifest.Name || version != fixtureManifest.Version ||
		license != fixtureManifest.License || attribution != fixtureManifest.Attribution {
		t.Errorf("dictionary row = %q %q %q %q, want the manifest's terms", name, version, license, attribution)
	}
	if deletedAt.Valid {
		t.Errorf("dictionary deleted_at = %v, want active", deletedAt)
	}
	dictID := dictionaryID(t, sqlDB, "mkgloss")

	// The three entries exist, language-tagged, with readings normalized
	// and bopomofo derived by the zh pack inside the entry upsert.
	st := entries.Store{DB: sqlDB}
	hao := mustGet(t, st, "好", "character", "zh")
	if py := findReading(hao, "pinyin"); py == nil || py.Value != "hǎo" || py.Plain != "hao" {
		t.Errorf("readings of 好 = %+v, want pinyin hǎo with plain hao", hao.Readings)
	}
	if bm := findReading(hao, "bopomofo"); bm == nil || bm.Value != "ㄏㄠˇ" {
		t.Errorf("readings of 好 = %+v, want derived bopomofo ㄏㄠˇ", hao.Readings)
	}
	nihao := mustGet(t, st, "你好", "word", "zh")
	if py := findReading(nihao, "pinyin"); py == nil || py.Value != "nǐ hǎo" || py.Plain != "nihao" {
		t.Errorf("readings of 你好 = %+v, want pinyin nǐ hǎo with plain nihao", nihao.Readings)
	}
	if bm := findReading(nihao, "bopomofo"); bm == nil || bm.Value != "ㄋㄧˇ ㄏㄠˇ" {
		t.Errorf("readings of 你好 = %+v, want derived bopomofo ㄋㄧˇ ㄏㄠˇ", nihao.Readings)
	}

	// The differing traditional form is its own entry, linked as a
	// variant, with the same readings and glosses.
	trad := mustGet(t, st, "妳好", "word", "zh")
	if py := findReading(trad, "pinyin"); py == nil || py.Value != "nǐ hǎo" {
		t.Errorf("readings of 妳好 = %+v, want the readings carried over", trad.Readings)
	}
	variants, err := st.Variants(ctx, nihao.ID)
	if err != nil {
		t.Fatalf("Variants(你好): %v", err)
	}
	if len(variants) != 1 || variants[0].ID != trad.ID {
		t.Errorf("Variants(你好) = %v, want just 妳好 (id %d)", variants, trad.ID)
	}
	variants, err = st.Variants(ctx, trad.ID)
	if err != nil {
		t.Fatalf("Variants(妳好): %v", err)
	}
	if len(variants) != 1 || variants[0].ID != nihao.ID {
		t.Errorf("Variants(妳好) = %v, want just 你好 (id %d) — the link is symmetric", variants, nihao.ID)
	}

	// Senses live under (dictionary, entry); both forms carry them.
	if got := activeGlosses(t, sqlDB, dictID, hao.ID); !slices.Equal(got, []string{"good"}) {
		t.Errorf("glosses of 好 = %v, want [good]", got)
	}
	if got := activeGlosses(t, sqlDB, dictID, nihao.ID); !slices.Equal(got, []string{"hello", "hi"}) {
		t.Errorf("glosses of 你好 = %v, want [hello hi]", got)
	}
	if got := activeGlosses(t, sqlDB, dictID, trad.ID); !slices.Equal(got, []string{"hello", "hi"}) {
		t.Errorf("glosses of 妳好 = %v, want [hello hi] — both forms get the sense", got)
	}

	// zh is a registered code pack: importing it creates no language row.
	var zhRows int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM languages WHERE code = 'zh'`).Scan(&zhRows); err != nil {
		t.Fatalf("count zh language rows: %v", err)
	}
	if zhRows != 0 {
		t.Errorf("zh language rows = %d, want 0 (zh is a code pack, not data-only)", zhRows)
	}
}

func TestUnknownLanguageAutoRegisters(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)

	// A Spanish–English dictionary: es has no code pack, so importing it
	// auto-registers es as a data-only language named from the manifest.
	m := dict.Manifest{
		ID:          "es-demo",
		Name:        "Demo Spanish dictionary",
		Version:     "1.0",
		Type:        "dictionary",
		Language:    "es",
		License:     "CC0",
		Attribution: "Qinqin test fixtures",
		Format:      "json",
	}
	dir := writePack(t, m, `{"entries": [
		{"written": "hola", "kind": "word",
		 "readings": [{"type": "latin", "value": "hola"}],
		 "glosses": ["hello"]}]}`)
	pack, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatalf("LoadPack(es-demo): %v", err)
	}
	res, err := dict.Import(ctx, sqlDB, pack)
	if err != nil {
		t.Fatalf("Import(es-demo): %v", err)
	}
	if res.Entries != 1 || res.Senses != 1 {
		t.Fatalf("Import(es-demo) = %+v, want 1 entry and 1 sense", res)
	}
	var name string
	if err := sqlDB.QueryRow(`SELECT name FROM languages WHERE code = 'es'`).Scan(&name); err != nil {
		t.Fatalf("es language row: %v (want auto-registered)", err)
	}
	if name != m.Name {
		t.Errorf("es language name = %q, want the manifest's name %q", name, m.Name)
	}

	// The es entry normalizes through the generic pack: lowercased plain
	// form, nothing derived.
	st := entries.Store{DB: sqlDB}
	hola := mustGet(t, st, "hola", "word", "es")
	if len(hola.Readings) != 1 {
		t.Fatalf("readings of hola = %+v, want just the latin reading", hola.Readings)
	}
	if r := hola.Readings[0]; r.Type != "latin" || r.Value != "hola" || r.Plain != "hola" {
		t.Errorf("latin reading = %+v, want hola/hola", r)
	}
	if got := activeGlosses(t, sqlDB, dictionaryID(t, sqlDB, "es-demo"), hola.ID); !slices.Equal(got, []string{"hello"}) {
		t.Errorf("glosses of hola = %v, want [hello]", got)
	}

	// Re-importing does not duplicate the language row.
	if _, err := dict.Import(ctx, sqlDB, pack); err != nil {
		t.Fatalf("re-import es-demo: %v", err)
	}
	var esRows int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM languages WHERE code = 'es'`).Scan(&esRows); err != nil {
		t.Fatalf("count es language rows: %v", err)
	}
	if esRows != 1 {
		t.Errorf("es language rows = %d, want 1", esRows)
	}
}

func TestReimportReplacesSenses(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)
	importFixture(t, ctx, sqlDB)
	dictID := dictionaryID(t, sqlDB, "mkgloss")

	st := entries.Store{DB: sqlDB}
	hao := mustGet(t, st, "好", "character", "zh")
	nihao := mustGet(t, st, "你好", "word", "zh")

	// Re-import the same pack id with a changed gloss for 你好.
	dir := writePack(t, fixtureManifest, `{"entries": [
		{"written": "好", "trad": "好", "kind": "character",
		 "readings": [{"type": "pinyin", "value": "hǎo"}],
		 "glosses": ["good"]},
		{"written": "你好", "trad": "妳好", "kind": "word",
		 "readings": [{"type": "pinyin", "value": "nǐ hǎo"}],
		 "glosses": ["greeting"]}]}`)
	pack, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatalf("LoadPack(changed pack): %v", err)
	}
	res, err := dict.Import(ctx, sqlDB, pack)
	if err != nil {
		t.Fatalf("re-import: %v", err)
	}
	if res.Entries != 3 || res.Senses != 3 {
		t.Fatalf("re-import = %+v, want 3 entries and 3 senses", res)
	}

	// The new gloss is active, the old one tombstoned; the replacement
	// covers the whole dictionary (好's unchanged gloss is re-inserted too).
	if got := activeGlosses(t, sqlDB, dictID, nihao.ID); !slices.Equal(got, []string{"greeting"}) {
		t.Errorf("glosses of 你好 after re-import = %v, want [greeting]", got)
	}
	if got := activeGlosses(t, sqlDB, dictID, hao.ID); !slices.Equal(got, []string{"good"}) {
		t.Errorf("glosses of 好 after re-import = %v, want [good]", got)
	}
	// Only the changed glosses are tombstoned: hello and hi on both forms
	// of 你好 (4 rows). 好's unchanged gloss keeps its row.
	if a, d := senseCounts(t, sqlDB, dictID); a != 3 || d != 4 {
		t.Errorf("senses after re-import = %d active, %d tombstoned, want 3 and 4", a, d)
	}

	// The entry rows are untouched: same ids, same language-tagged data,
	// same readings.
	after := mustGet(t, st, "好", "character", "zh")
	if after.ID != hao.ID {
		t.Errorf("id of 好 after re-import = %d, want %d", after.ID, hao.ID)
	}
	after = mustGet(t, st, "你好", "word", "zh")
	if after.ID != nihao.ID {
		t.Errorf("id of 你好 after re-import = %d, want %d", after.ID, nihao.ID)
	}
	if py := findReading(after, "pinyin"); py == nil || py.Value != "nǐ hǎo" || py.Plain != "nihao" {
		t.Errorf("readings of 你好 after re-import = %+v, want the unchanged pinyin", after.Readings)
	}
	if bm := findReading(after, "bopomofo"); bm == nil || bm.Value != "ㄋㄧˇ ㄏㄠˇ" {
		t.Errorf("readings of 你好 after re-import = %+v, want the derived bopomofo", after.Readings)
	}

	// One dictionary row for the pack id, still active.
	if got := dictionaryID(t, sqlDB, "mkgloss"); got != dictID {
		t.Errorf("dictionary id after re-import = %d, want %d", got, dictID)
	}
	var dictRows int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM dictionaries`).Scan(&dictRows); err != nil {
		t.Fatalf("count dictionaries: %v", err)
	}
	if dictRows != 1 {
		t.Errorf("dictionary rows after re-import = %d, want 1", dictRows)
	}
}

func TestUninstallSoftDeletesSenses(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)
	importFixture(t, ctx, sqlDB)
	dictID := dictionaryID(t, sqlDB, "mkgloss")

	st := entries.Store{DB: sqlDB}
	hao := mustGet(t, st, "好", "character", "zh")
	nihao := mustGet(t, st, "你好", "word", "zh")

	if err := dict.Uninstall(ctx, sqlDB, dictID); err != nil {
		t.Fatalf("Uninstall: %v", err)
	}
	if a, d := senseCounts(t, sqlDB, dictID); a != 0 || d != 5 {
		t.Errorf("senses after uninstall = %d active, %d tombstoned, want 0 and 5", a, d)
	}
	// The dictionary row is tombstoned too; the entries survive.
	var deletedAt sql.NullString
	if err := sqlDB.QueryRow(`SELECT deleted_at FROM dictionaries WHERE id = ?`, dictID).Scan(&deletedAt); err != nil {
		t.Fatalf("read dictionary row: %v", err)
	}
	if !deletedAt.Valid {
		t.Error("dictionary row still active after uninstall, want tombstoned")
	}
	if again := mustGet(t, st, "好", "character", "zh"); again.ID != hao.ID {
		t.Errorf("entry 好 changed by uninstall: id %d, want %d", again.ID, hao.ID)
	}
	if again := mustGet(t, st, "你好", "word", "zh"); again.ID != nihao.ID {
		t.Errorf("entry 你好 changed by uninstall: id %d, want %d", again.ID, nihao.ID)
	}

	// Unknown and already-uninstalled dictionaries are not found.
	if err := dict.Uninstall(ctx, sqlDB, dictID); !errors.Is(err, dict.ErrNotFound) {
		t.Errorf("re-uninstall = %v, want ErrNotFound", err)
	}
	if err := dict.Uninstall(ctx, sqlDB, 999999); !errors.Is(err, dict.ErrNotFound) {
		t.Errorf("uninstall of unknown id = %v, want ErrNotFound", err)
	}

	// Re-importing the pack revives the dictionary row and its senses.
	if res := importFixture(t, ctx, sqlDB); res.Entries != 3 || res.Senses != 5 {
		t.Fatalf("re-import after uninstall = %+v, want 3 entries and 5 senses", res)
	}
	if got := dictionaryID(t, sqlDB, "mkgloss"); got != dictID {
		t.Errorf("dictionary id after re-import = %d, want %d revived in place", got, dictID)
	}
	// The tombstoned senses come back in place, not as a second copy.
	if a, d := senseCounts(t, sqlDB, dictID); a != 5 || d != 0 {
		t.Errorf("senses after re-import = %d active, %d tombstoned, want 5 and 0", a, d)
	}
	var revivedAt sql.NullString
	if err := sqlDB.QueryRow(`SELECT deleted_at FROM dictionaries WHERE id = ?`, dictID).Scan(&revivedAt); err != nil {
		t.Fatalf("read dictionary row: %v", err)
	}
	if revivedAt.Valid {
		t.Error("dictionary deleted_at set after re-import, want revived")
	}
}

func TestImportRejectsNonDictionaryType(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)
	for _, typ := range []string{"levels", "sentences"} {
		m := fixtureManifest
		m.Type = typ
		dir := writePack(t, m, `{}`)
		pack, err := dict.LoadPack(dir)
		if err != nil {
			t.Fatalf("LoadPack(%s pack): %v", typ, err)
		}
		if _, err := dict.Import(ctx, sqlDB, pack); !errors.Is(err, dict.ErrNotDictionary) {
			t.Errorf("Import of %s pack = %v, want ErrNotDictionary", typ, err)
		}
	}
	var dictRows int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM dictionaries`).Scan(&dictRows); err != nil {
		t.Fatalf("count dictionaries: %v", err)
	}
	if dictRows != 0 {
		t.Errorf("dictionary rows = %d, want 0 — rejected packs import nothing", dictRows)
	}
}

func TestImportRejectsMissingDataFile(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)
	for _, format := range []string{"jmdict", "kanjidic2"} {
		m := fixtureManifest
		m.Format = format
		m.Language = "ja"
		dir := writePack(t, m, "{}")
		pack, err := dict.LoadPack(dir)
		if err != nil {
			t.Fatalf("LoadPack(%s pack): %v", format, err)
		}
		_, err = dict.Import(ctx, sqlDB, pack)
		if !errors.Is(err, dict.ErrInvalidPack) {
			t.Fatalf("Import of %s pack = %v, want ErrInvalidPack", format, err)
		}
		if !strings.Contains(err.Error(), format) {
			t.Errorf("Import of %s pack = %v, want the error to name the format", format, err)
		}
	}
	var dictRows int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM dictionaries`).Scan(&dictRows); err != nil {
		t.Fatalf("count dictionaries: %v", err)
	}
	if dictRows != 0 {
		t.Errorf("dictionary rows = %d, want 0 — rejected packs import nothing", dictRows)
	}
}
