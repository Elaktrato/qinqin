package db

import (
	"database/sql"
	"path/filepath"
	"testing"
)

// noticeTables are the pack registries migration 024 adds notice to.
var noticeTables = []string{"dictionaries", "frequency_packs", "schemes"}

func openMigrationDB(t *testing.T) *sql.DB {
	t.Helper()
	path := filepath.Join(t.TempDir(), "m024.db")
	sqlDB, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	return sqlDB
}

// TestMigration024AddsNoticeToPopulatedRegistries runs migration 024 on
// a database with installed packs: every existing row and column is
// unchanged and the new notice column is empty.
func TestMigration024AddsNoticeToPopulatedRegistries(t *testing.T) {
	sqlDB := openMigrationDB(t)
	if err := migrateThrough(sqlDB, "023_library_books_autoincrement"); err != nil {
		t.Fatalf("migrate through 023: %v", err)
	}
	for _, stmt := range []string{
		`INSERT INTO dictionaries (id, pack_id, name, version, license, attribution, updated_at) VALUES (2, 'cedict', 'CC-CEDICT', 'v1', 'CC BY-SA 4.0', 'MDBG', 't1')`,
		`INSERT INTO dictionaries (id, pack_id, name, version, license, attribution, updated_at, deleted_at) VALUES (5, 'old', 'Old', 'v0', 'MIT', 'x', 't2', 't3')`,
		`INSERT INTO frequency_packs (id, pack_id, name, version, language, license, attribution, ord, content_hash, updated_at) VALUES (3, 'jiten-frequency', 'Jiten', 'v2', 'ja', 'CC BY-SA 4.0', 'Jiten', 1, 'abc', 't4')`,
		`INSERT INTO schemes (id, pack_id, name, unit, language, version, license, attribution, updated_at) VALUES (4, 'hsk-words', 'HSK', 'word', 'zh', 'v3', 'L', 'A', 't5')`,
	} {
		if _, err := sqlDB.Exec(stmt); err != nil {
			t.Fatalf("%s: %v", stmt, err)
		}
	}
	snapshots := map[string]string{
		"dictionaries":    `SELECT id || '|' || pack_id || '|' || name || '|' || version || '|' || license || '|' || attribution || '|' || updated_at || '|' || COALESCE(deleted_at, '-') FROM dictionaries ORDER BY id`,
		"frequency_packs": `SELECT id || '|' || pack_id || '|' || name || '|' || version || '|' || language || '|' || license || '|' || attribution || '|' || ord || '|' || content_hash || '|' || updated_at || '|' || COALESCE(deleted_at, '-') FROM frequency_packs ORDER BY id`,
		"schemes":         `SELECT id || '|' || pack_id || '|' || name || '|' || unit || '|' || language || '|' || version || '|' || license || '|' || attribution || '|' || updated_at || '|' || COALESCE(deleted_at, '-') FROM schemes ORDER BY id`,
	}
	snapshot := func() map[string][]string {
		out := map[string][]string{}
		for table, q := range snapshots {
			rows, err := sqlDB.Query(q)
			if err != nil {
				t.Fatal(err)
			}
			for rows.Next() {
				var s string
				if err := rows.Scan(&s); err != nil {
					t.Fatal(err)
				}
				out[table] = append(out[table], s)
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
	for _, table := range noticeTables {
		if len(before[table]) == 0 || len(after[table]) != len(before[table]) {
			t.Fatalf("%s: rows before %v after %v", table, before[table], after[table])
		}
		for i := range before[table] {
			if before[table][i] != after[table][i] {
				t.Errorf("%s row %d: %q became %q", table, i, before[table][i], after[table][i])
			}
		}
		var n int
		if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM ` + table + ` WHERE notice <> ''`).Scan(&n); err != nil {
			t.Fatalf("%s: read notice: %v", table, err)
		}
		if n != 0 {
			t.Errorf("%s: %d rows with a non-empty notice after the migration, want 0", table, n)
		}
	}
}

// TestMigration024OnEmptyDatabase migrates a fresh database: the column
// exists, defaults to the empty string and refuses NULL.
func TestMigration024OnEmptyDatabase(t *testing.T) {
	sqlDB := openMigrationDB(t)
	if err := migrate(sqlDB); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if _, err := sqlDB.Exec(`INSERT INTO dictionaries (pack_id, name, version, license, attribution, updated_at) VALUES ('d', 'D', '1', 'L', 'A', 't')`); err != nil {
		t.Fatal(err)
	}
	if _, err := sqlDB.Exec(`INSERT INTO frequency_packs (pack_id, name, version, language, license, attribution, ord, updated_at) VALUES ('f', 'F', '1', 'ja', 'L', 'A', 1, 't')`); err != nil {
		t.Fatal(err)
	}
	if _, err := sqlDB.Exec(`INSERT INTO schemes (pack_id, name, unit, language, version, license, attribution, updated_at) VALUES ('s', 'S', 'word', 'zh', '1', 'L', 'A', 't')`); err != nil {
		t.Fatal(err)
	}
	for _, table := range noticeTables {
		var notice string
		if err := sqlDB.QueryRow(`SELECT notice FROM ` + table).Scan(&notice); err != nil {
			t.Fatalf("%s: %v", table, err)
		}
		if notice != "" {
			t.Errorf("%s: default notice %q, want ''", table, notice)
		}
		if _, err := sqlDB.Exec(`UPDATE ` + table + ` SET notice = NULL`); err == nil {
			t.Errorf("%s: NULL notice accepted", table)
		}
	}
}
