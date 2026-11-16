package db_test

import (
	"context"
	"testing"

	"qinqin/internal/db"
)

// Migration 037 (#83): personal access tokens. Only the SHA-256 is stored
// (unique), the scope is read or write (never admin), and the schema holds
// with foreign keys enforced.
func TestMigration037AccessTokens(t *testing.T) {
	sqlDB := open030(t)
	if err := db.MigrateThrough(sqlDB, "037_access_tokens"); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name = 'access_tokens'`).Scan(&n); err != nil || n != 1 {
		t.Fatalf("table access_tokens missing (n=%d err=%v)", n, err)
	}
	for _, idx := range []string{"idx_access_tokens_user", "idx_access_tokens_workspace"} {
		if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name = ?`, idx).Scan(&n); err != nil || n != 1 {
			t.Errorf("index %s missing (n=%d err=%v)", idx, n, err)
		}
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
	if _, err := conn.ExecContext(ctx, `INSERT INTO users (id, username, hash, updated_at) VALUES (1, 'u', 'h', 't')`); err != nil {
		t.Fatal(err)
	}
	ins := func(hash, scope string, user int64) error {
		_, err := conn.ExecContext(ctx, `INSERT INTO access_tokens (user_id, name, token_hash, hint, scope, workspace_id, created_at, expires_at)
			VALUES (?, 'n', ?, 'abcdef', ?, NULL, 't', 't')`, user, hash, scope)
		return err
	}
	if err := ins("h1", "read", 1); err != nil {
		t.Fatal(err)
	}
	if err := ins("h2", "write", 1); err != nil {
		t.Fatal(err)
	}
	if ins("h3", "admin", 1) == nil {
		t.Error("scope admin accepted")
	}
	if ins("h1", "read", 1) == nil {
		t.Error("duplicate token_hash accepted")
	}
	if ins("h4", "read", 99) == nil {
		t.Error("token of a missing user accepted with foreign_keys ON")
	}
	var last any
	if err := conn.QueryRowContext(ctx, `SELECT last_used_at FROM access_tokens WHERE token_hash = 'h1'`).Scan(&last); err != nil || last != nil {
		t.Errorf("last_used_at = %v, %v; want NULL", last, err)
	}
}
