package db_test

import (
	"strings"
	"testing"

	"qinqin/internal/db"
)

// Migration 055 (#294): feature_switches loses the list of feature ids in its
// CHECK (the Go list features.IDs is the only one); the rows of a populated
// database survive with their rowids, the index comes back and enabled is
// still checked.
func TestMigration055FeatureSwitchesCheck(t *testing.T) {
	sqlDB := open030(t)
	if err := db.MigrateThrough(sqlDB, "054_sentence_credits"); err != nil {
		t.Fatal(err)
	}
	if _, err := sqlDB.Exec(`INSERT INTO feature_switches (user_id, feature, enabled, updated_at) VALUES
		(1, 'flashcards', 1, '2026-11-20T10:00:00Z'), (1, 'reader', 0, '2026-11-20T11:00:00Z'),
		(1, 'journal', 0, ''), (1, 'grammar', 1, 'x'),
		(2, 'grammar', 0, '2026-11-21T09:00:00Z'), (3, 'reader', 1, '2026-11-22T09:00:00Z')`); err != nil {
		t.Fatal(err)
	}
	if _, err := sqlDB.Exec(`DELETE FROM feature_switches WHERE user_id = 1 AND feature = 'reader'`); err != nil {
		t.Fatal(err) // a gap in the rowids, as on a real database
	}
	dump := func() string {
		t.Helper()
		rows, err := sqlDB.Query(`SELECT rowid || '|' || user_id || '|' || feature || '|' || enabled || '|' || updated_at FROM feature_switches ORDER BY rowid`)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		var got []string
		for rows.Next() {
			var s string
			rows.Scan(&s)
			got = append(got, s)
		}
		return strings.Join(got, ",")
	}
	before := dump()
	if _, err := sqlDB.Exec(`INSERT INTO feature_switches VALUES (1, 'scripts', 0, 't')`); err == nil {
		t.Fatal("before 055 scripts is already accepted; the test does not test the migration")
	}
	if err := db.MigrateThrough(sqlDB, "055_feature_switches_check"); err != nil {
		t.Fatalf("migration 055 on a populated database: %v", err)
	}
	if after := dump(); after != before {
		t.Errorf("rows after 055:\n%s\nwant\n%s", after, before)
	}
	if _, err := sqlDB.Exec(`INSERT INTO feature_switches VALUES (1, 'scripts', 0, 't'), (2, 'some-later-feature', 1, 't')`); err != nil {
		t.Errorf("a feature id outside the old list refused: %v", err)
	}
	if _, err := sqlDB.Exec(`INSERT INTO feature_switches VALUES (4, 'reader', 2, 't')`); err == nil {
		t.Error("enabled = 2 accepted")
	}
	if _, err := sqlDB.Exec(`INSERT INTO feature_switches VALUES (1, 'flashcards', 0, 't')`); err == nil {
		t.Error("a second row for (user, feature) accepted")
	}
	var n int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_feature_switches_updated' AND tbl_name = 'feature_switches'`).Scan(&n); err != nil || n != 1 {
		t.Errorf("index idx_feature_switches_updated: %d (%v)", n, err)
	}
	var sqlText string
	if err := sqlDB.QueryRow(`SELECT sql FROM sqlite_master WHERE name = 'feature_switches'`).Scan(&sqlText); err != nil || strings.Contains(sqlText, "'flashcards'") {
		t.Errorf("feature_switches still lists feature ids: %s (%v)", sqlText, err)
	}
}

// The full chain on an empty database ends with the same table.
func TestMigration055EmptyDatabase(t *testing.T) {
	sqlDB := open030(t)
	if err := db.Migrate(sqlDB); err != nil {
		t.Fatal(err)
	}
	if _, err := sqlDB.Exec(`INSERT INTO feature_switches VALUES (1, 'scripts', 0, 't')`); err != nil {
		t.Errorf("scripts refused on a fresh database: %v", err)
	}
}
