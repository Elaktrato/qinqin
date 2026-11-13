package db

import (
	"database/sql"
	"path/filepath"
	"strings"
	"testing"
)

// TestMigration021AddsHighlights runs migration 021 on a database with
// books and bookmarks: their ids and rows are unchanged, and the
// highlights table takes rows referencing a book.
func TestMigration021AddsHighlights(t *testing.T) {
	path := filepath.Join(t.TempDir(), "populated.db")
	sqlDB, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	if err := migrateThrough(sqlDB, "020_library_bookmarks"); err != nil {
		t.Fatalf("migrate through 020: %v", err)
	}
	for _, stmt := range []string{
		`INSERT INTO users (id, username, hash, admin, updated_at) VALUES (1, 'alice', 'h', 1, 't')`,
		`INSERT INTO workspaces (id, user_id, language, name, settings, updated_at) VALUES (7, 1, 'zh', '', '{}', 't')`,
		`INSERT INTO library_books (id, user_id, workspace_id, language, title, chapter_count, position, created_at) VALUES (4, 1, 7, 'zh', 'Book', 3, '2:3', 't1')`,
		`INSERT INTO library_books (id, user_id, workspace_id, language, title, chapter_count, position, created_at) VALUES (9, 1, 7, 'zh', 'Other', 1, '', 't2')`,
		`INSERT INTO library_bookmarks (id, user_id, book_id, position, label, created_at) VALUES (11, 1, 4, '0:1', '你好', 'b1')`,
		`INSERT INTO library_bookmarks (id, user_id, book_id, position, label, created_at) VALUES (12, 1, 9, '0:0', '', 'b2')`,
	} {
		if _, err := sqlDB.Exec(stmt); err != nil {
			t.Fatalf("%s: %v", stmt, err)
		}
	}
	snapshot := func() []string {
		var out []string
		for _, q := range []string{
			`SELECT id || '|' || user_id || '|' || workspace_id || '|' || title || '|' || chapter_count || '|' || position || '|' || created_at FROM library_books ORDER BY id`,
			`SELECT id || '|' || user_id || '|' || book_id || '|' || position || '|' || label || '|' || created_at FROM library_bookmarks ORDER BY id`,
		} {
			rows, err := sqlDB.Query(q)
			if err != nil {
				t.Fatal(err)
			}
			for rows.Next() {
				var s string
				if err := rows.Scan(&s); err != nil {
					t.Fatal(err)
				}
				out = append(out, s)
			}
			rows.Close()
		}
		return out
	}
	before := snapshot()
	if err := migrate(sqlDB); err != nil {
		t.Fatalf("migrate to latest: %v", err)
	}
	after := snapshot()
	if len(before) != 4 || len(after) != len(before) {
		t.Fatalf("rows before %v after %v", before, after)
	}
	for i := range before {
		if before[i] != after[i] {
			t.Errorf("row %d: %q became %q", i, before[i], after[i])
		}
	}

	if _, err := sqlDB.Exec(`INSERT INTO library_highlights
		(user_id, book_id, chapter, paragraph, start_cp, end_cp, text, color, note, created_at, updated_at)
		VALUES (1, 4, 0, 1, 2, 4, '你好', 'yellow', '', 't', 't')`); err != nil {
		t.Fatalf("add highlight: %v", err)
	}
	var fkN, idxN int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM pragma_foreign_key_list('library_highlights') WHERE "table" = 'library_books' AND "from" = 'book_id'`).Scan(&fkN); err != nil {
		t.Fatal(err)
	}
	if fkN != 1 {
		t.Error("library_highlights.book_id does not reference library_books")
	}
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM pragma_index_list('library_highlights') WHERE name = 'idx_library_highlights_position'`).Scan(&idxN); err != nil {
		t.Fatal(err)
	}
	if idxN != 1 {
		t.Error("idx_library_highlights_position missing")
	}
	var cols []string
	rows, err := sqlDB.Query(`SELECT name FROM pragma_index_info('idx_library_highlights_position') ORDER BY seqno`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var c string
		rows.Scan(&c)
		cols = append(cols, c)
	}
	rows.Close()
	if got := strings.Join(cols, ","); got != "book_id,chapter,paragraph,start_cp" {
		t.Errorf("index columns = %v", cols)
	}
}
