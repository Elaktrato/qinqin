package db_test

import (
	"testing"

	"qinqin/internal/db"
)

// Migration 041 (#96): theme_packs and themes for packs of type theme.
func TestMigration041Themes(t *testing.T) {
	sqlDB := open030(t)
	if err := db.MigrateThrough(sqlDB, "040_interface_language"); err != nil {
		t.Fatal(err)
	}
	if err := db.MigrateThrough(sqlDB, "041_themes"); err != nil {
		t.Fatal(err)
	}
	if _, err := sqlDB.Exec(`INSERT INTO theme_packs (pack_id, name, version, license, attribution, updated_at)
		VALUES ('p', 'P', '1', 'MIT', 'a', 't')`); err != nil {
		t.Fatal(err)
	}
	var notice, hash string
	if err := sqlDB.QueryRow(`SELECT notice, content_hash FROM theme_packs WHERE pack_id = 'p'`).Scan(&notice, &hash); err != nil || notice != "" || hash != "" {
		t.Errorf("defaults notice %q hash %q (%v)", notice, hash, err)
	}
	if _, err := sqlDB.Exec(`INSERT INTO themes (theme_id, pack_id, ord, data) VALUES ('a', 'p', 0, '{}')`); err != nil {
		t.Fatal(err)
	}
	if _, err := sqlDB.Exec(`INSERT INTO themes (theme_id, pack_id, ord, data) VALUES ('a', 'q', 0, '{}')`); err == nil {
		t.Error("a theme id stored twice")
	}
	for _, q := range []string{
		`INSERT INTO theme_packs (pack_id, name, version, license, attribution, updated_at) VALUES ('n', NULL, '1', 'MIT', 'a', 't')`,
		`INSERT INTO theme_packs (pack_id, name, version, license, attribution, updated_at) VALUES ('n', 'N', '1', NULL, 'a', 't')`,
		`INSERT INTO themes (theme_id, pack_id, ord, data) VALUES ('b', 'p', 1, NULL)`,
	} {
		if _, err := sqlDB.Exec(q); err == nil {
			t.Errorf("NULL accepted: %s", q)
		}
	}
	var idx int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_themes_pack'`).Scan(&idx); err != nil || idx != 1 {
		t.Errorf("idx_themes_pack: %d (%v)", idx, err)
	}
}
