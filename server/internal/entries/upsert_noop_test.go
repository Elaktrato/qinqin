package entries_test

import (
	"context"
	"testing"

	"qinqin/internal/entries"
	"qinqin/internal/model"
)

// longAgo is the stamp backdate gives every row; anything newer was
// written after it.
const longAgo = "2020-01-01T00:00:00Z"

// backdateEntries stamps every entry, reading, attr, and link row longAgo,
// so a later write shows up as a row newer than 2021.
func backdateEntries(t *testing.T, st entries.Store) {
	t.Helper()
	for _, table := range []string{"entries", "readings", "entry_attrs", "entry_links"} {
		if _, err := st.DB.Exec(`UPDATE ` + table + ` SET updated_at = '` + longAgo + `'`); err != nil {
			t.Fatalf("backdate %s: %v", table, err)
		}
	}
}

// rowsNewerThan2021 counts rows written since backdate, per table.
func rowsNewerThan2021(t *testing.T, st entries.Store, table string) int {
	t.Helper()
	var n int
	if err := st.DB.QueryRow(`SELECT COUNT(*) FROM ` + table + ` WHERE updated_at > '2021-01-01T00:00:00Z'`).Scan(&n); err != nil {
		t.Fatalf("count %s: %v", table, err)
	}
	return n
}

func count(t *testing.T, st entries.Store, query string) int {
	t.Helper()
	var n int
	if err := st.DB.QueryRow(query).Scan(&n); err != nil {
		t.Fatalf("%s: %v", query, err)
	}
	return n
}

func haoEntry(pinyin, strokes string) *model.Entry {
	return &model.Entry{
		Language: "zh", Kind: "character", Written: "好",
		Readings: []model.Reading{{Type: "pinyin", Value: pinyin}},
		Attrs:    map[string]string{"strokes": strokes},
	}
}

// Upserting what is already stored writes nothing: no row is re-stamped
// and no reading is tombstoned and re-inserted. A re-seed of an unchanged
// pack must not make every client re-download every entry.
func TestUpsertUnchangedWritesNothing(t *testing.T) {
	st := newStore(t)
	id := mustUpsert(t, st, haoEntry("hǎo", "6"))
	backdateEntries(t, st)
	readingRows := count(t, st, `SELECT COUNT(*) FROM readings`)

	again := mustUpsert(t, st, haoEntry("hǎo", "6"))
	if again != id {
		t.Fatalf("id changed from %d to %d", id, again)
	}
	for _, table := range []string{"entries", "readings", "entry_attrs"} {
		if n := rowsNewerThan2021(t, st, table); n != 0 {
			t.Errorf("%s: %d rows re-stamped by an identical upsert, want 0", table, n)
		}
	}
	if n := count(t, st, `SELECT COUNT(*) FROM readings`); n != readingRows {
		t.Errorf("readings rows %d -> %d, want no tombstone/insert churn", readingRows, n)
	}
}

// A changed reading replaces the list (old rows tombstoned, new inserted)
// and stamps the entry, because the entry's updated_at is what the sync
// pull reads to ship its children.
func TestUpsertChangedReadingStampsEntry(t *testing.T) {
	st := newStore(t)
	mustUpsert(t, st, haoEntry("hǎo", "6"))
	backdateEntries(t, st)

	mustUpsert(t, st, haoEntry("hào", "6"))
	if n := rowsNewerThan2021(t, st, "entries"); n != 1 {
		t.Errorf("entries stamped = %d, want the changed entry stamped", n)
	}
	if n := count(t, st, `SELECT COUNT(*) FROM readings WHERE deleted_at IS NOT NULL`); n != 2 {
		t.Errorf("tombstoned readings = %d, want the 2 superseded (pinyin + bopomofo)", n)
	}
	e, err := st.GetByWritten(context.Background(), "好", "character", "zh")
	if err != nil || len(e.Readings) != 2 || e.Readings[0].Value != "hào" {
		t.Fatalf("entry after change = %+v, %v; want readings hào + derived bopomofo", e, err)
	}
	if n := rowsNewerThan2021(t, st, "entry_attrs"); n != 0 {
		t.Errorf("unchanged attr re-stamped (%d rows)", n)
	}
}

// A changed attr updates only that attr and stamps the entry; readings
// stay untouched.
func TestUpsertChangedAttrStampsEntry(t *testing.T) {
	st := newStore(t)
	mustUpsert(t, st, haoEntry("hǎo", "6"))
	backdateEntries(t, st)

	mustUpsert(t, st, haoEntry("hǎo", "7"))
	if n := rowsNewerThan2021(t, st, "entries"); n != 1 {
		t.Errorf("entries stamped = %d, want 1", n)
	}
	if n := rowsNewerThan2021(t, st, "entry_attrs"); n != 1 {
		t.Errorf("attrs stamped = %d, want 1", n)
	}
	if n := rowsNewerThan2021(t, st, "readings") + count(t, st, `SELECT COUNT(*) FROM readings WHERE deleted_at IS NOT NULL`); n != 0 {
		t.Errorf("readings touched by an attr-only change: %d", n)
	}
	e, _ := st.GetByWritten(context.Background(), "好", "character", "zh")
	if e.Attrs["strokes"] != "7" {
		t.Errorf("strokes = %q, want 7", e.Attrs["strokes"])
	}
}

// A soft-deleted entry upserts back to life and is stamped, so clients
// learn it returned.
func TestUpsertRevivedEntryIsStamped(t *testing.T) {
	st := newStore(t)
	mustUpsert(t, st, haoEntry("hǎo", "6"))
	if _, err := st.DB.Exec(`UPDATE entries SET deleted_at = '` + longAgo + `', updated_at = '` + longAgo + `'`); err != nil {
		t.Fatal(err)
	}
	mustUpsert(t, st, haoEntry("hǎo", "6"))
	if n := count(t, st, `SELECT COUNT(*) FROM entries WHERE deleted_at IS NULL AND updated_at > '2021-01-01T00:00:00Z'`); n != 1 {
		t.Errorf("revived entry live+stamped rows = %d, want 1", n)
	}
}
