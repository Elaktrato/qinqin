package pack_test

import (
	"context"
	"database/sql"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/pack"
)

// upsertDB is a migrated database with a registry table of its own (an
// INTEGER id, an insert-only ord and created_at) on one connection, so
// total_changes() counts what the upserts wrote.
func upsertDB(t *testing.T) *sql.DB {
	t.Helper()
	sqlDB := dbtest.Open(t)
	sqlDB.SetMaxOpenConns(1)
	if _, err := sqlDB.Exec(`CREATE TABLE test_packs (id INTEGER PRIMARY KEY, pack_id TEXT NOT NULL UNIQUE,
		name TEXT NOT NULL, notice TEXT NOT NULL DEFAULT '', ord INTEGER NOT NULL, created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL, deleted_at TEXT)`); err != nil {
		t.Fatal(err)
	}
	return sqlDB
}

func upsert(t *testing.T, sqlDB *sql.DB, packID, name, stamp string, force bool) (int64, bool) {
	t.Helper()
	tx, err := sqlDB.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	id, changed, err := pack.UpsertRegistry(context.Background(), tx, pack.Registry{
		Table: "test_packs", PackID: packID, Stamp: stamp, Force: force,
		Columns: []pack.Column{
			{Name: "name", Value: name},
			{Name: "notice", Value: "N."},
			{Name: "ord", Expr: "(SELECT COALESCE(MAX(ord), 0) + 1 FROM test_packs)", InsertOnly: true},
			{Name: "created_at", Value: stamp, InsertOnly: true},
		},
	})
	if err != nil {
		t.Fatalf("UpsertRegistry: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	return id, changed
}

func changes(t *testing.T, sqlDB *sql.DB) int64 {
	t.Helper()
	var n int64
	if err := sqlDB.QueryRow(`SELECT total_changes()`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

type row struct {
	name, created, updated string
	ord                    int
	deleted                sql.NullString
}

func readRow(t *testing.T, sqlDB *sql.DB, packID string) row {
	t.Helper()
	var r row
	if err := sqlDB.QueryRow(`SELECT name, ord, created_at, updated_at, deleted_at FROM test_packs WHERE pack_id = ?`, packID).
		Scan(&r.name, &r.ord, &r.created, &r.updated, &r.deleted); err != nil {
		t.Fatal(err)
	}
	return r
}

// UpsertRegistry inserts a new row, writes nothing for an unchanged one,
// updates and restamps a changed one, revives an uninstalled one, never
// touches an insert-only column again, and rewrites when forced.
func TestUpsertRegistry(t *testing.T) {
	sqlDB := upsertDB(t)
	id, changed := upsert(t, sqlDB, "a", "A", "2026-01-01T00:00:00Z", false)
	if !changed || id == 0 {
		t.Fatalf("insert: id %d, changed %v", id, changed)
	}
	upsert(t, sqlDB, "b", "B", "2026-01-01T00:00:00Z", false)
	if r := readRow(t, sqlDB, "b"); r.ord != 2 {
		t.Errorf("second pack ord %d, want 2", r.ord)
	}

	before := changes(t, sqlDB)
	again, changed := upsert(t, sqlDB, "a", "A", "2026-02-02T00:00:00Z", false)
	if changed || again != id || changes(t, sqlDB) != before {
		t.Errorf("unchanged: id %d (want %d), changed %v, %d rows written", again, id, changed, changes(t, sqlDB)-before)
	}
	if r := readRow(t, sqlDB, "a"); r.updated != "2026-01-01T00:00:00Z" {
		t.Errorf("unchanged row restamped: %+v", r)
	}

	again, changed = upsert(t, sqlDB, "a", "A2", "2026-03-03T00:00:00Z", false)
	r := readRow(t, sqlDB, "a")
	if !changed || again != id || r.name != "A2" || r.updated != "2026-03-03T00:00:00Z" || r.ord != 1 || r.created != "2026-01-01T00:00:00Z" {
		t.Errorf("changed: id %d, changed %v, row %+v", again, changed, r)
	}

	if _, err := sqlDB.Exec(`UPDATE test_packs SET deleted_at = 'x' WHERE pack_id = 'a'`); err != nil {
		t.Fatal(err)
	}
	if _, changed = upsert(t, sqlDB, "a", "A2", "2026-04-04T00:00:00Z", false); !changed || readRow(t, sqlDB, "a").deleted.Valid {
		t.Errorf("uninstalled row not revived: changed %v, %+v", changed, readRow(t, sqlDB, "a"))
	}

	if _, changed = upsert(t, sqlDB, "a", "A2", "2026-05-05T00:00:00Z", true); !changed || readRow(t, sqlDB, "a").updated != "2026-05-05T00:00:00Z" {
		t.Errorf("forced: changed %v, %+v", changed, readRow(t, sqlDB, "a"))
	}
}
