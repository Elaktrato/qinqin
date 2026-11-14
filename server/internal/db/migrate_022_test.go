package db

import (
	"database/sql"
	"path/filepath"
	"testing"
)

// TestMigration022NeverReusesWorkspaceIds runs migration 022 on a
// database with workspaces and their children: ids, rows and the unique
// key are unchanged, and after the highest-id workspace is deleted a new
// workspace gets a fresh id instead of the deleted one, so stale client
// data and orphans of a deleted workspace can never attach to a new one.
func TestMigration022NeverReusesWorkspaceIds(t *testing.T) {
	path := filepath.Join(t.TempDir(), "populated.db")
	sqlDB, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	if err := migrateThrough(sqlDB, "021_library_highlights"); err != nil {
		t.Fatalf("migrate through 021: %v", err)
	}
	for _, stmt := range []string{
		`INSERT INTO users (id, username, hash, admin, updated_at) VALUES (1, 'alice', 'h', 1, 't')`,
		`INSERT INTO workspaces (id, user_id, language, name, settings, updated_at) VALUES (3, 1, 'zh', '', '{"a":1}', 't1')`,
		`INSERT INTO workspaces (id, user_id, language, name, settings, updated_at) VALUES (7, 1, 'ja', 'work', '{}', 't2')`,
		`INSERT INTO study_events (id, user_id, workspace_id, device, ts, type, payload, updated_at) VALUES ('e1', 1, 7, 'web', 't', 'review', '{}', 't')`,
		`INSERT INTO plugin_data (pack_id, user_id, workspace_id, key, data, version, updated_at) VALUES ('p', 1, 3, 'k', '{}', 1, 't')`,
		`INSERT INTO library_books (id, user_id, workspace_id, language, title, created_at) VALUES (4, 1, 7, 'ja', 'Book', 't')`,
	} {
		if _, err := sqlDB.Exec(stmt); err != nil {
			t.Fatalf("%s: %v", stmt, err)
		}
	}
	snapshot := func() []string {
		var out []string
		for _, q := range []string{
			`SELECT id || '|' || user_id || '|' || language || '|' || name || '|' || settings || '|' || updated_at FROM workspaces ORDER BY id`,
			`SELECT id || '|' || workspace_id FROM study_events ORDER BY id`,
			`SELECT key || '|' || workspace_id FROM plugin_data ORDER BY key`,
			`SELECT id || '|' || workspace_id FROM library_books ORDER BY id`,
		} {
			rows, err := sqlDB.Query(q)
			if err != nil {
				t.Fatal(err)
			}
			for rows.Next() {
				var s string
				if err := rows.Scan(&s); err != nil {
					t.Fatal(err)
				}
				out = append(out, s)
			}
			rows.Close()
		}
		return out
	}
	before := snapshot()
	if err := migrate(sqlDB); err != nil {
		t.Fatalf("migrate to latest: %v", err)
	}
	after := snapshot()
	if len(before) != 5 || len(after) != len(before) {
		t.Fatalf("rows before %v after %v", before, after)
	}
	for i := range before {
		if before[i] != after[i] {
			t.Errorf("row %d: %q became %q", i, before[i], after[i])
		}
	}

	// The unique key survives the rebuild.
	if _, err := sqlDB.Exec(`INSERT INTO workspaces (user_id, language, name, settings, updated_at) VALUES (1, 'ja', 'work', '{}', 't')`); err == nil {
		t.Error("duplicate (user, language, name) accepted after 022")
	}

	// Deleting the highest id and creating again must not hand out 7.
	if _, err := sqlDB.Exec(`DELETE FROM workspaces WHERE id = 7`); err != nil {
		t.Fatal(err)
	}
	var id int64
	if err := sqlDB.QueryRow(`INSERT INTO workspaces (user_id, language, name, settings, updated_at)
		VALUES (1, 'ja', '', '{}', 't') RETURNING id`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if id <= 7 {
		t.Errorf("new workspace id = %d, want > 7 (deleted ids are never reused)", id)
	}
}
