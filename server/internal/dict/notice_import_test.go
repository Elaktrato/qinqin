package dict_test

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/dict"
)

// dictionaryRow reads the notice and updated_at of the dictionary
// installed from packID.
func dictionaryRow(t *testing.T, sqlDB *sql.DB, packID string) (notice, updated string) {
	t.Helper()
	if err := sqlDB.QueryRow(`SELECT notice, updated_at FROM dictionaries WHERE pack_id = ?`, packID).
		Scan(&notice, &updated); err != nil {
		t.Fatalf("dictionary %s: %v", packID, err)
	}
	return notice, updated
}

func fixtureDictionary(t *testing.T) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(fixturePack, "dictionary.json"))
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func importNoticeDir(t *testing.T, sqlDB *sql.DB, dir string) {
	t.Helper()
	pack, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatalf("LoadPack: %v", err)
	}
	if _, err := dict.ImportLexicon(context.Background(), sqlDB, &pack); err != nil {
		t.Fatalf("ImportLexicon: %v", err)
	}
}

// A pack without a notice stores the empty string; one with a notice stores it
// (trimmed); an identical re-import restamps nothing; a changed notice
// updates the row and its updated_at.
func TestImportStoresNoticeWithoutRestamp(t *testing.T) {
	sqlDB := dbtest.Open(t)
	importFixture(t, context.Background(), sqlDB)
	if notice, _ := dictionaryRow(t, sqlDB, fixtureManifest.ID); notice != "" {
		t.Errorf("pack without notice: notice = %q, want ''", notice)
	}

	m := fixtureManifest
	m.Notice = "  Approximate, see [the list](https://example.com/list).\n\nSecond paragraph.\n"
	want := "Approximate, see [the list](https://example.com/list).\n\nSecond paragraph."
	dictionary := fixtureDictionary(t)
	importNoticeDir(t, sqlDB, writePack(t, m, dictionary))
	notice, _ := dictionaryRow(t, sqlDB, m.ID)
	if notice != want {
		t.Errorf("notice = %q, want %q", notice, want)
	}

	const sentinel = "2000-01-01T00:00:00Z"
	if _, err := sqlDB.Exec(`UPDATE dictionaries SET updated_at = ?`, sentinel); err != nil {
		t.Fatal(err)
	}
	importNoticeDir(t, sqlDB, writePack(t, m, dictionary))
	if _, updated := dictionaryRow(t, sqlDB, m.ID); updated != sentinel {
		t.Errorf("identical re-import restamped the dictionary: updated_at = %q", updated)
	}

	m.Notice = "Changed notice."
	importNoticeDir(t, sqlDB, writePack(t, m, dictionary))
	notice, updated := dictionaryRow(t, sqlDB, m.ID)
	if notice != "Changed notice." {
		t.Errorf("changed notice not stored: %q", notice)
	}
	if updated == sentinel {
		t.Error("a changed notice did not restamp the dictionary row")
	}

	m.Notice = ""
	importNoticeDir(t, sqlDB, writePack(t, m, dictionary))
	if notice, _ := dictionaryRow(t, sqlDB, m.ID); notice != "" {
		t.Errorf("removed notice still stored: %q", notice)
	}
}

// An invalid notice rejects the pack before anything is written, both
// when loading it and when a pack reaches the importer directly.
func TestImportRejectsInvalidNotice(t *testing.T) {
	sqlDB := dbtest.Open(t)
	m := fixtureManifest
	m.Notice = "[click](javascript:alert)"
	dir := writePack(t, m, fixtureDictionary(t))
	if _, err := dict.LoadPack(dir); !errors.Is(err, dict.ErrInvalidPack) {
		t.Errorf("LoadPack with a javascript: link = %v, want ErrInvalidPack", err)
	}
	pack := dict.Pack{Manifest: m, Dir: dir}
	if _, err := dict.ImportLexicon(context.Background(), sqlDB, &pack); !errors.Is(err, dict.ErrInvalidPack) {
		t.Errorf("ImportLexicon with a javascript: link = %v, want ErrInvalidPack", err)
	}
	if n := totalRows(t, sqlDB, "dictionaries"); n != 0 {
		t.Errorf("%d dictionaries written by a rejected pack, want 0", n)
	}
}
