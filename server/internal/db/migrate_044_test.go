package db_test

import (
	"strings"
	"testing"

	"qinqin/internal/db"
)

// Migration 044 (#199): the journal's plugin rows become typed tables. Rows
// that map one to one are copied, everything else of qinqin-journal goes.
func TestMigration044Journal(t *testing.T) {
	sqlDB := open030(t)
	if err := db.MigrateThrough(sqlDB, "043_lemma_rules"); err != nil {
		t.Fatal(err)
	}
	put := func(ws any, key, data string, deleted any) {
		t.Helper()
		if _, err := sqlDB.Exec(`INSERT INTO plugin_data (pack_id, user_id, workspace_id, key, data, version, updated_at, deleted_at)
			VALUES ('qinqin-journal', 1, ?, ?, ?, 1, '2026-11-20T10:00:00Z', ?)`, ws, key, data, deleted); err != nil {
			t.Fatal(err)
		}
	}
	put(5, "entry:E1", `{"id":"E1","date":"2026-11-19","title":"T","text":"你好","source":"photo","createdAt":"2026-11-19T08:00:00.123Z","updatedAt":"x"}`, nil)
	put(5, "entry:E2", `{"id":"E2","date":"2026-11-19","text":"bare"}`, nil)
	put(5, "entry:E3", `{"id":"OTHER","date":"2026-11-19","text":"key mismatch"}`, nil)
	put(5, "entry:E4", `{"id":"E4","date":"soon","text":"bad date"}`, nil)
	put(5, "entry:E5", `{"id":"E5","date":"2026-11-19","text":"deleted"}`, "2026-11-20T11:00:00Z")
	put(5, "review:E1", `{"entryId":"E1","textHash":"h","annotations":[{"id":"a"}],"overall":{"summary":"s"},"model":"m","provider":"anthropic","dropped":{"notFound":1},"createdAt":"2026-11-20T09:00:00Z"}`, nil)
	put(5, "review:E9", `{"entryId":"E9","annotations":[],"overall":{}}`, nil)
	put(5, "suggestions", `{"items":[{"topic":"x"}],"model":"m","createdAt":"2026-11-20T09:00:00Z"}`, nil)
	put(5, "settings", `{"guidance":"g","explanationLanguage":"de"}`, nil)
	put(6, "settings", `not json`, nil)
	put(nil, "entry:G", `{"id":"G","date":"2026-11-19","text":"global"}`, nil)
	if _, err := sqlDB.Exec(`INSERT INTO plugin_data (pack_id, user_id, workspace_id, key, data, version, updated_at)
		VALUES ('qinqin-core', 1, 5, 'note:1', '{}', 1, '2026-11-20T10:00:00Z')`); err != nil {
		t.Fatal(err)
	}
	if err := db.MigrateThrough(sqlDB, "044_journal"); err != nil {
		t.Fatal(err)
	}

	type entry struct{ id, date, title, text, source, created, updated string }
	var got []entry
	rows, err := sqlDB.Query(`SELECT id, date, title, text, source, created_at, updated_at FROM journal_entries WHERE user_id = 1 AND workspace_id = 5 ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var e entry
		if err := rows.Scan(&e.id, &e.date, &e.title, &e.text, &e.source, &e.created, &e.updated); err != nil {
			t.Fatal(err)
		}
		got = append(got, e)
	}
	rows.Close()
	want := []entry{
		{"E1", "2026-11-19", "T", "你好", "photo", "2026-11-19T08:00:00.123Z", "2026-11-20T10:00:00Z"},
		{"E2", "2026-11-19", "", "bare", "typed", "2026-11-20T10:00:00Z", "2026-11-20T10:00:00Z"},
	}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Errorf("entries = %v, want %v", got, want)
	}
	var n int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM journal_entries`).Scan(&n); err != nil || n != 2 {
		t.Errorf("%d entries in all (%v), want 2 (a user-global row is no entry)", n, err)
	}

	var hash, ann, overall, model, provider, from, dropped, created string
	if err := sqlDB.QueryRow(`SELECT text_hash, annotations, overall, model, provider, fallback_from, dropped, created_at FROM journal_reviews
		WHERE user_id = 1 AND workspace_id = 5 AND entry_id = 'E1'`).Scan(&hash, &ann, &overall, &model, &provider, &from, &dropped, &created); err != nil {
		t.Fatal(err)
	}
	if hash != "h" || ann != `[{"id":"a"}]` || overall != `{"summary":"s"}` || model != "m" || provider != "anthropic" || from != "" ||
		dropped != `{"notFound":1}` || created != "2026-11-20T09:00:00Z" {
		t.Errorf("review = %q %q %q %q %q %q %q %q", hash, ann, overall, model, provider, from, dropped, created)
	}
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM journal_reviews`).Scan(&n); err != nil || n != 1 {
		t.Errorf("%d reviews (%v), want 1: a review of a missing entry is dropped", n, err)
	}

	var items string
	if err := sqlDB.QueryRow(`SELECT items, model, provider FROM journal_suggestions WHERE user_id = 1 AND workspace_id = 5`).Scan(&items, &model, &provider); err != nil ||
		items != `[{"topic":"x"}]` || model != "m" || provider != "" {
		t.Errorf("suggestions = %q %q %q (%v)", items, model, provider, err)
	}
	var guidance, language string
	if err := sqlDB.QueryRow(`SELECT guidance, explanation_language FROM journal_settings WHERE user_id = 1 AND workspace_id = 5`).Scan(&guidance, &language); err != nil ||
		guidance != "g" || language != "de" {
		t.Errorf("settings = %q %q (%v)", guidance, language, err)
	}
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM journal_settings`).Scan(&n); err != nil || n != 1 {
		t.Errorf("%d settings rows (%v), want 1: unreadable JSON is dropped", n, err)
	}

	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM plugin_data WHERE pack_id = 'qinqin-journal'`).Scan(&n); err != nil || n != 0 {
		t.Errorf("%d journal plugin rows left (%v)", n, err)
	}
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM plugin_data WHERE pack_id = 'qinqin-core'`).Scan(&n); err != nil || n != 1 {
		t.Errorf("%d core rows (%v), want 1: other plugins' rows stay", n, err)
	}

	for _, bad := range []string{
		`INSERT INTO journal_entries VALUES (1, 5, '', '2026-11-19', '', 't', 'typed', 'c', 'u')`,
		`INSERT INTO journal_entries VALUES (1, 5, 'x', '19.11.2026', '', 't', 'typed', 'c', 'u')`,
		`INSERT INTO journal_entries VALUES (1, 5, 'x', '2026-11-19', '', 't', 'voice', 'c', 'u')`,
		`INSERT INTO journal_reviews (user_id, workspace_id, entry_id, text_hash, annotations, overall, model, dropped, created_at) VALUES (1, 5, 'E2', 'h', '{}', '{}', 'm', '{}', 'c')`,
		`INSERT INTO journal_suggestions (user_id, workspace_id, items, model, created_at) VALUES (1, 6, '{}', 'm', 'c')`,
	} {
		if _, err := sqlDB.Exec(bad); err == nil {
			t.Errorf("accepted: %s", bad)
		}
	}
}

