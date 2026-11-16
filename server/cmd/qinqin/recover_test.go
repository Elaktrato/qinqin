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
	sqlDB.Exec(`INSERT INTO mfa_totp (user_id, secret_ct, secret_nonce, secret_fp, confirmed_at, created_at) VALUES (?, x'00', x'00', 'fp', 't', 't')`, u.ID)
	sqlDB.Exec(`INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES (?, 'h1'), (?, 'h2')`, u.ID, u.ID)
	sqlDB.Exec(`UPDATE users SET mfa_email = 1 WHERE id = ?`, u.ID)
	sqlDB.Exec(`INSERT INTO mfa_totp (user_id, secret_ct, secret_nonce, secret_fp, confirmed_at, created_at) VALUES (999, x'00', x'00', 'fp', 't', 't')`)
	sqlDB.Close()

	var out bytes.Buffer
	args := []string{"--data", dir, "--username", "alice", "--enable", "--admin", "--reset-mfa"}
	if err := recoverCmd(args, strings.NewReader("brand-new-temp-1\n"), &out); err != nil {
		t.Fatalf("recover: %v", err)
	}
	if !strings.Contains(out.String(), "authenticator, recovery codes and email codes") {
		t.Errorf("output %q lacks the two-factor note", out.String())
	}
	sqlDB, _ = db.Open(filepath.Join(dir, "qinqin.db"))
	defer sqlDB.Close()
	var totp, codes, mfaEmail, others, audit int
	sqlDB.QueryRow(`SELECT COUNT(*) FROM mfa_totp WHERE user_id = ?`, u.ID).Scan(&totp)
	sqlDB.QueryRow(`SELECT COUNT(*) FROM mfa_recovery_codes WHERE user_id = ?`, u.ID).Scan(&codes)
	sqlDB.QueryRow(`SELECT mfa_email FROM users WHERE id = ?`, u.ID).Scan(&mfaEmail)
	sqlDB.QueryRow(`SELECT COUNT(*) FROM mfa_totp WHERE user_id = 999`).Scan(&others)
	sqlDB.QueryRow(`SELECT COUNT(*) FROM auth_audit WHERE action = 'mfa_reset' AND actor_name = 'cli'`).Scan(&audit)
	if totp != 0 || codes != 0 || mfaEmail != 0 || others != 1 || audit != 1 {
		t.Errorf("--reset-mfa: totp=%d codes=%d mfa_email=%d other user's totp=%d audit=%d", totp, codes, mfaEmail, others, audit)
	}
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

func TestRecoverAdminOnDisabledNeedsEnable(t *testing.T) {
	dir := t.TempDir()
	sqlDB, _ := db.Open(filepath.Join(dir, "qinqin.db"))
	ctx := context.Background()
	u, _ := auth.CreateUser(ctx, sqlDB, "alice", "old-password-123", false)
	sqlDB.Exec(`UPDATE users SET disabled_at = '2020-01-01T00:00:00Z' WHERE id = ?`, u.ID)
	sqlDB.Exec(`INSERT INTO mfa_totp (user_id, secret_ct, secret_nonce, secret_fp, confirmed_at, created_at) VALUES (?, x'00', x'00', 'fp', 't', 't')`, u.ID)
	sqlDB.Exec(`INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES (?, 'h1'), (?, 'h2')`, u.ID, u.ID)
	sqlDB.Exec(`UPDATE users SET mfa_email = 1 WHERE id = ?`, u.ID)
	sqlDB.Exec(`INSERT INTO mfa_totp (user_id, secret_ct, secret_nonce, secret_fp, confirmed_at, created_at) VALUES (999, x'00', x'00', 'fp', 't', 't')`)
	sqlDB.Close()
	var out bytes.Buffer
	err := recoverCmd([]string{"--data", dir, "--username", "alice", "--admin"}, strings.NewReader("brand-new-temp-1\n"), &out)
	if err == nil || !strings.Contains(err.Error(), "--enable") {
		t.Fatalf("err = %v, want a refusal naming --enable", err)
	}
	sqlDB, _ = db.Open(filepath.Join(dir, "qinqin.db"))
	var admin int
	sqlDB.QueryRow(`SELECT admin FROM users WHERE id = ?`, u.ID).Scan(&admin)
	sqlDB.Close()
	if admin != 0 {
		t.Error("the refused run changed the account")
	}
	// without --admin a still-disabled account is recovered with a note
	out.Reset()
	if err := recoverCmd([]string{"--data", dir, "--username", "alice"}, strings.NewReader("brand-new-temp-1\n"), &out); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "still disabled") {
		t.Errorf("output %q lacks the still-disabled note", out.String())
	}
	if isTerminal(strings.NewReader("")) {
		t.Error("a string reader is no terminal")
	}
}
