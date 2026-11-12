package db_test

import (
	"context"
	"database/sql"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"qinqin/internal/db"
)

func openDB(t *testing.T) *sql.DB {
	t.Helper()
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	return sqlDB
}

// schemaNames returns the names of the schema objects of type (table,
// index), ascending.
func schemaNames(t *testing.T, sqlDB *sql.DB, typ string) []string {
	t.Helper()
	rows, err := sqlDB.Query(`SELECT name FROM sqlite_master WHERE type = ? ORDER BY name`, typ)
	if err != nil {
		t.Fatalf("list %ss: %v", typ, err)
	}
	defer rows.Close()
	var names []string
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			t.Fatal(err)
		}
		names = append(names, n)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return names
}

// TestDictionaryTables pins the final dictionary schema a fresh database
// reaches through every migration (017 drops the legacy tables and gives
// the lexicon tables their final names): the lexicon and frequency tables
// under their own names, no legacy-only table and no lx_ prefix left.
func TestDictionaryTables(t *testing.T) {
	sqlDB := openDB(t)
	tables := schemaNames(t, sqlDB, "table")
	for _, want := range []string{"entries", "forms", "readings", "senses", "entry_links", "frequency_packs", "frequency", "dictionaries"} {
		if !slices.Contains(tables, want) {
			t.Errorf("table %s missing; tables = %v", want, tables)
		}
	}
	for _, name := range append(tables, schemaNames(t, sqlDB, "index")...) {
		if strings.Contains(name, "lx_") || name == "entry_attrs" {
			t.Errorf("schema object %s left over", name)
		}
	}
	// The tables are the lexicon's, not the legacy ones: entries carry
	// ext_key, senses glosses, readings flags, entry_links no wordchar.
	for table, column := range map[string]string{"entries": "ext_key", "senses": "glosses", "readings": "flags", "forms": "text"} {
		var n int
		if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM pragma_table_info(?) WHERE name = ?`, table, column).Scan(&n); err != nil {
			t.Fatalf("columns of %s: %v", table, err)
		}
		if n != 1 {
			t.Errorf("%s.%s missing: %s is not the lexicon table", table, column, table)
		}
	}
	var linkSQL string
	if err := sqlDB.QueryRow(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'entry_links'`).Scan(&linkSQL); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(linkSQL, "wordchar") {
		t.Errorf("entry_links = %s, want the lexicon's (variant, radical) links", linkSQL)
	}
}

// TestDictionaryIndexes pins the index names the lookups' query plans
// assert, each on its table.
func TestDictionaryIndexes(t *testing.T) {
	sqlDB := openDB(t)
	for index, table := range map[string]string{
		"idx_entries_updated":     "entries",
		"idx_forms_text":          "forms",
		"idx_forms_entry":         "forms",
		"idx_readings_plain":      "readings",
		"idx_readings_entry":      "readings",
		"idx_senses_entry":        "senses",
		"idx_senses_dictionary":   "senses",
		"idx_senses_updated":      "senses",
		"idx_entry_links_to":      "entry_links",
		"idx_entry_links_updated": "entry_links",
		"idx_frequency_term":      "frequency",
		"idx_frequency_pack_term": "frequency",
	} {
		var n int
		if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = ? AND tbl_name = ?`, index, table).Scan(&n); err != nil {
			t.Fatalf("look up index %s: %v", index, err)
		}
		if n != 1 {
			t.Errorf("index %s on %s missing", index, table)
		}
	}
}

// TestForeignKeysResolve checks every REFERENCES clause names an existing
// table, so the schema holds with PRAGMA foreign_keys ON: level_members,
// sentences and user_edits reference entries(id), which must be the
// lexicon's entries table.
func TestForeignKeysResolve(t *testing.T) {
	sqlDB := openDB(t)
	tables := schemaNames(t, sqlDB, "table")
	for _, table := range tables {
		rows, err := sqlDB.Query(`SELECT "table" FROM pragma_foreign_key_list(?)`, table)
		if err != nil {
			t.Fatalf("foreign keys of %s: %v", table, err)
		}
		for rows.Next() {
			var parent string
			if err := rows.Scan(&parent); err != nil {
				t.Fatal(err)
			}
			if !slices.Contains(tables, parent) {
				t.Errorf("%s references missing table %s", table, parent)
			}
		}
		rows.Close()
	}
	ctx := context.Background()
	conn, err := sqlDB.Conn(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if _, err := conn.ExecContext(ctx, `PRAGMA foreign_keys = ON`); err != nil {
		t.Fatal(err)
	}
	// With enforcement on, a level member must point at a lexicon entry.
	for _, stmt := range []string{
		`INSERT INTO entries (id, language, kind, ext_key, updated_at) VALUES (1, 'zh', 'word', 'w', 't')`,
		`INSERT INTO schemes (id, pack_id, name, unit, language, version, license, attribution, updated_at) VALUES (1, 's', 'S', 'word', 'zh', '1', 'l', 'a', 't')`,
		`INSERT INTO levels (id, scheme_id, name, ord, updated_at) VALUES (1, 1, 'L1', 1, 't')`,
		`INSERT INTO level_members (level_id, entry_id, updated_at) VALUES (1, 1, 't')`,
	} {
		if _, err := conn.ExecContext(ctx, stmt); err != nil {
			t.Fatalf("%s: %v", stmt, err)
		}
	}
	if _, err := conn.ExecContext(ctx, `INSERT INTO level_members (level_id, entry_id, updated_at) VALUES (1, 99, 't')`); err == nil {
		t.Error("level member of a missing entry accepted with foreign_keys ON")
	}
	rows, err := conn.QueryContext(ctx, `PRAGMA foreign_key_check`)
	if err != nil {
		t.Fatalf("foreign_key_check: %v", err)
	}
	defer rows.Close()
	if rows.Next() {
		t.Error("foreign_key_check reports violations")
	}
}

// TestSynchronousModePerCommand pins the durability split: normal serving
// opens with synchronous=FULL (2); the seed path opens with NORMAL (1), the
// WAL bulk-import setting, because seeding is idempotent.
func TestSynchronousModePerCommand(t *testing.T) {
	dir := t.TempDir()

	read := func(name, path string) int {
		t.Helper()
		sqlDB, err := db.Open(path)
		if err != nil {
			t.Fatalf("db.Open(%s): %v", name, err)
		}
		t.Cleanup(func() { sqlDB.Close() })
		var mode int
		if err := sqlDB.QueryRow("PRAGMA synchronous").Scan(&mode); err != nil {
			t.Fatalf("PRAGMA synchronous on %s: %v", name, err)
		}
		return mode
	}
	if got := read("full", filepath.Join(dir, "full.db")); got != 2 {
		t.Errorf("db.Open synchronous = %d, want 2 (FULL)", got)
	}
	if got := read("seed", filepath.Join(dir, "seed.db")); got != 2 {
		t.Errorf("db.Open (second) synchronous = %d, want 2 (FULL)", got)
	}

	sqlDB, err := db.OpenForSeed(filepath.Join(dir, "seed-normal.db"))
	if err != nil {
		t.Fatalf("db.OpenForSeed: %v", err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	var mode int
	if err := sqlDB.QueryRow("PRAGMA synchronous").Scan(&mode); err != nil {
		t.Fatalf("PRAGMA synchronous on seed: %v", err)
	}
	if mode != 1 {
		t.Errorf("db.OpenForSeed synchronous = %d, want 1 (NORMAL)", mode)
	}
}
