package db

import (
	"database/sql"
	"path/filepath"
	"strings"
	"testing"
)

// TestMigration019ScopesBooksToWorkspaces runs migration 019 on a
// database holding books in several languages: every book keeps its id
// and columns and is linked to the lowest-id workspace of its (user,
// language); a user without a workspace for a book's language gets an
// unnamed one first, so no book is orphaned. The dedupe key becomes
// (workspace_id, source, source_id).
func TestMigration019ScopesBooksToWorkspaces(t *testing.T) {
	path := filepath.Join(t.TempDir(), "populated.db")
	sqlDB, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	if err := migrateThrough(sqlDB, "018_workspaces_name"); err != nil {
		t.Fatalf("migrate through 018: %v", err)
	}

	for _, stmt := range []string{
		`INSERT INTO users (id, username, hash, admin, updated_at) VALUES
			(1, 'alice', 'h', 1, 't'), (2, 'bob', 'h', 0, 't'), (3, 'carol', 'h', 0, 't')`,
		// alice: two zh workspaces (13 named, 7 unnamed: 7 is the lowest)
		// and a ja one; bob: only ja; carol: none.
		`INSERT INTO workspaces (id, user_id, language, name, settings, updated_at) VALUES
			(7, 1, 'zh', '', '{}', '2026-01-01T00:00:00Z'),
			(12, 1, 'ja', '', '{}', '2026-01-01T00:00:00Z'),
			(13, 1, 'zh', 'graded', '{}', '2026-01-01T00:00:00Z'),
			(30, 2, 'ja', '', '{"theme":"dark"}', '2026-01-01T00:00:00Z')`,
		`INSERT INTO library_books (id, user_id, language, title, author, source, source_id,
			source_url, attribution, license_note, chapter_count, position, created_at) VALUES
			(4, 1, 'zh', 'Z1', 'A', 'upload', 'h1', 'u', 'at', 'ln', 3, '1:2', '2026-02-01T00:00:00Z'),
			(5, 1, 'ja', 'J1', '', 'aozora', '42', '', '', '', 1, '', '2026-02-02T00:00:00Z'),
			(9, 2, 'zh', 'Z2', '', 'gutenberg', '7', '', '', '', 1, '', '2026-02-03T00:00:00Z'),
			(10, 2, 'zh', 'Z3', '', '', '', '', '', '', 1, '', '2026-02-04T00:00:00Z'),
			(11, 2, 'ja', 'J2', '', 'aozora', '42', '', '', '', 1, '', '2026-02-05T00:00:00Z'),
			(20, 3, 'ja', 'J3', '', 'aozora', '1', '', '', '', 1, '0:5', '2026-02-06T00:00:00Z')`,
	} {
		if _, err := sqlDB.Exec(stmt); err != nil {
			t.Fatalf("%s: %v", stmt, err)
		}
	}

	if err := migrate(sqlDB); err != nil {
		t.Fatalf("migrate to latest: %v", err)
	}

	// The workspaces the backfill had to create: bob zh, carol ja, both
	// unnamed with empty settings, ids above the existing ones.
	created := map[string]int64{}
	rows, err := sqlDB.Query(`SELECT id, user_id, language, name, settings FROM workspaces WHERE id > 30 ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var id, user int64
		var language, name, settings string
		if err := rows.Scan(&id, &user, &language, &name, &settings); err != nil {
			t.Fatal(err)
		}
		if name != "" || settings != "{}" {
			t.Errorf("created workspace %d = name %q settings %q, want unnamed {}", id, name, settings)
		}
		created[language+string(rune('0'+user))] = id
	}
	rows.Close()
	if len(created) != 2 || created["zh2"] == 0 || created["ja3"] == 0 {
		t.Fatalf("created workspaces = %v, want bob zh and carol ja", created)
	}
	var total int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM workspaces`).Scan(&total); err != nil {
		t.Fatal(err)
	}
	if total != 6 {
		t.Errorf("workspaces = %d, want 6 (4 kept + 2 created)", total)
	}

	// Every book keeps its columns and points at the right workspace.
	type bookRow struct {
		id, user, ws                                 int64
		lang, title, author, src, srcID, url, at, ln string
		chapters                                     int
		position, created                            string
	}
	want := []bookRow{
		{4, 1, 7, "zh", "Z1", "A", "upload", "h1", "u", "at", "ln", 3, "1:2", "2026-02-01T00:00:00Z"},
		{5, 1, 12, "ja", "J1", "", "aozora", "42", "", "", "", 1, "", "2026-02-02T00:00:00Z"},
		{9, 2, created["zh2"], "zh", "Z2", "", "gutenberg", "7", "", "", "", 1, "", "2026-02-03T00:00:00Z"},
		{10, 2, created["zh2"], "zh", "Z3", "", "", "", "", "", "", 1, "", "2026-02-04T00:00:00Z"},
		{11, 2, 30, "ja", "J2", "", "aozora", "42", "", "", "", 1, "", "2026-02-05T00:00:00Z"},
		{20, 3, created["ja3"], "ja", "J3", "", "aozora", "1", "", "", "", 1, "0:5", "2026-02-06T00:00:00Z"},
	}
	rows, err = sqlDB.Query(`SELECT id, user_id, workspace_id, language, title, author, source, source_id,
		source_url, attribution, license_note, chapter_count, position, created_at FROM library_books ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	var got []bookRow
	for rows.Next() {
		var r bookRow
		if err := rows.Scan(&r.id, &r.user, &r.ws, &r.lang, &r.title, &r.author, &r.src, &r.srcID,
			&r.url, &r.at, &r.ln, &r.chapters, &r.position, &r.created); err != nil {
			t.Fatal(err)
		}
		got = append(got, r)
	}
	rows.Close()
	if len(got) != len(want) {
		t.Fatalf("books = %+v, want %+v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("book %d = %+v, want %+v", i, got[i], want[i])
		}
	}

	// Each book's workspace belongs to its user and has its language.
	var mismatched int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM library_books b LEFT JOIN workspaces w ON w.id = b.workspace_id
		WHERE w.id IS NULL OR w.user_id <> b.user_id OR w.language <> b.language`).Scan(&mismatched); err != nil {
		t.Fatal(err)
	}
	if mismatched != 0 {
		t.Errorf("%d books not linked to a workspace of their user and language", mismatched)
	}

	// The schema: workspace_id references workspaces and is required; the
	// rebuild leaves nothing behind and foreign keys hold.
	var fkN int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM pragma_foreign_key_list('library_books') WHERE "table" = 'workspaces' AND "from" = 'workspace_id'`).Scan(&fkN); err != nil {
		t.Fatal(err)
	}
	if fkN != 1 {
		t.Error("library_books.workspace_id does not reference workspaces")
	}
	if _, err := sqlDB.Exec(`INSERT INTO library_books (user_id, language, title, created_at) VALUES (1, 'zh', 'x', 't')`); err == nil || !strings.Contains(err.Error(), "NOT NULL") {
		t.Errorf("insert without workspace_id = %v, want a NOT NULL violation", err)
	}
	fk, err := sqlDB.Query(`PRAGMA foreign_key_check`)
	if err != nil {
		t.Fatal(err)
	}
	if fk.Next() {
		t.Error("foreign_key_check reports violations after 019")
	}
	fk.Close()
	var leftover int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE name LIKE 'library_books_%' AND type = 'table'`).Scan(&leftover); err != nil {
		t.Fatal(err)
	}
	if leftover != 0 {
		t.Error("rebuild left a library_books_* table behind")
	}
	for _, idx := range []string{"idx_library_books_source", "idx_library_books_user", "idx_library_books_workspace"} {
		var n int
		if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = ?`, idx).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 1 {
			t.Errorf("index %s missing", idx)
		}
	}

	// The dedupe key is per workspace: the same work in alice's second zh
	// workspace is fine, in the same workspace it clashes.
	ins := `INSERT INTO library_books (user_id, workspace_id, language, title, source, source_id, created_at) VALUES (1, ?, 'zh', 'x', 'upload', 'h1', 't')`
	if _, err := sqlDB.Exec(ins, 13); err != nil {
		t.Errorf("same source in another workspace rejected: %v", err)
	}
	if _, err := sqlDB.Exec(ins, 7); err == nil || !strings.Contains(err.Error(), "UNIQUE") {
		t.Errorf("same source in the same workspace = %v, want a UNIQUE violation", err)
	}
	var newID int64
	if err := sqlDB.QueryRow(`SELECT MAX(id) FROM library_books`).Scan(&newID); err != nil {
		t.Fatal(err)
	}
	if newID <= 20 {
		t.Errorf("new book id = %d, want above the preserved ids", newID)
	}
}
