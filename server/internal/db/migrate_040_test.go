package db_test

import (
	"testing"

	"qinqin/internal/db"
)

// Migration 040 (#73): users.interface_language, "" (follow the
// browser/device) for every existing and new account.
func TestMigration040InterfaceLanguage(t *testing.T) {
	sqlDB := open030(t)
	if err := db.MigrateThrough(sqlDB, "039_packages"); err != nil {
		t.Fatal(err)
	}
	if _, err := sqlDB.Exec(`INSERT INTO users (id, username, hash, updated_at) VALUES (1, 'old', 'h', 't')`); err != nil {
		t.Fatal(err)
	}
	if err := db.MigrateThrough(sqlDB, "040_interface_language"); err != nil {
		t.Fatal(err)
	}
	if _, err := sqlDB.Exec(`INSERT INTO users (id, username, hash, updated_at) VALUES (2, 'new', 'h', 't')`); err != nil {
		t.Fatal(err)
	}
	for _, id := range []int{1, 2} {
		var lang string
		if err := sqlDB.QueryRow(`SELECT interface_language FROM users WHERE id = ?`, id).Scan(&lang); err != nil || lang != "" {
			t.Errorf("user %d: interface_language %q (%v), want ''", id, lang, err)
		}
	}
	var notNull int
	var dflt string
	if err := sqlDB.QueryRow(`SELECT "notnull", dflt_value FROM pragma_table_info('users') WHERE name = 'interface_language'`).Scan(&notNull, &dflt); err != nil {
		t.Fatal(err)
	}
	if notNull != 1 || dflt != "''" {
		t.Errorf("notnull %d default %q, want 1 and ''", notNull, dflt)
	}
	if _, err := sqlDB.Exec(`UPDATE users SET interface_language = NULL WHERE id = 1`); err == nil {
		t.Error("NULL accepted")
	}
}
