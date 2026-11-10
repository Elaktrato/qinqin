package dict_test

import (
	"context"
	"database/sql"
	"slices"
	"testing"

	"qinqin/internal/dict"
	"qinqin/internal/entries"
)

const longAgo = "2020-01-01T00:00:00Z"

// backdate stamps every content row longAgo so rows written afterwards
// stand out.
func backdate(t *testing.T, sqlDB *sql.DB) {
	t.Helper()
	for _, table := range []string{"entries", "readings", "entry_attrs", "entry_links", "senses"} {
		if _, err := sqlDB.Exec(`UPDATE ` + table + ` SET updated_at = '` + longAgo + `'`); err != nil {
			t.Fatalf("backdate %s: %v", table, err)
		}
	}
}

// writesSince returns, per content table, how many rows were written
// after backdate (re-stamped, inserted, or tombstoned).
func writesSince(t *testing.T, sqlDB *sql.DB) map[string]int {
	t.Helper()
	out := map[string]int{}
	for _, table := range []string{"entries", "readings", "entry_attrs", "entry_links", "senses"} {
		var n int
		if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM ` + table + ` WHERE updated_at > '2021-01-01T00:00:00Z'`).Scan(&n); err != nil {
			t.Fatalf("count %s: %v", table, err)
		}
		if n > 0 {
			out[table] = n
		}
	}
	return out
}

func totalRows(t *testing.T, sqlDB *sql.DB, table string) int {
	t.Helper()
	var n int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM ` + table).Scan(&n); err != nil {
		t.Fatalf("count %s: %v", table, err)
	}
	return n
}

// Re-importing an identical pack writes nothing at all: not a re-stamped
// entry, reading, link, or sense, and no tombstone + insert pairs.
func TestReimportIdenticalPackWritesNothing(t *testing.T) {
	ctx := context.Background()
	for name, load := range map[string]func(*testing.T, context.Context, *sql.DB) dict.Pack{
		"json": func(t *testing.T, _ context.Context, _ *sql.DB) dict.Pack { return loadFixture(t) },
		"cedict": func(t *testing.T, _ context.Context, _ *sql.DB) dict.Pack {
			return loadCedictFixture(t)
		},
	} {
		t.Run(name, func(t *testing.T) {
			sqlDB := newDB(t)
			pack := load(t, ctx, sqlDB)
			if _, err := dict.Import(ctx, sqlDB, pack); err != nil {
				t.Fatalf("first import: %v", err)
			}
			backdate(t, sqlDB)
			senses, readings := totalRows(t, sqlDB, "senses"), totalRows(t, sqlDB, "readings")

			if _, err := dict.Import(ctx, sqlDB, pack); err != nil {
				t.Fatalf("second import: %v", err)
			}
			if w := writesSince(t, sqlDB); len(w) != 0 {
				t.Errorf("identical re-import wrote rows: %v", w)
			}
			if n := totalRows(t, sqlDB, "senses"); n != senses {
				t.Errorf("sense rows %d -> %d", senses, n)
			}
			if n := totalRows(t, sqlDB, "readings"); n != readings {
				t.Errorf("reading rows %d -> %d", readings, n)
			}
		})
	}
}

