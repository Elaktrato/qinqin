package db_test

import (
	"bytes"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

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
	upgradeStart := time.Now().UTC().Add(-2 * time.Second).Format(time.RFC3339)
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
		if level != "full" || device != "" || created != want[i].updated || last < upgradeStart {
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

// Sessions get the upgrade time as their last use, so nobody is logged out
// 90 days after an upgrade just because the old table had no use column.
func TestMigrate032OldSessionsSurviveTheUpgrade(t *testing.T) {
	sqlDB := seed031(t)
	old := time.Now().UTC().Add(-200 * 24 * time.Hour).Format(time.RFC3339)
	sqlDB.Exec(`UPDATE sessions SET updated_at = ?`, old)
	if err := db.Migrate(sqlDB); err != nil {
		t.Fatal(err)
	}
	var created, last string
	sqlDB.QueryRow(`SELECT created_at, last_used_at FROM sessions ORDER BY id LIMIT 1`).Scan(&created, &last)
	cutoff := time.Now().UTC().Add(-90 * 24 * time.Hour).Format(time.RFC3339)
	if created != old || last <= cutoff {
		t.Errorf("created %s last_used %s: want created kept, last use inside the idle window", created, last)
	}
}

func TestMigrate032UsernameKeys(t *testing.T) {
	sqlDB := seed031(t)
	sqlDB.Exec(`INSERT INTO users (id, username, hash, admin, updated_at) VALUES (8, 'Bob', 'h', 0, 't')`)
	sqlDB.Exec(`INSERT INTO users (id, username, hash, admin, updated_at) VALUES (9, 'Ｃarl', 'h', 0, 't')`) // fullwidth C
	if err := db.Migrate(sqlDB); err != nil {
		t.Fatal(err)
	}
	keys := map[string]*string{}
	rows, _ := sqlDB.Query(`SELECT username, username_key FROM users`)
	for rows.Next() {
		var n string
		var k *string
		rows.Scan(&n, &k)
		keys[n] = k
	}
	rows.Close()
	if k := keys["alice"]; k == nil || *k != "alice" {
		t.Errorf("alice key = %v", k)
	}
	if k := keys["bob"]; k == nil || *k != "bob" {
		t.Errorf("bob (lowest id) key = %v", k)
	}
	if k := keys["Bob"]; k != nil {
		t.Errorf("Bob collides with bob: key must stay NULL, got %q", *k)
	}
	if k := keys["Ｃarl"]; k == nil || *k != "carl" {
		t.Errorf("fullwidth name key = %v, want NFKC+fold carl", k)
	}
	if _, err := sqlDB.Exec(`INSERT INTO users (username, hash, admin, updated_at, created_at, username_key) VALUES ('x', 'h', 0, 't', 't', 'alice')`); err == nil {
		t.Error("duplicate username_key accepted")
	}
}

// The legacy plaintext tokens must not stay behind in the database file or
// its WAL after the upgrade (secure_delete zeroes the freed pages).
func TestMigrate032LeavesNoPlaintextTokenInTheFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "m.db")
	const marker = "PLAINTEXT-TOKEN-MARKER-0123456789abcdef0123456789abcdef0123456789ab"
	open := func() *sql.DB {
		d, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
		if err != nil {
			t.Fatal(err)
		}
		return d
	}
	d := open()
	if err := db.MigrateThrough(d, "031_ai_custom_name_key"); err != nil {
		t.Fatal(err)
	}
	d.Exec(`INSERT INTO users (id, username, hash, admin, updated_at) VALUES (1, 'alice', 'h', 1, 't')`)
	d.Exec(`INSERT INTO sessions (token, user_id, updated_at) VALUES (?, 1, 't')`, marker)
	d.Close()
	d = open()
	if err := db.Migrate(d); err != nil {
		t.Fatal(err)
	}
	d.Exec(`PRAGMA wal_checkpoint(TRUNCATE)`)
	d.Close()
	for _, f := range []string{path, path + "-wal"} {
		b, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		if bytes.Contains(b, []byte(marker)) {
			t.Errorf("%s still contains the legacy plaintext token", f)
		}
	}
}
