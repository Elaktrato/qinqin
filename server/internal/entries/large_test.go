package entries_test

import (
	"context"
	"testing"
	"time"

	"qinqin/internal/entries"
)

// bulkEntries inserts n entries of language "xx", each with one reading
// whose plain form is "a<id>", directly through SQL — far faster than
// n upserts.
func bulkEntries(t *testing.T, st entries.Store, n int) {
	t.Helper()
	if _, err := st.DB.Exec(`
		WITH RECURSIVE c(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM c WHERE i < ?)
		INSERT INTO entries (language, kind, written, updated_at)
		SELECT 'xx', 'word', 'w' || i, '2026-01-01T00:00:00Z' FROM c`, n); err != nil {
		t.Fatalf("bulk entries: %v", err)
	}
	if _, err := st.DB.Exec(`
		INSERT INTO readings (entry_id, type, value, plain, ord, updated_at)
		SELECT id, 'latin', 'a' || id, 'a' || id, 0, '2026-01-01T00:00:00Z'
		FROM entries WHERE language = 'xx'`); err != nil {
		t.Fatalf("bulk readings: %v", err)
	}
}

// SQLite caps bound variables per statement (32766); loading children
// of a large entry set must not hit it — a first sync of real CEDICT
// returns every entry.
func TestChangedSinceLargeSet(t *testing.T) {
	st := newStore(t)
	bulkEntries(t, st, 40000)
	list, err := st.ChangedSince(context.Background(), time.Time{})
	if err != nil {
		t.Fatalf("ChangedSince over 40000 entries: %v", err)
	}
	if len(list) != 40000 {
		t.Fatalf("got %d entries, want 40000", len(list))
	}
	if n := len(list[len(list)-1].Readings); n != 1 {
		t.Errorf("last entry has %d readings, want 1", n)
	}
}
