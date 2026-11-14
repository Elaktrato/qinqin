package db

import (
	"database/sql"
	"path/filepath"
	"strings"
	"testing"
)

// TestMigration020AddsBookmarks runs migration 020 on a database with
// books: the books are untouched and bookmarks are unique per (book,
// position).
func TestMigration020AddsBookmarks(t *testing.T) {
	path := filepath.Join(t.TempDir(), "populated.db")
	sqlDB, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	if err := migrateThrough(sqlDB, "019_library_workspace"); err != nil {
		t.Fatalf("migrate through 019: %v", err)
	}
	for _, stmt := range []string{
		`INSERT INTO users (id, username, hash, admin, updated_at) VALUES (1, 'alice', 'h', 1, 't')`,
		`INSERT INTO workspaces (id, user_id, language, name, settings, updated_at) VALUES (7, 1, 'zh', '', '{}', 't')`,
		`INSERT INTO library_books (id, user_id, workspace_id, language, title, position, created_at) VALUES (4, 1, 7, 'zh', 'Book', '2:3', 't')`,
	} {
		if _, err := sqlDB.Exec(stmt); err != nil {
			t.Fatalf("%s: %v", stmt, err)
		}
	}
	if err := migrate(sqlDB); err != nil {
		t.Fatalf("migrate to latest: %v", err)
	}

	var title, position string
	var ws int64
	if err := sqlDB.QueryRow(`SELECT title, position, workspace_id FROM library_books WHERE id = 4`).Scan(&title, &position, &ws); err != nil {
		t.Fatal(err)
	}
	if title != "Book" || position != "2:3" || ws != 7 {
		t.Errorf("book = %q %q %d", title, position, ws)
	}
	ins := `INSERT INTO library_bookmarks (user_id, book_id, position, label, created_at) VALUES (1, 4, ?, '', 't')`
	if _, err := sqlDB.Exec(ins, "0:1"); err != nil {
		t.Fatalf("add bookmark: %v", err)
	}
	if _, err := sqlDB.Exec(ins, "0:1"); err == nil || !strings.Contains(err.Error(), "UNIQUE") {
		t.Errorf("same position = %v, want a UNIQUE violation", err)
	}
	var fkN int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM pragma_foreign_key_list('library_bookmarks') WHERE "table" = 'library_books' AND "from" = 'book_id'`).Scan(&fkN); err != nil {
		t.Fatal(err)
	}
	if fkN != 1 {
		t.Error("library_bookmarks.book_id does not reference library_books")
	}
}
