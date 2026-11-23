package db_test

import (
	"testing"

	"qinqin/internal/db"
)

// Migration 043 (#176): lemma_rule_packs for packs of type lemma-rules, one
// row per pack with its rule table's raw bytes and their sha256.
func TestMigration043LemmaRules(t *testing.T) {
	sqlDB := open030(t)
	if err := db.MigrateThrough(sqlDB, "042_fonts"); err != nil {
		t.Fatal(err)
	}
	if err := db.MigrateThrough(sqlDB, "043_lemma_rules"); err != nil {
		t.Fatal(err)
	}
	if _, err := sqlDB.Exec(`INSERT INTO lemma_rule_packs (pack_id, name, version, language, license, attribution, rules_json, content_hash, updated_at)
		VALUES ('p', 'P', '1', 'ja', 'CC0-1.0', 'a', '{}', 'h', 't')`); err != nil {
		t.Fatal(err)
	}
	var notice string
	var deleted *string
	if err := sqlDB.QueryRow(`SELECT notice, deleted_at FROM lemma_rule_packs WHERE pack_id = 'p'`).Scan(&notice, &deleted); err != nil || notice != "" || deleted != nil {
		t.Errorf("defaults notice %q deleted %v (%v)", notice, deleted, err)
	}
	if _, err := sqlDB.Exec(`INSERT INTO lemma_rule_packs (pack_id, name, version, language, license, attribution, rules_json, content_hash, updated_at)
		VALUES ('p', 'Q', '1', 'ja', 'CC0-1.0', 'a', '{}', 'h', 't')`); err == nil {
		t.Error("a pack id stored twice")
	}
	for _, col := range []string{"name", "version", "language", "license", "attribution", "rules_json", "content_hash", "updated_at"} {
		if _, err := sqlDB.Exec(`UPDATE lemma_rule_packs SET ` + col + ` = NULL WHERE pack_id = 'p'`); err == nil {
			t.Errorf("NULL accepted in %s", col)
		}
	}
}
