package db

import (
	"database/sql"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/oklog/ulid/v2"
)

// Migration 039 (#93): the data package registry, pack licence texts, the
// strokes store, the server instance id and the (user_id, updated_at)
// indexes the paged pull walks.

func TestMigration039Tables(t *testing.T) {
	sqlDB := openMigrated(t)
	for table, want := range map[string]struct{ cols, pk []string }{
		"server_meta": {[]string{"key", "value"}, []string{"key"}},
		"pack_texts":  {[]string{"pack_type", "pack_id", "name", "text"}, []string{"pack_type", "pack_id", "name"}},
		"packages": {[]string{"id", "type", "languages", "format_version", "revision", "content_hash", "file_sha256",
			"bytes", "built_at", "state", "error", "requires", "optional", "sources", "license_texts", "updated_at",
			"deleted_at"}, []string{"id"}},
		"package_files": {[]string{"id", "revision", "sha256", "bytes", "retire_after"}, []string{"id", "revision"}},
		"stroke_packs": {[]string{"pack_id", "name", "version", "languages", "license", "attribution", "notice",
			"content_hash", "ord", "updated_at", "deleted_at"}, []string{"pack_id"}},
		"strokes": {[]string{"pack_id", "char", "data"}, []string{"char", "pack_id"}},
	} {
		got := queryStrings(t, sqlDB, `SELECT name FROM pragma_table_info('`+table+`') ORDER BY cid`)
		if !sameSet(got, want.cols) {
			t.Errorf("%s columns = %v, want %v", table, got, want.cols)
		}
		pk := queryStrings(t, sqlDB, `SELECT name FROM pragma_table_info('`+table+`') WHERE pk > 0 ORDER BY pk`)
		if strings.Join(pk, ",") != strings.Join(want.pk, ",") {
			t.Errorf("%s primary key = %v, want %v", table, pk, want.pk)
		}
	}

	pkg := `INSERT INTO packages (id, type, languages, format_version, revision, content_hash, file_sha256, bytes, state, updated_at)
		VALUES ('lexicon.zh', 'lexicon', '["zh"]', 1, 0, '', '', 0, ?, 't')`
	for _, state := range []string{"building", "ready", "failed", "deleted"} {
		if _, err := sqlDB.Exec(`DELETE FROM packages`); err != nil {
			t.Fatal(err)
		}
		if _, err := sqlDB.Exec(pkg, state); err != nil {
			t.Errorf("state %q refused: %v", state, err)
		}
	}
	sqlDB.Exec(`DELETE FROM packages`)
	if _, err := sqlDB.Exec(pkg, "stale"); err == nil {
		t.Error("state stale accepted, want the CHECK to refuse it")
	}
	var errText, requires, sources string
	var optional, texts int
	if _, err := sqlDB.Exec(pkg, "building"); err != nil {
		t.Fatal(err)
	}
	if err := sqlDB.QueryRow(`SELECT error, requires, optional, sources, license_texts FROM packages`).Scan(&errText, &requires, &optional, &sources, &texts); err != nil {
		t.Fatal(err)
	}
	if errText != "" || requires != "[]" || optional != 0 || sources != "[]" || texts != 0 {
		t.Errorf("packages defaults = %q %q %d %q %d", errText, requires, optional, sources, texts)
	}
	if _, err := sqlDB.Exec(`INSERT INTO strokes (pack_id, char, data) VALUES ('a', '好', '{}'), ('b', '好', '{}')`); err != nil {
		t.Errorf("one character in two stroke packs: %v", err)
	}
	if _, err := sqlDB.Exec(`INSERT INTO strokes (pack_id, char, data) VALUES ('a', '好', '{}')`); err == nil {
		t.Error("a duplicate (char, pack_id) was accepted")
	}
}

func instanceID(t *testing.T, sqlDB *sql.DB) string {
	t.Helper()
	var id string
	if err := sqlDB.QueryRow(`SELECT value FROM server_meta WHERE key = 'instance_id'`).Scan(&id); err != nil {
		t.Fatalf("read instance_id: %v", err)
	}
	return id
}

func TestMigration039InstanceIDIsAStableULID(t *testing.T) {
	sqlDB := openMigrated(t)
	id := instanceID(t, sqlDB)
	if len(id) != 26 {
		t.Fatalf("instance_id %q: want 26 characters", id)
	}
	if _, err := ulid.ParseStrict(id); err != nil {
		t.Fatalf("instance_id %q is not a ULID: %v", id, err)
	}
	if err := Migrate(sqlDB); err != nil {
		t.Fatal(err)
	}
	if again := instanceID(t, sqlDB); again != id {
		t.Errorf("a second Migrate changed instance_id %q -> %q", id, again)
	}
	if n := queryStrings(t, sqlDB, `SELECT CAST(COUNT(*) AS TEXT) FROM server_meta`); n[0] != "1" {
		t.Errorf("server_meta rows = %v, want 1", n)
	}

	other := openMigrated(t)
	if instanceID(t, other) == id {
		t.Error("two fresh databases got the same instance_id")
	}
}

