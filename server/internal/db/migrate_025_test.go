package db

import (
	"strings"
	"testing"
)

// TestMigration025CreatesJournalAITables checks the three tables the AI key
// store, the rate limiter and the temporary journal photos rely on.
func TestMigration025CreatesJournalAITables(t *testing.T) {
	sqlDB := openMigrationDB(t)
	if err := migrateThrough(sqlDB, "024_pack_notice"); err != nil {
		t.Fatalf("migrate through 024: %v", err)
	}
	if _, err := sqlDB.Exec(`INSERT INTO users (id, username, hash, admin, updated_at) VALUES (1, 'u', 'h', 0, 't')`); err != nil {
		t.Fatal(err)
	}
	if _, err := sqlDB.Exec(`INSERT INTO workspaces (id, user_id, language, updated_at) VALUES (1, 1, 'zh', 't')`); err != nil {
		t.Fatal(err)
	}
	if err := migrateThrough(sqlDB, "025_journal_ai"); err != nil {
		t.Fatalf("migrate through 025: %v", err)
	}

	insertKey := `INSERT INTO ai_keys (user_id, provider, ciphertext, nonce, secret_fp, hint, model, created_at) VALUES (1, 'anthropic', x'01', x'02', 'fp', '…1234', 'claude-opus-5-5', 't')`
	if _, err := sqlDB.Exec(insertKey); err != nil {
		t.Fatalf("insert ai_keys: %v", err)
	}
	_, err := sqlDB.Exec(insertKey)
	if err == nil || !strings.Contains(strings.ToUpper(err.Error()), "UNIQUE") && !strings.Contains(strings.ToUpper(err.Error()), "PRIMARY KEY") {
		t.Errorf("second ai_keys row for the same user: err = %v, want a UNIQUE/PRIMARY KEY violation", err)
	}
	var lastUsed any
	if err := sqlDB.QueryRow(`SELECT last_used_at FROM ai_keys WHERE user_id = 1`).Scan(&lastUsed); err != nil || lastUsed != nil {
		t.Errorf("last_used_at = %v (err %v), want NULL", lastUsed, err)
	}

	if _, err := sqlDB.Exec(`INSERT INTO ai_calls (user_id, kind, model, ok, at) VALUES (1, 'review', 'claude-opus-5-5', 1, 't')`); err != nil {
		t.Fatalf("insert ai_calls: %v", err)
	}
	var in, out int
	if err := sqlDB.QueryRow(`SELECT input_tokens, output_tokens FROM ai_calls`).Scan(&in, &out); err != nil || in != 0 || out != 0 {
		t.Errorf("token defaults = %d/%d (err %v), want 0/0", in, out, err)
	}
	if _, err := sqlDB.Exec(`INSERT INTO journal_photos (id, user_id, workspace_id, created_at, last_seen_at) VALUES ('p1', 1, 1, 't', 't')`); err != nil {
		t.Fatalf("insert journal_photos: %v", err)
	}

	indexes := func(table string) map[string]bool {
		rows, err := sqlDB.Query(`SELECT name FROM pragma_index_list('` + table + `')`)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		got := map[string]bool{}
		for rows.Next() {
			var n string
			if err := rows.Scan(&n); err != nil {
				t.Fatal(err)
			}
			got[n] = true
		}
		return got
	}
	if !indexes("ai_calls")["ai_calls_user_at"] {
		t.Error("index ai_calls_user_at missing")
	}
	for _, n := range []string{"journal_photos_user", "journal_photos_seen"} {
		if !indexes("journal_photos")[n] {
			t.Errorf("index %s missing", n)
		}
	}
}
