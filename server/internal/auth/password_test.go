package auth_test

import (
	"context"
	"path/filepath"
	"testing"

	"qinqin/internal/auth"
	"qinqin/internal/db"
)

func TestChangePasswordIsOneTransaction(t *testing.T) {
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	ctx := context.Background()
	u, _ := auth.CreateUser(ctx, sqlDB, "alice", "secret-pass-1", false)
	keep, _ := auth.NewSession(ctx, sqlDB, u.ID, auth.LoginOptions{})
	for i := 0; i < 2; i++ {
		auth.NewSession(ctx, sqlDB, u.ID, auth.LoginOptions{})
	}
	sqlDB.Exec(`UPDATE users SET must_change_password = 1, must_change_set_at = 't' WHERE id = ?`, u.ID)
	var keepID int64
	sqlDB.QueryRow(`SELECT id FROM sessions WHERE token_hash = ?`, auth.HashTokenForTest(keep)).Scan(&keepID)

	newHash := auth.Hash("a-brand-new-password")
	if err := auth.ChangePassword(ctx, sqlDB, u.ID, newHash, keepID, true); err != nil {
		t.Fatal(err)
	}
	var must int
	var setAt, changedAt, hash *string
	sqlDB.QueryRow(`SELECT must_change_password, must_change_set_at, password_changed_at, hash FROM users WHERE id = ?`, u.ID).Scan(&must, &setAt, &changedAt, &hash)
	if must != 0 || setAt != nil || changedAt == nil || *hash != newHash {
		t.Errorf("user = must %d set %v changed %v", must, setAt, changedAt)
	}
	var n int
	sqlDB.QueryRow(`SELECT COUNT(*) FROM sessions WHERE user_id = ?`, u.ID).Scan(&n)
	if n != 1 {
		t.Errorf("sessions left = %d, want only the caller's", n)
	}
	var action, detail string
	if err := sqlDB.QueryRow(`SELECT action, detail FROM auth_audit`).Scan(&action, &detail); err != nil || action != "password_changed" {
		t.Errorf("audit = %q, %v", action, err)
	}
	if !auth.Verify(*hash, "a-brand-new-password") {
		t.Error("stored hash does not verify the new password")
	}
}

func TestVerifyUserPassword(t *testing.T) {
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	ctx := context.Background()
	u, _ := auth.CreateUser(ctx, sqlDB, "alice", "secret-pass-1", false)
	if ok, err := auth.VerifyUserPassword(ctx, sqlDB, u.ID, "secret-pass-1"); !ok || err != nil {
		t.Errorf("right password: %v %v", ok, err)
	}
	if ok, _ := auth.VerifyUserPassword(ctx, sqlDB, u.ID, "wrong-password"); ok {
		t.Error("wrong password verified")
	}
}
