package db

import (
	"database/sql"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// syncColumns are the columns every study_* table shares with plugin_data.
var syncColumns = []string{"extra", "version", "updated_at", "modified_at", "deleted_at"}

// studyTables are the typed study tables of migration 038: their typed
// columns (after user_id, workspace_id) and primary key.
var studyTables = []struct {
	name string
	cols []string
	pk   []string
}{
	{"study_cards", []string{"id", "kind", "entry_id", "written", "entry_kind", "sentence_id", "skip_kinds", "deck_ids", "created_at"}, []string{"user_id", "workspace_id", "id"}},
	{"study_decks", []string{"id", "name", "created_at", "source"}, []string{"user_id", "workspace_id", "id"}},
	{"study_deck_settings", []string{"deck_id", "card_types", "new_order"}, []string{"user_id", "workspace_id", "deck_id"}},
	{"study_limits", []string{"deck_id", "new_set", "new_limit", "reviews_set", "reviews_limit"}, []string{"user_id", "workspace_id", "deck_id"}},
	{"study_fsrs_sets", []string{"id", "w", "created_at", "source", "labelled", "log_loss", "baseline_log_loss"}, []string{"user_id", "workspace_id", "id"}},
	{"study_fsrs_active", []string{"set_id", "changed_at"}, []string{"user_id", "workspace_id"}},
}

func openMigrated(t *testing.T) *sql.DB {
	t.Helper()
	sqlDB, err := Open(filepath.Join(t.TempDir(), "q.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	return sqlDB
}

func execAll(t *testing.T, sqlDB *sql.DB, stmts ...string) {
	t.Helper()
	for _, s := range stmts {
		if _, err := sqlDB.Exec(s); err != nil {
			t.Fatalf("%s: %v", s, err)
		}
	}
}

func TestMigration038StudyTables(t *testing.T) {
	sqlDB := openMigrated(t)
	for _, tb := range studyTables {
		want := append(append([]string{"user_id", "workspace_id"}, tb.cols...), syncColumns...)
		got := queryStrings(t, sqlDB, `SELECT name FROM pragma_table_info('`+tb.name+`') ORDER BY cid`)
		if !sameSet(got, want) {
			t.Errorf("%s columns = %v, want %v", tb.name, got, want)
		}
		pk := queryStrings(t, sqlDB, `SELECT name FROM pragma_table_info('`+tb.name+`') WHERE pk > 0 ORDER BY pk`)
		if !reflect.DeepEqual(pk, tb.pk) {
			t.Errorf("%s primary key = %v, want %v", tb.name, pk, tb.pk)
		}
		idx := queryStrings(t, sqlDB, `SELECT group_concat(ii.name, ',') FROM pragma_index_list('`+tb.name+`') il,
			pragma_index_info(il.name) ii WHERE il.origin = 'c' GROUP BY il.name`)
		if !contains(idx, "user_id,updated_at") {
			t.Errorf("%s indexes = %v, want one on (user_id, updated_at)", tb.name, idx)
		}
		fks := queryStrings(t, sqlDB, `SELECT "from" || '>' || "table" FROM pragma_foreign_key_list('`+tb.name+`') ORDER BY "from"`)
		if !reflect.DeepEqual(fks, []string{"user_id>users", "workspace_id>workspaces"}) {
			t.Errorf("%s foreign keys = %v", tb.name, fks)
		}
	}
	idx := queryStrings(t, sqlDB, `SELECT group_concat(ii.name, ',') FROM pragma_index_list('study_cards') il,
		pragma_index_info(il.name) ii WHERE il.origin = 'c' GROUP BY il.name`)
	if !contains(idx, "user_id,workspace_id,entry_id") {
		t.Errorf("study_cards indexes = %v, want one on (user_id, workspace_id, entry_id)", idx)
	}

	execAll(t, sqlDB,
		`INSERT INTO users (id, username, hash, admin, updated_at) VALUES (1, 'alice', 'h', 1, 't')`,
		`INSERT INTO workspaces (id, user_id, language, name, settings, updated_at) VALUES (7, 1, 'zh', '', '{}', 't')`)
	ok := []string{
		`INSERT INTO study_cards (user_id, workspace_id, id, kind, entry_id, created_at, version, updated_at, modified_at) VALUES (1, 7, 'c1', 'vocab', 1, 't', 1, 't', 't')`,
		`INSERT INTO study_cards (user_id, workspace_id, id, kind, entry_id, entry_kind, sentence_id, written, skip_kinds, deck_ids, created_at, extra, version, updated_at, modified_at, deleted_at)
			VALUES (1, 7, 'c2', 'cloze', 1, 'character', 5, 'w', '["tone"]', '["general"]', 't', '{"a":1}', 1, 't', 't', 't')`,
		`INSERT INTO study_decks (user_id, workspace_id, id, name, created_at, source, version, updated_at, modified_at) VALUES (1, 7, 'd1', 'n', 't', '{"type":"level","packId":"p","level":"1"}', 1, 't', 't')`,
		`INSERT INTO study_deck_settings (user_id, workspace_id, deck_id, card_types, new_order, version, updated_at, modified_at) VALUES (1, 7, 'general', '["reverse"]', '{"by":"added"}', 1, 't', 't')`,
		`INSERT INTO study_limits (user_id, workspace_id, deck_id, new_set, new_limit, reviews_set, reviews_limit, version, updated_at, modified_at) VALUES (1, 7, '', 1, 9999, 1, NULL, 1, 't', 't')`,
		`INSERT INTO study_limits (user_id, workspace_id, deck_id, new_set, new_limit, reviews_set, reviews_limit, version, updated_at, modified_at) VALUES (1, 7, 'general', 0, NULL, 1, 0, 1, 't', 't')`,
		`INSERT INTO study_fsrs_sets (user_id, workspace_id, id, w, created_at, source, labelled, version, updated_at, modified_at) VALUES (1, 7, 's1', '[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]', 't', 'imported', 3, 1, 't', 't')`,
		`INSERT INTO study_fsrs_active (user_id, workspace_id, set_id, changed_at, version, updated_at, modified_at) VALUES (1, 7, NULL, NULL, 1, 't', 't')`,
	}
	execAll(t, sqlDB, ok...)
	bad := []string{
		`INSERT INTO study_cards (user_id, workspace_id, id, kind, entry_id, created_at, version, updated_at, modified_at) VALUES (1, 7, 'x1', 'x', 1, 't', 1, 't', 't')`,
		`INSERT INTO study_cards (user_id, workspace_id, id, kind, entry_id, entry_kind, created_at, version, updated_at, modified_at) VALUES (1, 7, 'x2', 'vocab', 1, 'word', 't', 1, 't', 't')`,
		`INSERT INTO study_cards (user_id, workspace_id, id, kind, entry_id, created_at, extra, version, updated_at, modified_at) VALUES (1, 7, 'x3', 'vocab', 1, 't', '[]', 1, 't', 't')`,
		`INSERT INTO study_cards (user_id, workspace_id, id, kind, entry_id, created_at, extra, version, updated_at, modified_at) VALUES (1, 7, 'x4', 'vocab', 1, 't', 'not json', 1, 't', 't')`,
		`INSERT INTO study_cards (user_id, workspace_id, id, kind, entry_id, created_at, deck_ids, version, updated_at, modified_at) VALUES (1, 7, 'x5', 'vocab', 1, 't', '{}', 1, 't', 't')`,
		`INSERT INTO study_cards (user_id, workspace_id, id, kind, entry_id, created_at, version, updated_at, modified_at) VALUES (1, 7, 'c1', 'vocab', 1, 't', 1, 't', 't')`,
		`INSERT INTO study_decks (user_id, workspace_id, id, name, created_at, source, version, updated_at, modified_at) VALUES (1, 7, 'd2', 'n', 't', '[]', 1, 't', 't')`,
		`INSERT INTO study_deck_settings (user_id, workspace_id, deck_id, version, updated_at, modified_at) VALUES (1, 7, '', 1, 't', 't')`,
		`INSERT INTO study_limits (user_id, workspace_id, deck_id, new_set, new_limit, reviews_set, version, updated_at, modified_at) VALUES (1, 7, 'd9', 1, 10000, 0, 1, 't', 't')`,
		`INSERT INTO study_limits (user_id, workspace_id, deck_id, new_set, new_limit, reviews_set, version, updated_at, modified_at) VALUES (1, 7, 'd9', 1, -1, 0, 1, 't', 't')`,
		`INSERT INTO study_limits (user_id, workspace_id, deck_id, new_set, new_limit, reviews_set, version, updated_at, modified_at) VALUES (1, 7, 'd9', 0, 5, 0, 1, 't', 't')`,
		`INSERT INTO study_limits (user_id, workspace_id, deck_id, new_set, reviews_set, version, updated_at, modified_at) VALUES (1, 7, 'd9', 2, 0, 1, 't', 't')`,
		`INSERT INTO study_fsrs_sets (user_id, workspace_id, id, w, created_at, source, version, updated_at, modified_at) VALUES (1, 7, 's2', '[0]', 't', 'other', 1, 't', 't')`,
		`INSERT INTO study_fsrs_sets (user_id, workspace_id, id, w, created_at, source, version, updated_at, modified_at) VALUES (1, 7, 's3', '[0]', 't', 'optimized', 1, 't', 't')`,
		`INSERT INTO study_fsrs_active (user_id, workspace_id, version, updated_at, modified_at) VALUES (1, 7, 1, 't', 't')`,
	}
	for _, s := range bad {
		if _, err := sqlDB.Exec(s); err == nil {
			t.Errorf("accepted: %s", s)
		}
	}

	// foreign keys hold when enforced
	if _, err := sqlDB.Exec(`PRAGMA foreign_keys = ON`); err != nil {
		t.Fatal(err)
	}
	if got := queryStrings(t, sqlDB, `SELECT "table" FROM pragma_foreign_key_check`); len(got) != 0 {
		t.Errorf("foreign_key_check = %v", got)
	}
}

func TestMigration038LibraryStampsAndDeletionLog(t *testing.T) {
	path := filepath.Join(t.TempDir(), "lib.db")
	sqlDB, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	if err := migrateThrough(sqlDB, "037_access_tokens"); err != nil {
		t.Fatal(err)
	}
	execAll(t, sqlDB,
		`INSERT INTO users (id, username, hash, admin, updated_at) VALUES (1, 'alice', 'h', 1, 't')`,
		`INSERT INTO workspaces (id, user_id, language, name, settings, updated_at) VALUES (3, 1, 'ja', '', '{}', 't')`,
		`INSERT INTO library_books (id, user_id, workspace_id, language, title, position, created_at) VALUES (2, 1, 3, 'ja', 'Neko', '1:2', '2026-01-01T00:00:00Z')`,
		`INSERT INTO library_bookmarks (id, user_id, book_id, position, label, created_at) VALUES (4, 1, 2, '1:2', 'here', '2026-01-02T00:00:00Z')`,
		`INSERT INTO library_bookmarks (id, user_id, book_id, position, label, created_at) VALUES (8, 1, 2, '3:0', '', '2026-01-03T00:00:00Z')`,
		`INSERT INTO library_highlights (id, user_id, book_id, chapter, paragraph, start_cp, end_cp, text, color, note, created_at, updated_at)
			VALUES (6, 1, 2, 0, 1, 0, 2, 'ab', 'green', 'n', '2026-01-04T00:00:00Z', '2026-01-05T00:00:00Z')`,
		`INSERT INTO library_highlights (id, user_id, book_id, chapter, paragraph, start_cp, end_cp, text, created_at, updated_at)
			VALUES (9, 1, 2, 0, 2, 0, 1, 'c', '2026-01-04T00:00:00Z', '2026-01-04T00:00:00Z')`,
	)
	const bmQ = `SELECT id || '|' || user_id || '|' || book_id || '|' || position || '|' || label || '|' || created_at FROM library_bookmarks ORDER BY id`
	const hlQ = `SELECT id || '|' || user_id || '|' || book_id || '|' || chapter || '|' || paragraph || '|' || start_cp || '|' || end_cp || '|' ||
		text || '|' || color || '|' || note || '|' || created_at || '|' || updated_at FROM library_highlights ORDER BY id`
	bmBefore, hlBefore := queryStrings(t, sqlDB, bmQ), queryStrings(t, sqlDB, hlQ)

	if err := migrateThrough(sqlDB, "038_core_study"); err != nil {
		t.Fatal(err)
	}
	if got := queryStrings(t, sqlDB, bmQ); !reflect.DeepEqual(got, bmBefore) {
		t.Errorf("bookmarks = %v, want %v", got, bmBefore)
	}
	if got := queryStrings(t, sqlDB, hlQ); !reflect.DeepEqual(got, hlBefore) {
		t.Errorf("highlights = %v, want %v", got, hlBefore)
	}
	if got := queryStrings(t, sqlDB, `SELECT id || '|' || updated_at FROM library_books`); !reflect.DeepEqual(got, []string{"2|2026-01-01T00:00:00Z"}) {
		t.Errorf("book updated_at = %v, want created_at", got)
	}
	if got := queryStrings(t, sqlDB, `SELECT id || '|' || updated_at FROM library_bookmarks ORDER BY id`); !reflect.DeepEqual(got, []string{"4|2026-01-02T00:00:00Z", "8|2026-01-03T00:00:00Z"}) {
		t.Errorf("bookmark updated_at = %v, want created_at", got)
	}
	for _, tb := range []string{"library_bookmarks", "library_highlights"} {
		sqlText := queryStrings(t, sqlDB, `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = '`+tb+`'`)
		if len(sqlText) != 1 || !strings.Contains(sqlText[0], "AUTOINCREMENT") {
			t.Errorf("%s schema = %v, want AUTOINCREMENT", tb, sqlText)
		}
	}
	if got := queryStrings(t, sqlDB, `SELECT name || '|' || seq FROM sqlite_sequence WHERE name IN ('library_bookmarks', 'library_highlights') ORDER BY name`); !reflect.DeepEqual(got, []string{"library_bookmarks|8", "library_highlights|9"}) {
		t.Errorf("sqlite_sequence = %v", got)
	}
	if got := queryStrings(t, sqlDB, `SELECT name || '|' || sql FROM sqlite_master WHERE type = 'index' AND tbl_name IN ('library_bookmarks', 'library_highlights') AND sql IS NOT NULL ORDER BY name`); !reflect.DeepEqual(got, []string{
		"idx_library_bookmarks_position|CREATE UNIQUE INDEX idx_library_bookmarks_position ON library_bookmarks (book_id, position)",
		"idx_library_highlights_position|CREATE INDEX idx_library_highlights_position ON library_highlights (book_id, chapter, paragraph, start_cp)",
	}) {
		t.Errorf("indexes = %v", got)
	}
	if got := queryStrings(t, sqlDB, `SELECT name FROM sqlite_master WHERE sql LIKE '%_new%' AND tbl_name LIKE 'library_%'`); len(got) != 0 {
		t.Errorf("schema still names a temporary table: %v", got)
	}
	// Deleted top ids are not handed out again.
	execAll(t, sqlDB, `DELETE FROM library_bookmarks WHERE id = 8`, `DELETE FROM library_highlights WHERE id = 9`)
	var bm, hl int64
	if err := sqlDB.QueryRow(`INSERT INTO library_bookmarks (user_id, book_id, position, created_at, updated_at) VALUES (1, 2, '9:9', 't', 't') RETURNING id`).Scan(&bm); err != nil {
		t.Fatal(err)
	}
	if err := sqlDB.QueryRow(`INSERT INTO library_highlights (user_id, book_id, chapter, paragraph, start_cp, end_cp, text, created_at, updated_at) VALUES (1, 2, 5, 5, 0, 1, 'x', 't', 't') RETURNING id`).Scan(&hl); err != nil {
		t.Fatal(err)
	}
	if bm <= 8 || hl <= 9 {
		t.Errorf("new ids bookmark %d highlight %d reuse a deleted id", bm, hl)
	}
	// The unique bookmark position survives.
	if _, err := sqlDB.Exec(`INSERT INTO library_bookmarks (user_id, book_id, position, created_at) VALUES (1, 2, '1:2', 't')`); err == nil {
		t.Error("duplicate bookmark position accepted")
	}

	// library_deletions
	cols := queryStrings(t, sqlDB, `SELECT name FROM pragma_table_info('library_deletions') ORDER BY cid`)
	if !reflect.DeepEqual(cols, []string{"user_id", "collection", "row_id", "workspace_id", "deleted_at"}) {
		t.Errorf("library_deletions columns = %v", cols)
	}
	pk := queryStrings(t, sqlDB, `SELECT name FROM pragma_table_info('library_deletions') WHERE pk > 0 ORDER BY pk`)
	if !reflect.DeepEqual(pk, []string{"collection", "row_id"}) {
		t.Errorf("library_deletions pk = %v", pk)
	}
	idx := queryStrings(t, sqlDB, `SELECT group_concat(ii.name, ',') FROM pragma_index_list('library_deletions') il,
		pragma_index_info(il.name) ii WHERE il.origin = 'c' GROUP BY il.name`)
	if !contains(idx, "user_id,deleted_at") {
		t.Errorf("library_deletions indexes = %v", idx)
	}
	execAll(t, sqlDB, `INSERT INTO library_deletions (user_id, collection, row_id, workspace_id, deleted_at) VALUES (1, 'books', 2, 3, 't')`)
	if _, err := sqlDB.Exec(`INSERT INTO library_deletions (user_id, collection, row_id, workspace_id, deleted_at) VALUES (1, 'notes', 2, 3, 't')`); err == nil {
		t.Error("library_deletions accepted collection 'notes'")
	}
	if _, err := sqlDB.Exec(`PRAGMA foreign_keys = ON`); err != nil {
		t.Fatal(err)
	}
	if got := queryStrings(t, sqlDB, `SELECT "table" FROM pragma_foreign_key_check`); len(got) != 0 {
		t.Errorf("foreign_key_check = %v", got)
	}
	if got := queryStrings(t, sqlDB, `PRAGMA integrity_check`); !reflect.DeepEqual(got, []string{"ok"}) {
		t.Errorf("integrity_check = %v", got)
	}
}

func sameSet(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	m := map[string]int{}
	for _, s := range a {
		m[s]++
	}
	for _, s := range b {
		m[s]--
	}
	for _, n := range m {
		if n != 0 {
			return false
		}
	}
	return true
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}