// A changed pack touches only what changed: kept glosses keep their rows,
// a removed gloss is tombstoned, a new one inserted, and a reordered
// gloss moves in place.
func TestReimportTouchesOnlyChangedSenses(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)
	importFixture(t, ctx, sqlDB) // 你好: hello, hi; 好: good
	backdate(t, sqlDB)
	dictID := dictionaryID(t, sqlDB, "mkgloss")
	st := entries.Store{DB: sqlDB}
	nihao := mustGet(t, st, "你好", "word", "zh")
	var helloID int64
	if err := sqlDB.QueryRow(`SELECT id FROM senses WHERE entry_id = ? AND gloss = 'hello'`, nihao.ID).Scan(&helloID); err != nil {
		t.Fatalf("find hello sense: %v", err)
	}

	reimport := func(glosses string) {
		t.Helper()
		pack, err := dict.LoadPack(writePack(t, fixtureManifest, `{"entries": [
			{"written": "好", "trad": "好", "kind": "character",
			 "readings": [{"type": "pinyin", "value": "hǎo"}], "glosses": ["good"]},
			{"written": "你好", "trad": "妳好", "kind": "word",
			 "readings": [{"type": "pinyin", "value": "nǐ hǎo"}], "glosses": `+glosses+`}]}`))
		if err != nil {
			t.Fatalf("LoadPack: %v", err)
		}
		if _, err := dict.Import(ctx, sqlDB, pack); err != nil {
			t.Fatalf("re-import: %v", err)
		}
	}

	// hi -> hey: hello keeps its row untouched; hi tombstoned; hey new.
	reimport(`["hello", "hey"]`)
	if got := activeGlosses(t, sqlDB, dictID, nihao.ID); !slices.Equal(got, []string{"hello", "hey"}) {
		t.Fatalf("glosses = %v, want [hello hey]", got)
	}
	var helloStamp string
	var helloDeleted sql.NullString
	if err := sqlDB.QueryRow(`SELECT updated_at, deleted_at FROM senses WHERE id = ?`, helloID).Scan(&helloStamp, &helloDeleted); err != nil {
		t.Fatalf("read hello sense: %v", err)
	}
	if helloStamp != longAgo || helloDeleted.Valid {
		t.Errorf("unchanged sense hello was touched: updated_at=%s deleted=%v", helloStamp, helloDeleted)
	}
	var tombstoned int
	// 'hi' is carried by both forms of 你好 (你好 and 妳好).
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM senses WHERE deleted_at IS NOT NULL AND gloss = 'hi'`).Scan(&tombstoned); err != nil || tombstoned != 2 {
		t.Errorf("tombstoned 'hi' senses = %d, %v; want 2 (both forms)", tombstoned, err)
	}

	// Reorder: same rows, new ord, no tombstones added.
	before := totalRows(t, sqlDB, "senses")
	reimport(`["hey", "hello"]`)
	if got := activeGlosses(t, sqlDB, dictID, nihao.ID); !slices.Equal(got, []string{"hey", "hello"}) {
		t.Errorf("glosses after reorder = %v, want [hey hello]", got)
	}
	if n := totalRows(t, sqlDB, "senses"); n != before {
		t.Errorf("reorder changed sense row count %d -> %d, want in-place ord update", before, n)
	}

	// A gloss that returns revives its tombstoned row instead of adding one.
	before = totalRows(t, sqlDB, "senses")
	reimport(`["hey", "hello", "hi"]`)
	if n := totalRows(t, sqlDB, "senses"); n != before {
		t.Errorf("returning gloss added a row (%d -> %d), want the tombstoned 'hi' revived", before, n)
	}
	if got := activeGlosses(t, sqlDB, dictID, nihao.ID); !slices.Equal(got, []string{"hey", "hello", "hi"}) {
		t.Errorf("glosses after revive = %v", got)
	}
}

// Uninstall then re-import brings the same sense rows back; it does not
// add a second copy beside the tombstones.
func TestReimportAfterUninstallRevivesSenses(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)
	importFixture(t, ctx, sqlDB)
	dictID := dictionaryID(t, sqlDB, "mkgloss")
	rows := totalRows(t, sqlDB, "senses")
	if err := dict.Uninstall(ctx, sqlDB, dictID); err != nil {
		t.Fatalf("uninstall: %v", err)
	}
	importFixture(t, ctx, sqlDB)
	if n := totalRows(t, sqlDB, "senses"); n != rows {
		t.Errorf("sense rows after uninstall + re-import = %d, want %d (revived, not duplicated)", n, rows)
	}
	if active, _ := senseCounts(t, sqlDB, dictID); active != rows {
		t.Errorf("active senses = %d, want %d", active, rows)
	}
}
