package db

import (
	"database/sql"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// queryStrings returns the first column of every row of q, as strings.
func queryStrings(t *testing.T, sqlDB *sql.DB, q string) []string {
	t.Helper()
	rows, err := sqlDB.Query(q)
	if err != nil {
		t.Fatalf("%s: %v", q, err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			t.Fatal(err)
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

// TestMigration023NeverReusesBookIds runs migration 023 on a database
// with books, bookmarks and highlights: every column of every book, the
// ids, the children and the indexes are unchanged, and after the
// highest-id book is deleted a new book gets a fresh id, so a reader tab
// still open on a deleted book can never write into an unrelated new one.
func TestMigration023NeverReusesBookIds(t *testing.T) {
	path := filepath.Join(t.TempDir(), "populated.db")
	sqlDB, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	if err := migrateThrough(sqlDB, "022_workspaces_autoincrement"); err != nil {
		t.Fatalf("migrate through 022: %v", err)
	}
	for _, stmt := range []string{
		`INSERT INTO users (id, username, hash, admin, updated_at) VALUES (1, 'alice', 'h', 1, 't')`,
		`INSERT INTO workspaces (id, user_id, language, name, settings, updated_at) VALUES (3, 1, 'ja', '', '{}', 't')`,
		`INSERT INTO workspaces (id, user_id, language, name, settings, updated_at) VALUES (5, 1, 'zh', '', '{}', 't')`,
		`INSERT INTO library_books (id, user_id, workspace_id, language, title, author, source, source_id, source_url,
			attribution, license_note, chapter_count, position, created_at)
			VALUES (2, 1, 3, 'ja', 'Neko', 'Soseki', 'aozora', '789', 'https://a/789', 'Aozora', 'PD', 11, '{"c":2}', 't1')`,
		`INSERT INTO library_books (id, user_id, workspace_id, language, title, created_at) VALUES (9, 1, 5, 'zh', 'Upload', 't2')`,
		`INSERT INTO library_bookmarks (id, user_id, book_id, position, label, created_at) VALUES (4, 1, 9, '{"c":1}', 'here', 't')`,
		`INSERT INTO library_highlights (id, user_id, book_id, chapter, paragraph, start_cp, end_cp, text, created_at, updated_at)
			VALUES (6, 1, 2, 0, 1, 0, 2, 'ab', 't', 't')`,
	} {
		if _, err := sqlDB.Exec(stmt); err != nil {
			t.Fatalf("%s: %v", stmt, err)
		}
	}
	const booksQ = `SELECT id || '|' || user_id || '|' || workspace_id || '|' || language || '|' || title || '|' ||
		author || '|' || source || '|' || source_id || '|' || source_url || '|' || attribution || '|' ||
		license_note || '|' || chapter_count || '|' || position || '|' || created_at FROM library_books ORDER BY id`
	// Migration 039's paging index (user_id, updated_at) is checked in migrate_039_test.go.
	const indexesQ = `SELECT name || '|' || sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'library_books' AND sql IS NOT NULL
		AND name <> 'idx_library_books_user_updated' ORDER BY name`
	const childrenQ = `SELECT 'b' || id || '|' || book_id FROM library_bookmarks UNION ALL SELECT 'h' || id || '|' || book_id FROM library_highlights ORDER BY 1`
	booksBefore := queryStrings(t, sqlDB, booksQ)
	indexesBefore := queryStrings(t, sqlDB, indexesQ)
	childrenBefore := queryStrings(t, sqlDB, childrenQ)
	if len(booksBefore) != 2 || len(indexesBefore) != 3 || len(childrenBefore) != 2 {
		t.Fatalf("fixture: books %v indexes %v children %v", booksBefore, indexesBefore, childrenBefore)
	}

	if err := migrate(sqlDB); err != nil {
		t.Fatalf("migrate to latest: %v", err)
	}
	if got := queryStrings(t, sqlDB, booksQ); !reflect.DeepEqual(got, booksBefore) {
		t.Errorf("books after 023 = %v, want %v", got, booksBefore)
	}
	if got := queryStrings(t, sqlDB, indexesQ); !reflect.DeepEqual(got, indexesBefore) {
		t.Errorf("indexes after 023 = %v, want %v", got, indexesBefore)
	}
	if got := queryStrings(t, sqlDB, childrenQ); !reflect.DeepEqual(got, childrenBefore) {
		t.Errorf("bookmarks/highlights after 023 = %v, want %v", got, childrenBefore)
	}
	if got := queryStrings(t, sqlDB, `SELECT name || '|' || seq FROM sqlite_sequence WHERE name = 'library_books'`); !reflect.DeepEqual(got, []string{"library_books|9"}) {
		t.Errorf("sqlite_sequence = %v, want [library_books|9]", got)
	}
	// No schema names the temporary table, and the table is AUTOINCREMENT.
	if got := queryStrings(t, sqlDB, `SELECT name FROM sqlite_master WHERE sql LIKE '%library_books_new%'`); len(got) != 0 {
		t.Errorf("schema still refers to library_books_new: %v", got)
	}
	tableSQL := queryStrings(t, sqlDB, `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'library_books'`)
	if len(tableSQL) != 1 || !strings.Contains(tableSQL[0], "AUTOINCREMENT") {
		t.Errorf("library_books schema = %v, want AUTOINCREMENT", tableSQL)
	}
	if got := queryStrings(t, sqlDB, `PRAGMA integrity_check`); !reflect.DeepEqual(got, []string{"ok"}) {
		t.Errorf("integrity_check = %v", got)
	}

	// The partial unique dedupe key survives the rebuild.
	if _, err := sqlDB.Exec(`INSERT INTO library_books (user_id, workspace_id, language, title, source, source_id, created_at)
		VALUES (1, 3, 'ja', 'Again', 'aozora', '789', 't')`); err == nil {
		t.Error("duplicate (workspace, source, source_id) accepted after 023")
	}

	// Deleting the highest id and inserting again must not hand out 9.
	if _, err := sqlDB.Exec(`DELETE FROM library_books WHERE id = 9`); err != nil {
		t.Fatal(err)
	}
	var id int64
	if err := sqlDB.QueryRow(`INSERT INTO library_books (user_id, workspace_id, language, title, created_at)
		VALUES (1, 3, 'ja', 'New', 't') RETURNING id`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if id <= 9 {
		t.Errorf("new book id = %d, want > 9 (deleted ids are never reused)", id)
	}
}

// TestMigration023EmptyDatabase applies every migration to a fresh
// database: library_books starts empty, and after a book is created and
// deleted the next book still gets a fresh id.
func TestMigration023EmptyDatabase(t *testing.T) {
	path := filepath.Join(t.TempDir(), "empty.db")
	sqlDB, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	for _, stmt := range []string{
		`INSERT INTO users (id, username, hash, admin, updated_at) VALUES (1, 'alice', 'h', 1, 't')`,
		`INSERT INTO workspaces (id, user_id, language, name, settings, updated_at) VALUES (1, 1, 'ja', '', '{}', 't')`,
	} {
		if _, err := sqlDB.Exec(stmt); err != nil {
			t.Fatal(err)
		}
	}
	insert := func() int64 {
		var id int64
		if err := sqlDB.QueryRow(`INSERT INTO library_books (user_id, workspace_id, language, title, created_at)
			VALUES (1, 1, 'ja', 'B', 't') RETURNING id`).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	first := insert()
	if _, err := sqlDB.Exec(`DELETE FROM library_books`); err != nil {
		t.Fatal(err)
	}
	if second := insert(); second <= first {
		t.Errorf("book ids %d then %d after deleting all: a deleted id was reused", first, second)
	}
	if got := queryStrings(t, sqlDB, `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'library_books' AND sql IS NOT NULL AND name <> 'idx_library_books_user_updated' ORDER BY name`); !reflect.DeepEqual(got, []string{"idx_library_books_source", "idx_library_books_user", "idx_library_books_workspace"}) {
		t.Errorf("indexes = %v", got)
	}
}
