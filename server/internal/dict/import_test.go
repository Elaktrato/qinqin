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
	"reflect"
	"slices"
	"strings"
	"testing"

	"qinqin/internal/db"
	"qinqin/internal/dict"
	"qinqin/internal/lang"
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
	pack := loadFixture(t)
	res, err := dict.ImportLexicon(ctx, sqlDB, &pack)
	if err != nil {
		t.Fatalf("import fixture pack: %v", err)
	}
	return res
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

// fixtureEntries and fixtureSenses are what the fixture pack imports:
// 好 and 你好 (its traditional 妳好 one of its forms), one sense each
// carrying the entry's glosses.
const (
	fixtureEntries = 2
	fixtureSenses  = 2
)

// activeEntries returns the ids of the active lexicon entries, ascending.
func activeEntries(t *testing.T, sqlDB *sql.DB) []int64 {
	t.Helper()
	rows, err := sqlDB.Query(`SELECT id FROM entries WHERE deleted_at IS NULL ORDER BY id`)
	if err != nil {
		t.Fatalf("list entries: %v", err)
	}
	defer rows.Close()
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			t.Fatalf("scan entry: %v", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("list entries: %v", err)
	}
	return ids
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
	if !reflect.DeepEqual(pack.Manifest, fixtureManifest) {
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
	if !reflect.DeepEqual(pack.Manifest, fixtureManifest) {
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
	res, err := dict.ImportLexicon(context.Background(), sqlDB, &pack)
	if err != nil {
		t.Fatalf("ImportLexicon(zip-sourced pack): %v", err)
	}
	if res.Entries != fixtureEntries || res.Senses != fixtureSenses {
		t.Errorf("ImportLexicon(zip-sourced pack) = %+v, want %d entries and %d senses", res, fixtureEntries, fixtureSenses)
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

func TestUninstallSoftDeletesSenses(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)
	importFixture(t, ctx, sqlDB)
	dictID := dictionaryID(t, sqlDB, "mkgloss")

	entriesBefore := activeEntries(t, sqlDB)

	if err := dict.Uninstall(ctx, sqlDB, dictID); err != nil {
		t.Fatalf("Uninstall: %v", err)
	}
	if a, d := senseCounts(t, sqlDB, dictID); a != 0 || d != fixtureSenses {
		t.Errorf("senses after uninstall = %d active, %d tombstoned, want 0 and %d", a, d, fixtureSenses)
	}
	// The dictionary row is tombstoned too; the entries survive.
	var deletedAt sql.NullString
	if err := sqlDB.QueryRow(`SELECT deleted_at FROM dictionaries WHERE id = ?`, dictID).Scan(&deletedAt); err != nil {
		t.Fatalf("read dictionary row: %v", err)
	}
	if !deletedAt.Valid {
		t.Error("dictionary row still active after uninstall, want tombstoned")
	}
	if after := activeEntries(t, sqlDB); !slices.Equal(after, entriesBefore) {
		t.Errorf("active entries after uninstall = %v, want %v untouched", after, entriesBefore)
	}

	// Unknown and already-uninstalled dictionaries are not found.
	if err := dict.Uninstall(ctx, sqlDB, dictID); !errors.Is(err, dict.ErrNotFound) {
		t.Errorf("re-uninstall = %v, want ErrNotFound", err)
	}
	if err := dict.Uninstall(ctx, sqlDB, 999999); !errors.Is(err, dict.ErrNotFound) {
		t.Errorf("uninstall of unknown id = %v, want ErrNotFound", err)
	}

	// Re-importing the pack revives the dictionary row and its senses.
	if res := importFixture(t, ctx, sqlDB); res.Entries != fixtureEntries || res.Senses != fixtureSenses {
		t.Fatalf("re-import after uninstall = %+v, want %d entries and %d senses", res, fixtureEntries, fixtureSenses)
	}
	if got := dictionaryID(t, sqlDB, "mkgloss"); got != dictID {
		t.Errorf("dictionary id after re-import = %d, want %d revived in place", got, dictID)
	}
	if a, _ := senseCounts(t, sqlDB, dictID); a != fixtureSenses {
		t.Errorf("active senses after re-import = %d, want %d", a, fixtureSenses)
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
		if _, err := dict.ImportLexicon(ctx, sqlDB, &pack); !errors.Is(err, dict.ErrNotDictionary) {
			t.Errorf("ImportLexicon of %s pack = %v, want ErrNotDictionary", typ, err)
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
		_, err = dict.ImportLexicon(ctx, sqlDB, &pack)
		if !errors.Is(err, dict.ErrInvalidPack) {
			t.Fatalf("ImportLexicon of %s pack = %v, want ErrInvalidPack", format, err)
		}
		if !strings.Contains(err.Error(), format) {
			t.Errorf("ImportLexicon of %s pack = %v, want the error to name the format", format, err)
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

// TestImportSetsDictionaryLanguage pins that the registry row records the
// manifest's language (migration 027), for a code-pack language and a
// data-only one.
func TestImportSetsDictionaryLanguage(t *testing.T) {
	sqlDB := newDB(t)
	ctx := context.Background()
	importFixture(t, ctx, sqlDB)
	es, err := dict.LoadPack("../../../plugins/data/es-demo")
	if err != nil {
		t.Fatalf("load es-demo: %v", err)
	}
	if _, err := dict.ImportLexicon(ctx, sqlDB, &es); err != nil {
		t.Fatalf("import es-demo: %v", err)
	}
	for packID, want := range map[string]string{"mkgloss": "zh", "es-demo": "es"} {
		var got string
		if err := sqlDB.QueryRow(`SELECT language FROM dictionaries WHERE pack_id = ?`, packID).Scan(&got); err != nil || got != want {
			t.Errorf("%s language = %q (err %v), want %q", packID, got, err, want)
		}
	}
}
