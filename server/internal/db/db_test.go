package db_test

import (
	"path/filepath"
	"testing"

	"qinqin/internal/db"
)

// Seeding runs as a second process (docker compose exec) against a
// database the server is reading; WAL lets readers proceed during a
// write, where the default rollback journal blocks them until the
// busy timeout fails them.
func TestOpenUsesWAL(t *testing.T) {
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	defer sqlDB.Close()
	var mode string
	if err := sqlDB.QueryRow(`PRAGMA journal_mode`).Scan(&mode); err != nil {
		t.Fatalf("read journal_mode: %v", err)
	}
	if mode != "wal" {
		t.Errorf("journal_mode = %q, want wal", mode)
	}
}