// A messy populated database (#199 fix wave): what the old plugin rows could
// hold that the journal's rules refuse is normalised (control characters
// stripped, an over-long title or text cut, a missing or unreadable stamp
// replaced by the row's write time, an unknown language read as "en") or, when
// it cannot be (an impossible date, a bad id, a document that does not
// decode), dropped with its review. The migration never fails.
func TestMigration044MessyRows(t *testing.T) {
	sqlDB := open030(t)
	if err := db.MigrateThrough(sqlDB, "043_lemma_rules"); err != nil {
		t.Fatal(err)
	}
	put := func(key, data string) {
		t.Helper()
		if _, err := sqlDB.Exec(`INSERT INTO plugin_data (pack_id, user_id, workspace_id, key, data, version, updated_at)
			VALUES ('qinqin-journal', 1, 5, ?, ?, 1, '2026-11-20T10:00:00Z')`, key, data); err != nil {
			t.Fatal(err)
		}
	}
	long := strings.Repeat("长", 250)
	put("entry:A", `{"id":"A","date":"2026-11-19","title":"`+long+`","text":"a\u000bb\u000cc\nd","createdAt":""}`)
	put("entry:B", `{"id":"B","date":"2026-11-19","text":"`+strings.Repeat("字", 50010)+`","createdAt":"yesterday"}`)
	put("entry:C", `{"id":"C","date":"2026-02-30","text":"impossible date"}`)
	put("review:C", `{"entryId":"C","annotations":[],"overall":{},"createdAt":"2026-11-20T09:00:00Z"}`)
	put("entry:bad id", `{"id":"bad id","date":"2026-11-19","text":"bad id"}`)
	put("entry:D", `{"id":"D","date":"2026-11-19","title":7,"text":"title not a string"}`)
	put("review:A", `{"entryId":"A","textHash":"h","annotations":[],"overall":{"summary":"s"},"model":"m","createdAt":""}`)
	put("review:B", `{"entryId":"B","annotations":[{"id":5}],"overall":{}}`)
	put("suggestions", `{"items":[{"title":"t","prompt":"p","words":["w"]}],"model":"m","createdAt":"soon"}`)
	put("settings", `{"guidance":"g\u0007`+strings.Repeat("x", 2100)+`","explanationLanguage":"xx"}`)
	if err := db.MigrateThrough(sqlDB, "044_journal"); err != nil {
		t.Fatalf("migration 044 on messy rows: %v", err)
	}
	type entry struct{ title, text, created string }
	got := map[string]entry{}
	rows, err := sqlDB.Query(`SELECT id, title, text, created_at FROM journal_entries WHERE user_id = 1`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var id string
		var e entry
		rows.Scan(&id, &e.title, &e.text, &e.created)
		got[id] = e
	}
	rows.Close()
	if len(got) != 3 {
		t.Errorf("entries %v, want A, B and D", len(got))
	}
	if a := got["A"]; a.title != strings.Repeat("长", 200) || a.text != "abc\nd" || a.created != "2026-11-20T10:00:00Z" {
		t.Errorf("A = %q %q %q", []rune(a.title)[:3], a.text, a.created)
	}
	if b := got["B"]; len([]rune(b.text)) != 50000 || b.created != "2026-11-20T10:00:00Z" {
		t.Errorf("B: %d runes, created %q", len([]rune(b.text)), b.created)
	}
	if d := got["D"]; d.title != "" {
		t.Errorf("D title %q", d.title)
	}
	var created string
	if err := sqlDB.QueryRow(`SELECT created_at FROM journal_reviews WHERE entry_id = 'A'`).Scan(&created); err != nil || created != "2026-11-20T10:00:00Z" {
		t.Errorf("review A created %q (%v)", created, err)
	}
	var n int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM journal_reviews`).Scan(&n); err != nil || n != 1 {
		t.Errorf("%d reviews (%v), want 1: C's entry is gone, B's annotations do not decode", n, err)
	}
	if err := sqlDB.QueryRow(`SELECT created_at FROM journal_suggestions`).Scan(&created); err != nil || created != "2026-11-20T10:00:00Z" {
		t.Errorf("suggestions created %q (%v)", created, err)
	}
	var guidance, lang string
	if err := sqlDB.QueryRow(`SELECT guidance, explanation_language FROM journal_settings`).Scan(&guidance, &lang); err != nil ||
		len([]rune(guidance)) != 2000 || strings.ContainsRune(guidance, 7) || lang != "en" {
		t.Errorf("settings: %d runes, lang %q (%v)", len([]rune(guidance)), lang, err)
	}
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM plugin_data WHERE pack_id = 'qinqin-journal'`).Scan(&n); err != nil || n != 0 {
		t.Errorf("%d journal plugin rows left (%v)", n, err)
	}
}
