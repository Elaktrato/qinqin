package db

import (
	"database/sql"
	"path/filepath"
	"strings"
	"testing"
)

// TestMigration018KeepsWorkspaceData runs migration 018 on a database
// that already holds workspaces, study events, plugin data and library
// books: every workspace keeps its id, user, language, settings and
// stamp (with the empty name), every dependent row still points at it,
// the foreign keys still name workspaces, and the unique key becomes
// (user_id, language, name).
func TestMigration018KeepsWorkspaceData(t *testing.T) {
	path := filepath.Join(t.TempDir(), "populated.db")
	sqlDB, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	if err := migrateThrough(sqlDB, "017_dictionary_final_names"); err != nil {
		t.Fatalf("migrate through 017: %v", err)
	}
	var applied018 int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM schema_migrations WHERE version LIKE '018%'`).Scan(&applied018); err != nil {
		t.Fatal(err)
	}
	if applied018 != 0 {
		t.Fatal("018 applied before the populated data was written")
	}

	for _, stmt := range []string{
		`INSERT INTO users (id, username, hash, admin, updated_at) VALUES (1, 'alice', 'h', 1, 't'), (2, 'bob', 'h', 0, 't')`,
		`INSERT INTO workspaces (id, user_id, language, settings, updated_at) VALUES
			(7, 1, 'zh', '{"theme":"dark"}', '2026-01-01T00:00:00Z'),
			(12, 1, 'ja', '{}', '2026-01-02T00:00:00Z'),
			(30, 2, 'zh', '{"font":"serif"}', '2026-01-03T00:00:00Z')`,
		`INSERT INTO study_events (id, user_id, workspace_id, device, ts, type, payload, updated_at) VALUES
			('e1', 1, 7, 'd', '2026-01-01T00:00:00Z', 'review', '{}', 't'),
			('e2', 1, 12, 'd', '2026-01-01T00:00:00Z', 'review', '{}', 't'),
			('e3', 2, 30, 'd', '2026-01-01T00:00:00Z', 'review', '{}', 't')`,
		`INSERT INTO plugin_data (pack_id, user_id, workspace_id, key, data, version, updated_at) VALUES
			('flashcards', 1, 7, 'decks', '[]', 3, 't'),
			('flashcards', 1, NULL, 'settings', '{}', 1, 't'),
			('flashcards', 2, 30, 'decks', '[1]', 2, 't')`,
		`INSERT INTO library_books (id, user_id, language, title, created_at) VALUES (4, 1, 'zh', 'Book', 't')`,
	} {
		if _, err := sqlDB.Exec(stmt); err != nil {
			t.Fatalf("%s: %v", stmt, err)
		}
	}

	// Through 043: migration 046 (#199) replaces plugin_data.
	if err := migrateThrough(sqlDB, "043_lemma_rules"); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	// Workspaces keep every column, gain the empty name.
	type wsRow struct {
		id, user                          int64
		language, name, settings, updated string
	}
	rows, err := sqlDB.Query(`SELECT id, user_id, language, name, settings, updated_at FROM workspaces ORDER BY id`)
	if err != nil {
		t.Fatalf("read workspaces: %v", err)
	}
	var got []wsRow
	for rows.Next() {
		var r wsRow
		if err := rows.Scan(&r.id, &r.user, &r.language, &r.name, &r.settings, &r.updated); err != nil {
			t.Fatal(err)
		}
		got = append(got, r)
	}
	rows.Close()
	want := []wsRow{
		{7, 1, "zh", "", `{"theme":"dark"}`, "2026-01-01T00:00:00Z"},
		{12, 1, "ja", "", `{}`, "2026-01-02T00:00:00Z"},
		{30, 2, "zh", "", `{"font":"serif"}`, "2026-01-03T00:00:00Z"},
	}
	if len(got) != len(want) {
		t.Fatalf("workspaces = %+v, want %+v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("workspace %d = %+v, want %+v", i, got[i], want[i])
		}
	}

	// Dependent rows survive and still join their workspace.
	for query, wantN := range map[string]int{
		`SELECT COUNT(*) FROM study_events se JOIN workspaces w ON w.id = se.workspace_id AND w.user_id = se.user_id`: 3,
		`SELECT COUNT(*) FROM plugin_data pd JOIN workspaces w ON w.id = pd.workspace_id AND w.user_id = pd.user_id`:  2,
		`SELECT COUNT(*) FROM plugin_data WHERE workspace_id IS NULL`:                                                 1,
		`SELECT COUNT(*) FROM library_books WHERE id = 4 AND user_id = 1`:                                             1,
	} {
		var n int
		if err := sqlDB.QueryRow(query).Scan(&n); err != nil {
			t.Fatalf("%s: %v", query, err)
		}
		if n != wantN {
			t.Errorf("%s = %d, want %d", query, n, wantN)
		}
	}

	// The foreign keys still name workspaces and hold.
	for _, table := range []string{"study_events", "plugin_data"} {
		var n int
		if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM pragma_foreign_key_list(?) WHERE "table" = 'workspaces' AND "from" = 'workspace_id'`, table).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 1 {
			t.Errorf("%s.workspace_id no longer references workspaces", table)
		}
	}
	fk, err := sqlDB.Query(`PRAGMA foreign_key_check`)
	if err != nil {
		t.Fatalf("foreign_key_check: %v", err)
	}
	if fk.Next() {
		t.Error("foreign_key_check reports violations after 018")
	}
	fk.Close()
	var leftover int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE name LIKE 'workspaces_%'`).Scan(&leftover); err != nil {
		t.Fatal(err)
	}
	if leftover != 0 {
		t.Error("rebuild left a workspaces_* object behind")
	}

	// The unique key is now (user_id, language, name).
	if _, err := sqlDB.Exec(`INSERT INTO workspaces (user_id, language, name, settings, updated_at) VALUES (1, 'zh', 'graded', '{}', 't')`); err != nil {
		t.Errorf("second named zh workspace rejected: %v", err)
	}
	if _, err := sqlDB.Exec(`INSERT INTO workspaces (user_id, language, name, settings, updated_at) VALUES (1, 'zh', '', '{}', 't')`); err == nil || !strings.Contains(err.Error(), "UNIQUE") {
		t.Errorf("duplicate (user, language, name) = %v, want a UNIQUE violation", err)
	}
	var newID int64
	if err := sqlDB.QueryRow(`SELECT id FROM workspaces WHERE name = 'graded'`).Scan(&newID); err != nil {
		t.Fatal(err)
	}
	if newID <= 30 {
		t.Errorf("new workspace id = %d, want above the preserved ids", newID)
	}
}

// TestOpenLeavesForeignKeysOff pins the assumption 018's table rebuild
// relies on: the connections Open hands out (and so the migration
// runner's) have foreign key enforcement off.
func TestOpenLeavesForeignKeysOff(t *testing.T) {
	sqlDB, err := Open(filepath.Join(t.TempDir(), "fk.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	var on int
	if err := sqlDB.QueryRow(`PRAGMA foreign_keys`).Scan(&on); err != nil {
		t.Fatal(err)
	}
	if on != 0 {
		t.Errorf("PRAGMA foreign_keys = %d, want 0: migration 018 drops a referenced table", on)
	}
}