// An existing v0.4 database (migrated through 038) gets its instance id on upgrade.
func TestMigration039UpgradesAn038Database(t *testing.T) {
	sqlDB, err := OpenThrough(filepath.Join(t.TempDir(), "q.db"), "038_core_study")
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	execAll(t, sqlDB,
		`INSERT INTO users (id, username, hash, admin, updated_at) VALUES (1, 'alice', 'h', 1, 't')`,
		`INSERT INTO workspaces (id, user_id, language, name, settings, updated_at) VALUES (7, 1, 'zh', '', '{}', 't')`)
	if err := Migrate(sqlDB); err != nil {
		t.Fatal(err)
	}
	if _, err := ulid.ParseStrict(instanceID(t, sqlDB)); err != nil {
		t.Fatal(err)
	}
	if n := queryStrings(t, sqlDB, `SELECT CAST(COUNT(*) AS TEXT) FROM workspaces`); n[0] != "1" {
		t.Errorf("workspaces after upgrade = %v", n)
	}
}

// keysetTables are the user tables the paged pull (sync v2) walks by
// (updated_at, rowid) per user; stamp is the column it pages over and
// extra a filter the real query adds. The query shape below is a literal
// copy of the keyset scan (server/internal/sync/page.go, B1): keep them in
// step.
var keysetTables = []struct{ table, stamp, extra string }{
	{"workspaces", "updated_at", ""},
	{"plugin_states", "updated_at", ""},
	{"keyed_rows", "updated_at", " AND (workspace_id IS NULL OR workspace_id = 7)"},
	{"study_cards", "updated_at", " AND workspace_id = 7"},
	{"study_decks", "updated_at", ""},
	{"study_deck_settings", "updated_at", ""},
	{"study_limits", "updated_at", ""},
	{"study_fsrs_sets", "updated_at", ""},
	{"study_fsrs_active", "updated_at", ""},
	{"library_books", "updated_at", " AND workspace_id = 7"},
	{"library_bookmarks", "updated_at", ""},
	{"library_highlights", "updated_at", ""},
	{"library_deletions", "deleted_at", " AND collection = 'books'"},
	{"user_edits", "updated_at", ""},
	{"sentences", "updated_at", ""},
	{"study_events", "updated_at", " AND type <> 'lookup'"},
}

func keysetQuery(table, stamp, extra string) string {
	return fmt.Sprintf(`SELECT rowid FROM %[1]s
		WHERE user_id = ?1 AND %[2]s >= ?2 AND %[2]s < ?3%[3]s
		  AND (%[2]s > ?4 OR (%[2]s = ?4 AND rowid > ?5))
		ORDER BY %[2]s, rowid LIMIT ?6`, table, stamp, extra)
}

func TestMigration039PagingIndexes(t *testing.T) {
	sqlDB := openMigrated(t)
	for _, tb := range keysetTables {
		if tb.stamp != "updated_at" {
			continue
		}
		idx := queryStrings(t, sqlDB, `SELECT group_concat(ii.name, ',') FROM pragma_index_list('`+tb.table+`') il,
			pragma_index_info(il.name) ii WHERE il.origin = 'c' GROUP BY il.name`)
		if !contains(idx, "user_id,updated_at") {
			t.Errorf("%s indexes = %v, want one on (user_id, updated_at)", tb.table, idx)
		}
	}
	var partial string
	if err := sqlDB.QueryRow(`SELECT sql FROM sqlite_master WHERE name = 'idx_sentences_user_updated'`).Scan(&partial); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(partial, "WHERE user_id IS NOT NULL") {
		t.Errorf("idx_sentences_user_updated = %q, want partial on own sentences", partial)
	}
}

// Every keyset scan of the paged pull reads an index range in order: no
// full table scan and no sort.
func TestMigration039KeysetScansUseAnIndex(t *testing.T) {
	sqlDB := openMigrated(t)
	for _, tb := range keysetTables {
		q := keysetQuery(tb.table, tb.stamp, tb.extra)
		rows, err := sqlDB.Query(`EXPLAIN QUERY PLAN `+q, 1, "a", "b", "a", 0, 10)
		if err != nil {
			t.Fatalf("%s: %v", tb.table, err)
		}
		var plan []string
		for rows.Next() {
			var id, parent, notUsed int
			var detail string
			if err := rows.Scan(&id, &parent, &notUsed, &detail); err != nil {
				t.Fatal(err)
			}
			plan = append(plan, detail)
		}
		rows.Close()
		text := strings.Join(plan, " | ")
		if !strings.Contains(text, "USING INDEX") && !strings.Contains(text, "USING COVERING INDEX") {
			t.Errorf("%s: plan %q uses no index", tb.table, text)
		}
		if strings.Contains(text, "TEMP B-TREE") {
			t.Errorf("%s: plan %q sorts; the index must give (stamp, rowid) order", tb.table, text)
		}
	}
}

// Entry ids are stable per server (packages and user data rely on it):
// nothing hard-deletes lexicon entries, so no code may issue DELETE FROM entries.
func TestNoCodeDeletesEntries(t *testing.T) {
	root := filepath.Join("..", "..")
	re := regexp.MustCompile(`(?i)delete\s+from\s+"?entries"?(\s|;|$|\x60)`)
	seen := 0
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || strings.HasSuffix(path, "_test.go") || !(strings.HasSuffix(path, ".go") || strings.HasSuffix(path, ".sql")) {
			return nil
		}
		seen++
		src, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if loc := re.FindIndex(src); loc != nil {
			t.Errorf("%s hard-deletes entries: %q", path, src[loc[0]:loc[1]])
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if seen < 100 {
		t.Fatalf("only %d source files scanned; the walk is broken", seen)
	}
}
