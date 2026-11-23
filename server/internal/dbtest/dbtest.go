// Package dbtest gives Go tests a migrated SQLite database in the time of a
// file write. The first Open in a test process migrates one template
// database (all migrations, via db.Open) and keeps its bytes; every Open
// writes those bytes to a file of its own in t.TempDir() and opens it with
// db.Open, which finds every migration applied. Each test still gets an
// isolated database.
//
// Tests that exercise the migrations themselves (internal/db and its frozen
// steps, and compatibility tests that build an older schema with
// db.OpenThrough) keep running real migrations; see
// docs/architecture/0005-test-conventions.md.
package dbtest

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"qinqin/internal/db"
)

var (
	once        sync.Once
	template    []byte
	templateErr error
	// templateBuilds counts the template migrations of this process (a test
	// checks that it stays 1).
	templateBuilds int
)

// buildTemplate migrates a database in a scratch directory and returns a
// compact single-file copy of it (VACUUM INTO, so no WAL is left behind).
func buildTemplate() ([]byte, error) {
	templateBuilds++
	dir, err := os.MkdirTemp("", "qinqin-dbtest-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	sqlDB, err := db.Open(filepath.Join(dir, "migrated.db"))
	if err != nil {
		return nil, err
	}
	out := filepath.Join(dir, "template.db")
	if _, err := sqlDB.Exec(`VACUUM INTO ?`, out); err != nil {
		sqlDB.Close()
		return nil, fmt.Errorf("vacuum into template: %w", err)
	}
	if err := sqlDB.Close(); err != nil {
		return nil, err
	}
	return os.ReadFile(out)
}

func templateBytes(t testing.TB) []byte {
	t.Helper()
	once.Do(func() { template, templateErr = buildTemplate() })
	if templateErr != nil {
		t.Fatalf("dbtest: migrate the template database: %v", templateErr)
	}
	return template
}

// File writes a migrated database file at path (its directory must exist)
// without opening it, for code under test that opens path itself (the
// serve, seed and backup commands).
func File(t testing.TB, path string) {
	t.Helper()
	if err := os.WriteFile(path, templateBytes(t), 0o644); err != nil {
		t.Fatalf("dbtest: write %s: %v", path, err)
	}
}

// OpenPath is Open plus the database file's path, for tests that close and
// reopen it or hand the path to other code.
func OpenPath(t testing.TB) (*sql.DB, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "qinqin.db")
	File(t, path)
	sqlDB, err := db.Open(path)
	if err != nil {
		t.Fatalf("dbtest: open %s: %v", path, err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	return sqlDB, path
}

// Open returns a migrated database of the test's own, closed when the test
// ends.
func Open(t testing.TB) *sql.DB {
	t.Helper()
	sqlDB, _ := OpenPath(t)
	return sqlDB
}
