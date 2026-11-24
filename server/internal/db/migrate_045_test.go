package db_test

import (
	"testing"

	"qinqin/internal/db"
)

// Migration 045 (#199): grammar lesson progress leaves plugin data for a
// typed table; rows that decode are copied, the rest of qinqin-grammar goes.
func TestMigration045GrammarProgress(t *testing.T) {
	sqlDB := open030(t)
	if err := db.MigrateThrough(sqlDB, "044_journal"); err != nil {
		t.Fatal(err)
	}
	put := func(ws any, key, data string, deleted any) {
		t.Helper()
		if _, err := sqlDB.Exec(`INSERT INTO plugin_data (pack_id, user_id, workspace_id, key, data, version, updated_at, deleted_at)
			VALUES ('qinqin-grammar', 1, ?, ?, ?, 1, '2026-11-20T10:00:00Z', ?)`, ws, key, data, deleted); err != nil {
			t.Fatal(err)
		}
	}
	put(5, "lesson:zh-grammar:le-change", `{"completedAt":"2026-11-19T08:00:00Z","best":3,"total":4}`, nil)
	put(5, "lesson:zh-grammar:ba", `{"completedAt":"2026-11-19T08:00:00Z","best":5,"total":4}`, nil)
	put(5, "lesson:zh-grammar:shi", `{"best":1,"total":4}`, nil)
	put(5, "lesson:zh-grammar:gone", `{"completedAt":"2026-11-19T08:00:00Z","best":1,"total":4}`, "2026-11-20T11:00:00Z")
	put(5, "lesson:nocolon", `{"completedAt":"2026-11-19T08:00:00Z","best":1,"total":4}`, nil)
	put(nil, "lesson:zh-grammar:global", `{"completedAt":"2026-11-19T08:00:00Z","best":1,"total":4}`, nil)
	put(5, "other", `{}`, nil)
	if err := db.MigrateThrough(sqlDB, "045_grammar_progress"); err != nil {
		t.Fatal(err)
	}
	var pack, lesson, completed, updated string
	var best, total, n int
	if err := sqlDB.QueryRow(`SELECT pack_id, lesson_id, completed_at, best, total, updated_at FROM grammar_progress WHERE user_id = 1 AND workspace_id = 5 AND lesson_id = 'le-change'`).
		Scan(&pack, &lesson, &completed, &best, &total, &updated); err != nil {
		t.Fatal(err)
	}
	if pack != "zh-grammar" || lesson != "le-change" || completed != "2026-11-19T08:00:00Z" || best != 3 || total != 4 || updated != "2026-11-20T10:00:00Z" {
		t.Errorf("progress = %s %s %s %d/%d %s", pack, lesson, completed, best, total, updated)
	}
	// shi has no completedAt: the row's write time stands in (fix wave).
	if err := sqlDB.QueryRow(`SELECT completed_at FROM grammar_progress WHERE lesson_id = 'shi'`).Scan(&completed); err != nil || completed != "2026-11-20T10:00:00Z" {
		t.Errorf("shi completed %q (%v)", completed, err)
	}
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM grammar_progress`).Scan(&n); err != nil || n != 2 {
		t.Errorf("%d rows (%v), want 2", n, err)
	}
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM plugin_data WHERE pack_id = 'qinqin-grammar'`).Scan(&n); err != nil || n != 0 {
		t.Errorf("%d grammar plugin rows left (%v)", n, err)
	}
	for _, bad := range []string{
		`INSERT INTO grammar_progress VALUES (1, 5, 'p', 'l', 'c', 5, 4, 'u')`,
		`INSERT INTO grammar_progress VALUES (1, 5, 'p', 'l', 'c', -1, 4, 'u')`,
		`INSERT INTO grammar_progress VALUES (1, 5, '', 'l', 'c', 1, 4, 'u')`,
	} {
		if _, err := sqlDB.Exec(bad); err == nil {
			t.Errorf("accepted: %s", bad)
		}
	}
}

// A messy populated database (#199 fix wave): a missing or unreadable
// completedAt becomes the row's write time; a pack or lesson id, score or
// total the progress rules refuse drops the row (a restore would refuse it
// too). The migration never fails.
func TestMigration045MessyRows(t *testing.T) {
	sqlDB := open030(t)
	if err := db.MigrateThrough(sqlDB, "044_journal"); err != nil {
		t.Fatal(err)
	}
	put := func(key, data string) {
		t.Helper()
		if _, err := sqlDB.Exec(`INSERT INTO plugin_data (pack_id, user_id, workspace_id, key, data, version, updated_at)
			VALUES ('qinqin-grammar', 1, 5, ?, ?, 1, '2026-11-20T10:00:00Z')`, key, data); err != nil {
			t.Fatal(err)
		}
	}
	put("lesson:zh-grammar:empty-stamp", `{"completedAt":"","best":1,"total":2}`)
	put("lesson:zh-grammar:bad-stamp", `{"completedAt":"yesterday","best":1,"total":2}`)
	put("lesson:zh grammar:space", `{"completedAt":"2026-11-19T08:00:00Z","best":1,"total":2}`)
	put("lesson:zh-grammar:Le_Change", `{"completedAt":"2026-11-19T08:00:00Z","best":1,"total":2}`)
	put("lesson:zh-grammar:half", `{"completedAt":"2026-11-19T08:00:00Z","best":1.5,"total":2}`)
	put("lesson:zh-grammar:huge", `{"completedAt":"2026-11-19T08:00:00Z","best":1,"total":1001}`)
	put("lesson:zh-grammar:a:b", `{"completedAt":"2026-11-19T08:00:00Z","best":1,"total":2}`)
	put("lesson:zh-grammar:notjson", `nope`)
	if err := db.MigrateThrough(sqlDB, "045_grammar_progress"); err != nil {
		t.Fatalf("migration 045 on messy rows: %v", err)
	}
	got := map[string]string{}
	rows, err := sqlDB.Query(`SELECT lesson_id, completed_at FROM grammar_progress`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var l, c string
		rows.Scan(&l, &c)
		got[l] = c
	}
	rows.Close()
	want := map[string]string{"empty-stamp": "2026-11-20T10:00:00Z", "bad-stamp": "2026-11-20T10:00:00Z"}
	if len(got) != len(want) || got["empty-stamp"] != want["empty-stamp"] || got["bad-stamp"] != want["bad-stamp"] {
		t.Errorf("progress = %v, want %v", got, want)
	}
}
