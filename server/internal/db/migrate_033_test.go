package db_test

import (
	"testing"

	"qinqin/internal/db"
)

func TestMigration033InvitesAndResets(t *testing.T) {
	sqlDB := open030(t)
	if err := db.MigrateThrough(sqlDB, "033_invites_resets"); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"invites", "password_resets"} {
		var n int
		if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name = ?`, table).Scan(&n); err != nil || n != 1 {
			t.Errorf("table %s missing (n=%d err=%v)", table, n, err)
		}
	}
	var idx int
	sqlDB.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_password_resets_user'`).Scan(&idx)
	if idx != 1 {
		t.Error("idx_password_resets_user missing")
	}
	insert := func(maxUses int) error {
		_, err := sqlDB.Exec(`INSERT INTO invites (token_hash, max_uses, created_by, created_at) VALUES (hex(randomblob(8)), ?, 1, 't')`, maxUses)
		return err
	}
	for _, bad := range []int{0, 101, -1} {
		if err := insert(bad); err == nil {
			t.Errorf("max_uses %d accepted", bad)
		}
	}
	for _, ok := range []int{1, 100} {
		if err := insert(ok); err != nil {
			t.Errorf("max_uses %d refused: %v", ok, err)
		}
	}
	if _, err := sqlDB.Exec(`INSERT INTO password_resets (token_hash, user_id, created_at, expires_at) VALUES ('h', 1, 't', 't')`); err != nil {
		t.Fatal(err)
	}
	if _, err := sqlDB.Exec(`INSERT INTO password_resets (token_hash, user_id, created_at, expires_at) VALUES ('h', 2, 't', 't')`); err == nil {
		t.Error("duplicate reset token hash accepted")
	}
}
