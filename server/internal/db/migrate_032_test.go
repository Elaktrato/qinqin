package db_test

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"os"
	"strings"
	"testing"

	"qinqin/internal/db"
)

func hexSHA256(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

// seed031 builds a database at the last pre-accounts schema with two users
// and two plaintext-token sessions, the shape every upgrade starts from.
func seed031(t *testing.T) *sql.DB {
	t.Helper()
	sqlDB := open030(t)
	if err := db.MigrateThrough(sqlDB, "031_ai_custom_name_key"); err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`INSERT INTO users (id, username, hash, admin, updated_at) VALUES (1, 'alice', 'h1', 1, '2026-01-02T03:04:05Z')`,
		`INSERT INTO users (id, username, hash, admin, updated_at) VALUES (7, 'bob', 'h2', 0, '2026-02-03T04:05:06Z')`,
		`INSERT INTO sessions (token, user_id, updated_at) VALUES ('tok-alice-plain', 1, '2026-01-02T03:04:05Z')`,
		`INSERT INTO sessions (token, user_id, updated_at) VALUES ('tok-bob-plain', 7, '2026-02-03T04:05:06Z')`,
	} {
		if _, err := sqlDB.Exec(q); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	return sqlDB
}

func TestMigrate032HashesSessionsAndRebuildsUsers(t *testing.T) {
	sqlDB := seed031(t)
	if err := db.Migrate(sqlDB); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	rows, err := sqlDB.Query(`SELECT token_hash, user_id, level, device, created_at, last_used_at FROM sessions ORDER BY user_id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	want := []struct{ tok, updated string }{{"tok-alice-plain", "2026-01-02T03:04:05Z"}, {"tok-bob-plain", "2026-02-03T04:05:06Z"}}
	i := 0
	for rows.Next() {
		var hash, level, device, created, last string
		var uid int64
		if err := rows.Scan(&hash, &uid, &level, &device, &created, &last); err != nil {
			t.Fatal(err)
		}
		if hash != hexSHA256(want[i].tok) {
			t.Errorf("row %d token_hash = %q, want sha256 of the old token", i, hash)
		}
		if strings.Contains(hash, "plain") {
			t.Errorf("row %d still holds the plaintext token", i)
		}
		if level != "full" || device != "" || created != want[i].updated || last != want[i].updated {
			t.Errorf("row %d = level %q device %q created %q last %q", i, level, device, created, last)
		}
		i++
	}
	if i != 2 {
		t.Fatalf("sessions = %d, want 2", i)
	}

	var ids string
	if err := sqlDB.QueryRow(`SELECT group_concat(id || ':' || username || ':' || admin || ':' || must_change_password || ':' || created_at, ',') FROM (SELECT * FROM users ORDER BY id)`).Scan(&ids); err != nil {
		t.Fatal(err)
	}
	if ids != "1:alice:1:0:2026-01-02T03:04:05Z,7:bob:0:0:2026-02-03T04:05:06Z" {
		t.Errorf("users = %q", ids)
	}
	var reg, pol string
	var mfa, code int
	if err := sqlDB.QueryRow(`SELECT registration, email_policy, mfa_enforced, email_code_login FROM auth_settings WHERE id = 1`).Scan(&reg, &pol, &mfa, &code); err != nil {
		t.Fatal(err)
	}
	if reg != "closed" || pol != "off" || mfa != 0 || code != 0 {
		t.Errorf("auth_settings = %s/%s/%d/%d, want closed/off/0/0", reg, pol, mfa, code)
	}
	if _, err := sqlDB.Exec(`INSERT INTO auth_audit (at, action) VALUES ('t', 'x')`); err != nil {
		t.Errorf("auth_audit missing: %v", err)
	}
}

func TestMigrate032UserIDsNeverReused(t *testing.T) {
	sqlDB := seed031(t)
	if err := db.Migrate(sqlDB); err != nil {
		t.Fatal(err)
	}
	if _, err := sqlDB.Exec(`DELETE FROM users WHERE id = 7`); err != nil {
		t.Fatal(err)
	}
	res, err := sqlDB.Exec(`INSERT INTO users (username, hash, admin, updated_at, created_at) VALUES ('carol', 'h', 0, 't', 't')`)
	if err != nil {
		t.Fatal(err)
	}
	id, _ := res.LastInsertId()
	if id <= 7 {
		t.Errorf("new user id = %d, want > 7 (AUTOINCREMENT)", id)
	}
}

func TestMigrate032EmailUniqueCaseFolded(t *testing.T) {
	sqlDB := seed031(t)
	if err := db.Migrate(sqlDB); err != nil {
		t.Fatal(err)
	}
	if _, err := sqlDB.Exec(`UPDATE users SET email_norm = 'a@x.example' WHERE id = 1`); err != nil {
		t.Fatal(err)
	}
	if _, err := sqlDB.Exec(`UPDATE users SET email_norm = 'a@x.example' WHERE id = 7`); err == nil {
		t.Error("two users share an email_norm")
	}
	// Several users without an email are fine.
	if _, err := sqlDB.Exec(`INSERT INTO users (username, hash, admin, updated_at, created_at) VALUES ('c', 'h', 0, 't', 't')`); err != nil {
		t.Errorf("second NULL email_norm: %v", err)
	}
}

func TestGoStepsNameEmbeddedMigrations(t *testing.T) {
	for _, v := range db.GoStepVersionsForTest() {
		if _, err := os.Stat("migrations/" + v + ".sql"); err != nil {
			t.Errorf("goSteps key %q names no migration file: %v", v, err)
		}
	}
	if len(db.GoStepVersionsForTest()) == 0 {
		t.Error("no go steps registered")
	}
}

func TestFailingGoStepRollsBackItsSQL(t *testing.T) {
	sqlDB := seed031(t)
	restore := db.SetGoStepForTest("032_accounts", func(*sql.Tx) error { return errors.New("boom") })
	defer restore()
	if err := db.Migrate(sqlDB); err == nil {
		t.Fatal("migrate succeeded with a failing step")
	}
	var n int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM schema_migrations WHERE version = '032_accounts'`).Scan(&n); err != nil || n != 0 {
		t.Errorf("032 recorded: n=%d err=%v", n, err)
	}
	// The old schema is intact: plaintext column still there, no new table.
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM sessions WHERE token = 'tok-alice-plain'`).Scan(&n); err != nil || n != 1 {
		t.Errorf("old sessions table not restored: n=%d err=%v", n, err)
	}
	if _, err := sqlDB.Exec(`SELECT 1 FROM auth_settings`); err == nil {
		t.Error("auth_settings survived the rollback")
	}
}
