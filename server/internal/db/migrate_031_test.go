package db_test

import (
	"strings"
	"testing"

	"qinqin/internal/db"
)

// Migration 031 adds a unique, normalised name key to custom endpoints and
// backfills existing rows, also when two existing names differ only in case.
func TestMigrate031UniqueNameKey(t *testing.T) {
	sqlDB := open030(t)
	if err := db.MigrateThrough(sqlDB, "030_ai_providers"); err != nil {
		t.Fatal(err)
	}
	for i, name := range []string{"Lab Box", "lab box", "Other"} {
		if _, err := sqlDB.Exec(`INSERT INTO ai_custom_providers (id, name, base_url, default_model, vision, structured, key_required, created_by, created_at)
			VALUES (?, ?, 'https://x.example/v1', 'm', 0, 'json_object', 1, 1, 't')`, "custom-aaaaaaaaa"+string(rune('a'+i)), name); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Migrate(sqlDB); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	rows, err := sqlDB.Query(`SELECT name, name_key FROM ai_custom_providers ORDER BY rowid`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	keys := map[string]bool{}
	for rows.Next() {
		var name, key string
		_ = rows.Scan(&name, &key)
		if key == "" || keys[key] {
			t.Errorf("row %q has key %q (empty or duplicate)", name, key)
		}
		keys[key] = true
	}
	if len(keys) != 3 {
		t.Errorf("keys = %v", keys)
	}
	_, err = sqlDB.Exec(`INSERT INTO ai_custom_providers (id, name, name_key, base_url, default_model, vision, structured, key_required, created_by, created_at)
		VALUES ('custom-zzzzzzzzzz', 'X', 'other', 'https://x.example/v1', 'm', 0, 'json_object', 1, 1, 't')`)
	if err == nil || !strings.Contains(strings.ToUpper(err.Error()), "UNIQUE") {
		t.Errorf("duplicate name_key: err = %v, want a UNIQUE violation", err)
	}
}
