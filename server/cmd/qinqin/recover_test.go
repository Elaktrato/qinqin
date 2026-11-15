package main

import (
	"bytes"
	"context"
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/auth"
	"qinqin/internal/db"
)

func TestRecoverResetsPasswordAndSessions(t *testing.T) {
	dir := t.TempDir()
	sqlDB, err := db.Open(filepath.Join(dir, "qinqin.db"))
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	u, _ := auth.CreateUser(ctx, sqlDB, "alice", "old-password-123", false)
	auth.CreateUser(ctx, sqlDB, "bobby", "old-password-123", true)
	for i := 0; i < 2; i++ {
		auth.NewSession(ctx, sqlDB, u.ID, auth.LoginOptions{})
	}
	sqlDB.Exec(`UPDATE users SET disabled_at = '2020-01-01T00:00:00Z' WHERE id = ?`, u.ID)
	sqlDB.Close()

	var out bytes.Buffer
	args := []string{"--data", dir, "--username", "alice", "--enable", "--admin", "--reset-mfa"}
	if err := recoverCmd(args, strings.NewReader("brand-new-temp-1\n"), &out); err != nil {
		t.Fatalf("recover: %v", err)
	}
	if !strings.Contains(out.String(), "no two-factor data") {
		t.Errorf("output %q lacks the two-factor note", out.String())
	}
	sqlDB, _ = db.Open(filepath.Join(dir, "qinqin.db"))
	defer sqlDB.Close()
	var n, must, admin int
	var disabled *string
	sqlDB.QueryRow(`SELECT COUNT(*) FROM sessions WHERE user_id = ?`, u.ID).Scan(&n)
	sqlDB.QueryRow(`SELECT must_change_password, admin, disabled_at FROM users WHERE id = ?`, u.ID).Scan(&must, &admin, &disabled)
	if n != 0 || must != 1 || admin != 1 || disabled != nil {
		t.Errorf("sessions %d must %d admin %d disabled %v", n, must, admin, disabled)
	}
	res, err := auth.LoginWith(ctx, sqlDB, "alice", "brand-new-temp-1", auth.LoginOptions{})
	if err != nil || !res.User.MustChangePassword {
		t.Errorf("login with the new password: %+v %v", res.User, err)
	}
	var actor string
	sqlDB.QueryRow(`SELECT actor_name FROM auth_audit WHERE action = 'password_change_forced'`).Scan(&actor)
	if actor != "cli" {
		t.Errorf("audit actor = %q, want cli", actor)
	}
	if err := recoverCmd([]string{"--data", dir, "--username", "nobody"}, strings.NewReader("brand-new-temp-1\n"), &out); err == nil {
		t.Error("unknown user: want an error")
	}
	if err := recoverCmd([]string{"--data", dir, "--username", "alice"}, strings.NewReader("short\n"), &out); err == nil {
		t.Error("weak password: want an error")
	}
	// without --enable a disabled account stays disabled
	sqlDB.Exec(`UPDATE users SET disabled_at = '2020-01-01T00:00:00Z' WHERE username = 'bobby'`)
	if err := recoverCmd([]string{"--data", dir, "--username", "bobby"}, strings.NewReader("another-temp-pw-1\n"), &out); err != nil {
		t.Fatal(err)
	}
	var off *string
	sqlDB.QueryRow(`SELECT disabled_at FROM users WHERE username = 'bobby'`).Scan(&off)
	if off == nil {
		t.Error("recover without --enable re-enabled the account")
	}
}
