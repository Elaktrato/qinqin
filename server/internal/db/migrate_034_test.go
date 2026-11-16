package db_test

import (
	"testing"

	"qinqin/internal/db"
)

func TestMigration034MFAAndMail(t *testing.T) {
	sqlDB := open030(t)
	if err := db.MigrateThrough(sqlDB, "034_mfa_mail"); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"smtp_settings", "mfa_totp", "mfa_recovery_codes", "auth_challenges"} {
		var n int
		if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name = ?`, table).Scan(&n); err != nil || n != 1 {
			t.Errorf("table %s missing (n=%d err=%v)", table, n, err)
		}
	}
	// users.mfa_email defaults to off
	if _, err := sqlDB.Exec(`INSERT INTO users (username, hash, updated_at) VALUES ('u', 'h', 't')`); err != nil {
		t.Fatal(err)
	}
	var email int
	if err := sqlDB.QueryRow(`SELECT mfa_email FROM users WHERE username='u'`).Scan(&email); err != nil || email != 0 {
		t.Errorf("mfa_email = %d, %v", email, err)
	}
	// smtp_settings is a single row and the TLS mode is constrained
	ins := func(id int, mode string) error {
		_, err := sqlDB.Exec(`INSERT INTO smtp_settings (id, host, port, tls_mode, from_address, public_url, updated_at) VALUES (?, 'h', 587, ?, 'a@b.c', 'http://x', 't')`, id, mode)
		return err
	}
	if ins(2, "starttls") == nil {
		t.Error("second smtp_settings row accepted")
	}
	if ins(1, "ssl") == nil {
		t.Error("tls mode ssl accepted")
	}
	if err := ins(1, "tls"); err != nil {
		t.Error(err)
	}
	// recovery code hashes are unique; one totp row per user
	for i := 0; i < 2; i++ {
		_, err := sqlDB.Exec(`INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES (1, 'x')`)
		if (err == nil) != (i == 0) {
			t.Errorf("recovery code insert %d: %v", i, err)
		}
	}
	for i := 0; i < 2; i++ {
		_, err := sqlDB.Exec(`INSERT INTO mfa_totp (user_id, created_at) VALUES (1, 't')`)
		if (err == nil) != (i == 0) {
			t.Errorf("mfa_totp insert %d: %v", i, err)
		}
	}
	if _, err := sqlDB.Exec(`INSERT INTO auth_challenges (token_hash, kind, code_hash, expires_at, created_at) VALUES ('t', 'bogus', '', 't', 't')`); err == nil {
		t.Error("challenge kind bogus accepted")
	}
	if _, err := sqlDB.Exec(`INSERT INTO auth_challenges (token_hash, kind, code_hash, expires_at, created_at) VALUES ('t', 'mfa', '', 't', 't')`); err != nil {
		t.Error(err)
	}
}
