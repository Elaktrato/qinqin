package sentences_test

import (
	"context"
	"database/sql"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/lang"
	"qinqin/internal/model"
	"qinqin/internal/sentences"
)

const longAgo = "2020-01-01T00:00:00Z"

func sentenceCount(t *testing.T, sqlDB *sql.DB, where string) int {
	t.Helper()
	var n int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM sentences WHERE ` + where).Scan(&n); err != nil {
		t.Fatalf("count sentences where %s: %v", where, err)
	}
	return n
}

// Re-importing an identical pack writes nothing; a changed pack
// tombstones only the sentences that went away, inserts only the new
// ones, and leaves the rest — and any user sentence — alone.
func TestReimportTouchesOnlyChangedSentences(t *testing.T) {
	lang.Register(lang.Zh{})
	ctx := context.Background()
	sqlDB := dbtest.Open(t)
	nihao, _ := seedWords(t, sqlDB)

	const hello = `{"hanzi":"你好，世界。","pinyin":"nǐ hǎo, shì jiè.","translation":"Hello, world."}`
	const hi = `{"hanzi":"你好吗？","pinyin":"nǐ hǎo ma?","translation":"How are you?"}`
	const bye = `{"hanzi":"你好，再见。","pinyin":"nǐ hǎo, zài jiàn.","translation":"Hello, goodbye."}`
	pack := func(ss ...string) string {
		body := ""
		for i, s := range ss {
			if i > 0 {
				body += ","
			}
			body += s
		}
		return `{"entries":[{"word":"你好","sentences":[` + body + `]}]}`
	}
	imp := func(json string) {
		t.Helper()
		if _, err := sentences.ImportPack(ctx, sqlDB, buildPack(t, "mini", json)); err != nil {
			t.Fatalf("import: %v", err)
		}
	}

	imp(pack(hello, hi))
	if _, err := sentences.AddUser(ctx, sqlDB, 1, nihao, model.Sentence{Hanzi: "我的句子", Pinyin: "wǒ de jù zi", Translation: "My sentence"}); err != nil {
		t.Fatalf("user sentence: %v", err)
	}
	if _, err := sqlDB.Exec(`UPDATE sentences SET updated_at = '` + longAgo + `'`); err != nil {
		t.Fatal(err)
	}
	total := sentenceCount(t, sqlDB, `1=1`)

	// Identical: nothing written.
	imp(pack(hello, hi))
	if n := sentenceCount(t, sqlDB, `updated_at > '2021-01-01T00:00:00Z'`); n != 0 {
		t.Errorf("identical re-import wrote %d sentence rows, want 0", n)
	}
	if n := sentenceCount(t, sqlDB, `1=1`); n != total {
		t.Errorf("sentence rows %d -> %d, want no churn", total, n)
	}

	// hi -> bye: hello untouched, hi tombstoned, bye inserted.
	imp(pack(hello, bye))
	if n := sentenceCount(t, sqlDB, `translation = 'Hello, world.' AND updated_at = '`+longAgo+`' AND deleted_at IS NULL`); n != 1 {
		t.Errorf("unchanged sentence touched or lost (rows matching = %d, want 1)", n)
	}
	if n := sentenceCount(t, sqlDB, `translation = 'How are you?' AND deleted_at IS NOT NULL`); n != 1 {
		t.Errorf("dropped sentence tombstoned rows = %d, want 1", n)
	}
	if n := sentenceCount(t, sqlDB, `translation = 'Hello, goodbye.' AND deleted_at IS NULL`); n != 1 {
		t.Errorf("new sentence active rows = %d, want 1", n)
	}
	if n := sentenceCount(t, sqlDB, `user_id IS NOT NULL AND deleted_at IS NULL AND updated_at = '`+longAgo+`'`); n != 1 {
		t.Errorf("user sentence disturbed (matching rows = %d, want 1)", n)
	}

	// A dropped sentence that returns is revived, not duplicated.
	before := sentenceCount(t, sqlDB, `1=1`)
	imp(pack(hello, hi))
	if n := sentenceCount(t, sqlDB, `1=1`); n != before {
		t.Errorf("returning sentence added a row (%d -> %d), want the tombstoned one revived", before, n)
	}
}

// TestReimportUpdatesAReadingInPlace: a sentence is identified by its
// entry, text and translation; a rebuild that only changes (or adds, or
// drops) its reading updates that row, keeping its id — sentence cards
// and other references stay valid — and restamps it for sync.
func TestReimportUpdatesAReadingInPlace(t *testing.T) {
	lang.Register(lang.Zh{})
	ctx := context.Background()
	sqlDB := dbtest.Open(t)
	nihao, _ := seedWords(t, sqlDB)
	imp := func(reading string) {
		t.Helper()
		field := ""
		if reading != "" {
			field = `"pinyin":"` + reading + `",`
		}
		pack := `{"entries":[{"word":"你好","sentences":[{"hanzi":"你好吗？",` + field + `"translation":"How are you?"}]}]}`
		if _, err := sentences.ImportPack(ctx, sqlDB, buildPack(t, "mini", pack)); err != nil {
			t.Fatalf("import: %v", err)
		}
	}
	idOf := func() (int64, string) {
		t.Helper()
		list, err := sentences.ForEntry(ctx, sqlDB, nihao, 0)
		if err != nil || len(list) != 1 {
			t.Fatalf("ForEntry = %+v, %v; want one sentence", list, err)
		}
		return list[0].ID, list[0].Pinyin
	}

	imp("")
	id, _ := idOf()
	for _, reading := range []string{"nǐ hǎo ma?", "nǐhǎo ma?", ""} {
		if _, err := sqlDB.Exec(`UPDATE sentences SET updated_at = '` + longAgo + `'`); err != nil {
			t.Fatal(err)
		}
		imp(reading)
		got, pinyin := idOf()
		if got != id || pinyin != reading {
			t.Errorf("after a reading %q rebuild: id %d (want %d), reading %q", reading, got, id, pinyin)
		}
		if n := sentenceCount(t, sqlDB, `1=1`); n != 1 {
			t.Errorf("reading change left %d rows, want the one row updated", n)
		}
		if n := sentenceCount(t, sqlDB, `updated_at > '2021-01-01T00:00:00Z'`); n != 1 {
			t.Errorf("reading change restamped %d rows, want 1", n)
		}
	}
}
