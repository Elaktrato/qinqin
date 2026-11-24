package db_test

import (
	"strings"
	"testing"

	"qinqin/internal/db"
)

// Migration 046 (#199): plugin_data becomes keyed_rows; only the accepted
// families, in their scopes, of the former core and study namespaces stay.
func TestMigration046KeyedRows(t *testing.T) {
	sqlDB := open030(t)
	if err := db.MigrateThrough(sqlDB, "045_grammar_progress"); err != nil {
		t.Fatal(err)
	}
	put := func(pack string, ws any, key string, modified any, deleted any) {
		t.Helper()
		if _, err := sqlDB.Exec(`INSERT INTO plugin_data (pack_id, user_id, workspace_id, key, data, version, updated_at, modified_at, deleted_at)
			VALUES (?, 1, ?, ?, '{"v":1}', 3, '2026-11-20T10:00:00Z', ?, ?)`, pack, ws, key, modified, deleted); err != nil {
			t.Fatal(err)
		}
	}
	put("qinqin-core", 5, "note:12", "2026-11-20T09:00:00Z", nil)
	put("qinqin-core", 5, "notecfg", nil, nil)
	put("qinqin-core", nil, "home-layout", nil, nil)
	put("qinqin-core", nil, "appearance", nil, "2026-11-20T11:00:00Z")
	put("qinqin-flashcards", 5, "known:7", nil, nil)
	put("qinqin-flashcards", nil, "vacation:V1", nil, nil)
	put("qinqin-flashcards", 5, "milestone:reviews:1000", nil, nil)
	put("qinqin-flashcards", 5, "goals:workspace", nil, nil)
	// dropped: wrong scope, unknown keys, other plugins, typed leftovers
	put("qinqin-core", nil, "note:13", nil, nil)
	put("qinqin-flashcards", 5, "vacation:V2", nil, nil)
	put("qinqin-flashcards", 5, "knownfilter", nil, nil)
	put("qinqin-flashcards", 5, "card:c-vocab-1", nil, nil)
	put("qinqin-heatmap", 5, "note:1", nil, nil)
	put("qinqin-core", 5, "note:", nil, nil)
	if err := db.MigrateThrough(sqlDB, "046_keyed_rows"); err != nil {
		t.Fatal(err)
	}
	rows, err := sqlDB.Query(`SELECT IFNULL(workspace_id, 0) || '|' || key || '|' || data || '|' || version || '|' || updated_at || '|' || modified_at || '|' || IFNULL(deleted_at, '-')
		FROM keyed_rows WHERE user_id = 1 ORDER BY IFNULL(workspace_id, 0), key`)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for rows.Next() {
		var s string
		rows.Scan(&s)
		got = append(got, s)
	}
	rows.Close()
	want := []string{
		`0|appearance|{"v":1}|3|2026-11-20T10:00:00Z|2026-11-20T10:00:00Z|2026-11-20T11:00:00Z`,
		`0|home-layout|{"v":1}|3|2026-11-20T10:00:00Z|2026-11-20T10:00:00Z|-`,
		`0|vacation:V1|{"v":1}|3|2026-11-20T10:00:00Z|2026-11-20T10:00:00Z|-`,
		`5|goals:workspace|{"v":1}|3|2026-11-20T10:00:00Z|2026-11-20T10:00:00Z|-`,
		`5|known:7|{"v":1}|3|2026-11-20T10:00:00Z|2026-11-20T10:00:00Z|-`,
		`5|milestone:reviews:1000|{"v":1}|3|2026-11-20T10:00:00Z|2026-11-20T10:00:00Z|-`,
		`5|note:12|{"v":1}|3|2026-11-20T10:00:00Z|2026-11-20T09:00:00Z|-`,
		`5|notecfg|{"v":1}|3|2026-11-20T10:00:00Z|2026-11-20T10:00:00Z|-`,
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Errorf("keyed_rows:\n%s\nwant\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
	var n int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE name = 'plugin_data'`).Scan(&n); err != nil || n != 0 {
		t.Errorf("plugin_data still exists (%d, %v)", n, err)
	}
	if _, err := sqlDB.Exec(`INSERT INTO keyed_rows (user_id, workspace_id, key, data, version, updated_at, modified_at) VALUES (1, NULL, 'home-layout', '{}', 1, 't', 't')`); err == nil {
		t.Error("a second user-global home-layout row accepted")
	}
}

// A messy populated database (#199 fix wave): the old API let every
// data-owning plugin keep any key, so one user can hold the same key in both
// former namespaces. The migration keeps one row per key — the newest edit,
// on a tie the family's own namespace — and never fails.
func TestMigration046DuplicateKeysAcrossNamespaces(t *testing.T) {
	sqlDB := open030(t)
	if err := db.MigrateThrough(sqlDB, "045_grammar_progress"); err != nil {
		t.Fatal(err)
	}
	put := func(pack string, ws any, key, data string, updated string, modified any) {
		t.Helper()
		if _, err := sqlDB.Exec(`INSERT INTO plugin_data (pack_id, user_id, workspace_id, key, data, version, updated_at, modified_at)
			VALUES (?, 1, ?, ?, ?, 1, ?, ?)`, pack, ws, key, data, updated, modified); err != nil {
			t.Fatal(err)
		}
	}
	// the newer edit wins, whichever namespace holds it
	put("qinqin-core", nil, "appearance", `"core-old"`, "2026-11-20T10:00:00Z", "2026-11-20T09:00:00Z")
	put("qinqin-flashcards", nil, "appearance", `"study-new"`, "2026-11-20T10:00:00Z", "2026-11-20T09:30:00Z")
	// a tie goes to the family's namespace: known marks are the study namespace's, notes the core's
	put("qinqin-core", 5, "known:7", `"core"`, "2026-11-20T10:00:00Z", nil)
	put("qinqin-flashcards", 5, "known:7", `"study"`, "2026-11-20T10:00:00Z", nil)
	put("qinqin-flashcards", 5, "note:3", `"study"`, "2026-11-20T10:00:00Z", nil)
	put("qinqin-core", 5, "note:3", `"core"`, "2026-11-20T10:00:00Z", nil)
	if err := db.MigrateThrough(sqlDB, "046_keyed_rows"); err != nil {
		t.Fatalf("migration 046 on duplicate keys: %v", err)
	}
	got := map[string]string{}
	rows, err := sqlDB.Query(`SELECT key, data FROM keyed_rows WHERE user_id = 1`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var k, d string
		rows.Scan(&k, &d)
		got[k] = d
	}
	rows.Close()
	want := map[string]string{"appearance": `"study-new"`, "known:7": `"study"`, "note:3": `"core"`}
	if len(got) != len(want) {
		t.Errorf("rows = %v, want %v", got, want)
	}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("%s = %s, want %s", k, got[k], v)
		}
	}
}
