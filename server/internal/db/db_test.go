package db_test

import (
	"path/filepath"
	"testing"

	"qinqin/internal/db"
)

// TestLexiconTables pins the lexicon schema migration 014 creates.
func TestLexiconTables(t *testing.T) {
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	for _, table := range []string{"lx_entries", "lx_forms", "lx_readings", "lx_senses", "lx_links"} {
		var n int
		if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, table).Scan(&n); err != nil {
			t.Fatalf("look up table %s: %v", table, err)
		}
		if n != 1 {
			t.Errorf("table %s missing", table)
		}
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
