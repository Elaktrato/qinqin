package db_test

import (
	"bytes"
	"context"
	"database/sql"
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/ai"
	"qinqin/internal/db"

	_ "modernc.org/sqlite"
)

func open030(t *testing.T) *sql.DB {
	t.Helper()
	path := filepath.Join(t.TempDir(), "m030.db")
	sqlDB, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	return sqlDB
}

type keyRow030 struct {
	ct, nonce                []byte
	fp, hint, model, created string
}

func readKey030(t *testing.T, sqlDB *sql.DB, user int64, provider string) keyRow030 {
	t.Helper()
	var r keyRow030
	err := sqlDB.QueryRow(`SELECT ciphertext, nonce, secret_fp, hint, model, created_at FROM ai_keys WHERE user_id = ? AND provider = ?`, user, provider).
		Scan(&r.ct, &r.nonce, &r.fp, &r.hint, &r.model, &r.created)
	if err != nil {
		t.Fatalf("read key %d/%s: %v", user, provider, err)
	}
	return r
}

// TestMigrate030KeepsAnthropicKey seals a real row with the key store as it
// is before this migration (029 schema), migrates, and checks the ciphertext
// is untouched and still opens, the key is the active selection and the new
// primary key allows one row per provider.
func TestMigrate030KeepsAnthropicKey(t *testing.T) {
	sqlDB := open030(t)
	if err := db.MigrateThrough(sqlDB, "029_audio"); err != nil {
		t.Fatal(err)
	}
	secret := bytes.Repeat([]byte{3}, 32)
	prevSecret := bytes.Repeat([]byte{4}, 32)
	ctx := context.Background()
	// Sealed exactly as KeyStore.Put does (sealer, KeyAAD, hint = "…" + last 4).
	const plain = "sk-ant-test-0001-abcdefghijklmnop"
	put := func(user int64, s *ai.Sealer, key, model string) {
		ct, nonce, err := s.Seal([]byte(key), ai.KeyAAD(user, "anthropic"))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := sqlDB.ExecContext(ctx, `INSERT INTO ai_keys (user_id, provider, ciphertext, nonce, secret_fp, hint, model, created_at)
			VALUES (?, 'anthropic', ?, ?, ?, ?, ?, '2026-11-01T00:00:00Z')`,
			user, ct, nonce, s.Fingerprint(), "…"+key[len(key)-4:], model); err != nil {
			t.Fatal(err)
		}
	}
	put(7, ai.NewSealer(secret), plain, "claude-sonnet-5-5")
	// A second user's key sealed under the previous secret.
	put(8, ai.NewSealer(prevSecret), "sk-ant-test-0002-qrstuvwxyz", "claude-opus-5-5")
	for _, q := range []string{
		`INSERT INTO ai_calls (user_id, kind, model, ok, at) VALUES (7, 'review', 'claude-opus-5-5', 1, 't')`,
		`INSERT INTO ai_calls (user_id, kind, model, ok, at) VALUES (8, 'suggest', 'claude-opus-5-5', 0, 't')`,
	} {
		if _, err := sqlDB.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	before7 := readKey030(t, sqlDB, 7, "anthropic")
	before8 := readKey030(t, sqlDB, 8, "anthropic")

	if err := db.Migrate(sqlDB); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	after7 := readKey030(t, sqlDB, 7, "anthropic")
	if !bytes.Equal(before7.ct, after7.ct) || !bytes.Equal(before7.nonce, after7.nonce) ||
		before7.fp != after7.fp || before7.hint != after7.hint || before7.model != after7.model || before7.created != after7.created {
		t.Errorf("row changed by migration: %+v -> %+v", before7, after7)
	}
	after8 := readKey030(t, sqlDB, 8, "anthropic")
	if !bytes.Equal(before8.ct, after8.ct) || before8.fp != after8.fp {
		t.Errorf("previous-secret row changed")
	}
	got, err := ai.NewSealer(secret).Open(after7.ct, after7.nonce, ai.KeyAAD(7, "anthropic"))
	if err != nil || string(got) != plain {
		t.Errorf("open after migration = %q, %v", got, err)
	}
	if _, err := ai.NewSealer(prevSecret).Open(after8.ct, after8.nonce, ai.KeyAAD(8, "anthropic")); err != nil {
		t.Errorf("previous-secret row no longer opens: %v", err)
	}
	var lastUsed any
	if err := sqlDB.QueryRow(`SELECT last_used_at FROM ai_keys WHERE user_id = 7`).Scan(&lastUsed); err != nil || lastUsed != nil {
		t.Errorf("last_used_at = %v (%v), want NULL", lastUsed, err)
	}

	for _, u := range []int64{7, 8} {
		var p string
		if err := sqlDB.QueryRow(`SELECT provider FROM ai_selection WHERE user_id = ?`, u).Scan(&p); err != nil || p != "anthropic" {
			t.Errorf("selection of user %d = %q (%v), want anthropic", u, p, err)
		}
	}
	var calls int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM ai_calls WHERE provider = 'anthropic'`).Scan(&calls); err != nil || calls != 2 {
		t.Errorf("ai_calls with provider anthropic = %d (%v), want 2", calls, err)
	}

	ins := func(provider string) error {
		_, err := sqlDB.Exec(`INSERT INTO ai_keys (user_id, provider, ciphertext, nonce, secret_fp, hint, model, created_at) VALUES (7, ?, x'01', x'02', 'fp', '…1', 'm', 't')`, provider)
		return err
	}
	if err := ins("openai"); err != nil {
		t.Errorf("second provider row: %v", err)
	}
	if err := ins("anthropic"); err == nil || !strings.Contains(strings.ToUpper(err.Error()), "UNIQUE") && !strings.Contains(strings.ToUpper(err.Error()), "PRIMARY KEY") {
		t.Errorf("duplicate (7, anthropic): err = %v, want a uniqueness violation", err)
	}

	for _, table := range []string{"ai_custom_providers"} {
		var n int
		if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM ` + table).Scan(&n); err != nil || n != 0 {
			t.Errorf("%s: n=%d err=%v, want an empty table", table, n, err)
		}
	}
}

func TestMigrate030Empty(t *testing.T) {
	sqlDB := open030(t)
	if err := db.Migrate(sqlDB); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"ai_keys", "ai_selection", "ai_custom_providers"} {
		var n int
		if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM ` + table).Scan(&n); err != nil || n != 0 {
			t.Errorf("%s: n=%d err=%v, want empty", table, n, err)
		}
	}
}
