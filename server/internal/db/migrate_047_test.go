package db_test

import (
	"strings"
	"testing"

	"qinqin/internal/db"
)

// Migration 047 (#199): the switches of the four core features move from
// plugin_states to feature_switches; the plugin tables go.
func TestMigration047FeatureSwitches(t *testing.T) {
	sqlDB := open030(t)
	if err := db.MigrateThrough(sqlDB, "046_keyed_rows"); err != nil {
		t.Fatal(err)
	}
	for _, s := range []string{
		`INSERT INTO plugin_registry (pack_id, manifest_json, updated_at) VALUES ('qinqin-journal', '{}', 't'), ('heatmap', '{}', 't')`,
		`INSERT INTO plugin_states (user_id, pack_id, enabled, ord, updated_at) VALUES
			(1, 'qinqin-flashcards', 1, 0, '2026-11-20T10:00:00Z'), (1, 'qinqin-journal', 0, 3, '2026-11-20T11:00:00Z'),
			(2, 'qinqin-grammar', 0, 0, '2026-11-20T12:00:00Z'), (1, 'heatmap', 0, 1, 't'), (1, 'qinqin-core', 1, 0, 't')`,
		`INSERT INTO study_decks (user_id, workspace_id, id, name, created_at, source, version, updated_at, modified_at) VALUES
			(1, 5, 'd-plg-x', 'P', 'c', '{"type":"plugin","pluginId":"p","key":"k"}', 2, 'u', 'm'),
			(1, 5, 'd-lvl-x', 'L', 'c', '{"type":"level","packId":"hsk","level":"1"}', 2, 'u', 'm')`,
	} {
		if _, err := sqlDB.Exec(s); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.MigrateThrough(sqlDB, "047_features"); err != nil {
		t.Fatal(err)
	}
	rows, err := sqlDB.Query(`SELECT user_id || '|' || feature || '|' || enabled || '|' || updated_at FROM feature_switches ORDER BY user_id, feature`)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for rows.Next() {
		var s string
		rows.Scan(&s)
		got = append(got, s)
	}
	rows.Close()
	want := "1|flashcards|1|2026-11-20T10:00:00Z,1|journal|0|2026-11-20T11:00:00Z,2|grammar|0|2026-11-20T12:00:00Z"
	if strings.Join(got, ",") != want {
		t.Errorf("switches = %v, want %s", got, want)
	}
	var n int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE name IN ('plugin_states', 'plugin_registry')`).Scan(&n); err != nil || n != 0 {
		t.Errorf("plugin tables left: %d (%v)", n, err)
	}
	// A deck copied from a plugin keeps its cards and becomes a plain deck.
	var plain, level string
	if err := sqlDB.QueryRow(`SELECT COALESCE(source, 'null') FROM study_decks WHERE id = 'd-plg-x'`).Scan(&plain); err != nil || plain != "null" {
		t.Errorf("plugin deck source = %q (%v), want null", plain, err)
	}
	if err := sqlDB.QueryRow(`SELECT source FROM study_decks WHERE id = 'd-lvl-x'`).Scan(&level); err != nil || !strings.Contains(level, `"level"`) {
		t.Errorf("level deck source = %q (%v)", level, err)
	}
	if _, err := sqlDB.Exec(`INSERT INTO feature_switches VALUES (1, 'heatmap', 1, 't')`); err == nil {
		t.Error("an unknown feature accepted")
	}
}

// A messy populated database (#199 fix wave): every plugin state of several
// users, decks with and without sources; the migration never fails and copies
// one switch per user and feature.
func TestMigration047MessyRows(t *testing.T) {
	sqlDB := open030(t)
	if err := db.MigrateThrough(sqlDB, "046_keyed_rows"); err != nil {
		t.Fatal(err)
	}
	for _, s := range []string{
		`INSERT INTO plugin_states (user_id, pack_id, enabled, ord, updated_at) VALUES
			(1, 'qinqin-flashcards', 0, 9, 'x'), (1, 'qinqin-reader', 1, -3, ''), (1, 'qinqin-journal', 1, 0, 'y'), (1, 'qinqin-grammar', 0, 0, 'z'),
			(2, 'qinqin-flashcards', 1, 0, 'x'), (2, 'qinqin-core', 0, 0, 'x'), (2, 'qinqin-', 1, 0, 'x'), (2, 'qinqin-journalx', 1, 0, 'x')`,
		`INSERT INTO study_decks (user_id, workspace_id, id, name, created_at, source, version, updated_at, modified_at) VALUES
			(1, 5, 'd1', 'n', 'c', NULL, 1, 'u', 'm'), (1, 5, 'd2', 'n', 'c', '{"type":"plugin"}', 1, 'u', 'm'), (1, 5, 'd3', 'n', 'c', '{}', 1, 'u', 'm')`,
	} {
		if _, err := sqlDB.Exec(s); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.MigrateThrough(sqlDB, "047_features"); err != nil {
		t.Fatalf("migration 047 on messy rows: %v", err)
	}
	var n int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM feature_switches`).Scan(&n); err != nil || n != 5 {
		t.Errorf("%d switches (%v), want 5", n, err)
	}
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM study_decks WHERE source IS NULL`).Scan(&n); err != nil || n != 2 {
		t.Errorf("%d decks without a source (%v), want 2", n, err)
	}
}
