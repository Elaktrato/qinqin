package db_test

import (
	"testing"

	"qinqin/internal/db"
)

// Migration 042 (#97): font_packs and font_slices for packs of type font.
func TestMigration042Fonts(t *testing.T) {
	sqlDB := open030(t)
	if err := db.MigrateThrough(sqlDB, "041_themes"); err != nil {
		t.Fatal(err)
	}
	if err := db.MigrateThrough(sqlDB, "042_fonts"); err != nil {
		t.Fatal(err)
	}
	if _, err := sqlDB.Exec(`INSERT INTO font_packs (pack_id, name, version, license, attribution, updated_at)
		VALUES ('p', 'P', '1', 'OFL-1.1', 'a', 't')`); err != nil {
		t.Fatal(err)
	}
	var notice string
	var deleted *string
	if err := sqlDB.QueryRow(`SELECT notice, deleted_at FROM font_packs WHERE pack_id = 'p'`).Scan(&notice, &deleted); err != nil || notice != "" || deleted != nil {
		t.Errorf("defaults notice %q deleted %v (%v)", notice, deleted, err)
	}
	ins := `INSERT INTO font_slices (pack_id, face, script, weight, style, original, sha, unicode_range, ord)
		VALUES ('p', 'sans', 'Hans', '400', 'normal', 'Noto Sans SC', ?, 'U+41', ?)`
	if _, err := sqlDB.Exec(ins, "aa", 0); err != nil {
		t.Fatal(err)
	}
	if _, err := sqlDB.Exec(ins, "bb", 0); err == nil {
		t.Error("two slices at one position of one face")
	}
	for _, q := range []string{
		`INSERT INTO font_packs (pack_id, name, version, license, attribution, updated_at) VALUES ('n', 'N', '1', NULL, 'a', 't')`,
		`INSERT INTO font_slices (pack_id, face, script, weight, style, original, sha, unicode_range, ord) VALUES ('p', 'sans', 'Hans', '400', 'normal', 'X', NULL, 'U+41', 1)`,
		`INSERT INTO font_slices (pack_id, face, script, weight, style, original, sha, unicode_range, ord) VALUES ('p', 'sans', 'Hans', '400', 'normal', 'X', 'cc', NULL, 1)`,
	} {
		if _, err := sqlDB.Exec(q); err == nil {
			t.Errorf("NULL accepted: %s", q)
		}
	}
	var idx int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_font_slices_sha'`).Scan(&idx); err != nil || idx != 1 {
		t.Errorf("idx_font_slices_sha: %d (%v)", idx, err)
	}
}
