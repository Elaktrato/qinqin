package db

import "testing"

// TestMigration027BackfillsDictionaryLanguage derives an existing
// dictionary's language from one of its live senses' entries; a dictionary
// without senses stays ”. It also creates the sentence-pack registry.
func TestMigration027BackfillsDictionaryLanguage(t *testing.T) {
	sqlDB := openMigrationDB(t)
	if err := migrateThrough(sqlDB, "025_journal_ai"); err != nil {
		t.Fatalf("migrate through 025: %v", err)
	}
	for _, stmt := range []string{
		`INSERT INTO dictionaries (id, pack_id, name, version, license, attribution, updated_at) VALUES (1, 'with-senses', 'A', 'v', 'L', 'A', 't')`,
		`INSERT INTO dictionaries (id, pack_id, name, version, license, attribution, updated_at) VALUES (2, 'empty', 'B', 'v', 'L', 'A', 't')`,
		`INSERT INTO entries (id, language, kind, ext_key, updated_at) VALUES (10, 'zh', 'word', 'k', 't')`,
		`INSERT INTO senses (entry_id, dictionary_id, ord, updated_at) VALUES (10, 1, 0, 't')`,
	} {
		if _, err := sqlDB.Exec(stmt); err != nil {
			t.Fatalf("%s: %v", stmt, err)
		}
	}
	if err := migrateThrough(sqlDB, "027_pack_registry"); err != nil {
		t.Fatalf("migrate through 027: %v", err)
	}
	for id, want := range map[int]string{1: "zh", 2: ""} {
		var got string
		if err := sqlDB.QueryRow(`SELECT language FROM dictionaries WHERE id = ?`, id).Scan(&got); err != nil || got != want {
			t.Errorf("dictionary %d language = %q (err %v), want %q", id, got, err, want)
		}
	}
	if _, err := sqlDB.Exec(`INSERT INTO sentence_packs (pack_id, name, version, language, license, attribution, updated_at) VALUES ('p', 'n', 'v', 'zh', 'L', 'A', 't')`); err != nil {
		t.Fatalf("insert sentence_packs: %v", err)
	}
	var notice string
	if err := sqlDB.QueryRow(`SELECT notice FROM sentence_packs WHERE pack_id = 'p'`).Scan(&notice); err != nil || notice != "" {
		t.Errorf("notice default = %q (err %v), want ''", notice, err)
	}
}
