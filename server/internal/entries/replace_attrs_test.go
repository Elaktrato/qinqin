package entries_test

import (
	"context"
	"testing"

	"qinqin/internal/model"
)

// UpsertReplacingAttrs replaces the stored attrs under the prefix
// wholesale: a key under it that the entry no longer carries is removed
// and the entry stamped, keys outside the prefix are untouched, and an
// identical upsert writes nothing.
func TestUpsertReplacingAttrsDropsStaleKeys(t *testing.T) {
	st := newStore(t)
	ctx := context.Background()
	e := func(attrs map[string]string) *model.Entry {
		return &model.Entry{
			Language: "zh", Kind: "character", Written: "好",
			Readings: []model.Reading{{Type: "pinyin", Value: "hǎo"}},
			Attrs:    attrs,
		}
	}
	id := mustUpsert(t, st, e(map[string]string{"strokes": "6", "jmdict.pri": "60", "jmdict.uk": "1"}))
	backdateEntries(t, st)

	if _, err := st.UpsertReplacingAttrs(ctx, e(map[string]string{"jmdict.pri": "30"}), "jmdict."); err != nil {
		t.Fatalf("UpsertReplacingAttrs: %v", err)
	}
	got, err := st.GetByID(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Attrs) != 2 || got.Attrs["strokes"] != "6" || got.Attrs["jmdict.pri"] != "30" {
		t.Errorf("attrs = %v, want strokes kept, jmdict.pri 30, jmdict.uk gone", got.Attrs)
	}
	if n := rowsNewerThan2021(t, st, "entries"); n != 1 {
		t.Errorf("entries stamped = %d, want the entry stamped (its attrs changed)", n)
	}

	// Dropping the last key under the prefix stamps the entry too.
	backdateEntries(t, st)
	if _, err := st.UpsertReplacingAttrs(ctx, e(nil), "jmdict."); err != nil {
		t.Fatal(err)
	}
	got, _ = st.GetByID(ctx, id)
	if len(got.Attrs) != 1 || got.Attrs["strokes"] != "6" {
		t.Errorf("attrs = %v, want only strokes", got.Attrs)
	}
	if n := rowsNewerThan2021(t, st, "entries"); n != 1 {
		t.Errorf("entries stamped = %d, want 1 after dropping jmdict.pri", n)
	}

	// Identical again: nothing written.
	backdateEntries(t, st)
	if _, err := st.UpsertReplacingAttrs(ctx, e(nil), "jmdict."); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"entries", "readings", "entry_attrs"} {
		if n := rowsNewerThan2021(t, st, table); n != 0 {
			t.Errorf("%s: %d rows written by an identical upsert", table, n)
		}
	}
}
