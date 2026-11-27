package main

import (
	"context"
	"io"
	"path/filepath"
	"slices"
	"testing"

	"qinqin/internal/levels"
	"qinqin/internal/lexicon"
)

// TestSeedBundledJLPTWords: the bundled estimate jlpt-words seeds after a
// Japanese dictionary and its words carry the "≈ N5" badge of the scheme
// "JLPT words (approximate)", and its levels list them for level sessions
// and level decks (levels.EntryIDs), like any levels pack. The small ja-mini
// sample stands in for JMdict (the full dictionary takes minutes): its three
// words are in the estimate's ≈ N5, matched by form and reading.
func TestSeedBundledJLPTWords(t *testing.T) {
	ctx := context.Background()
	sqlDB, _ := openTestDB(t)
	root := t.TempDir()
	copyTree(t, filepath.Join(samplePacks, "ja-mini"), filepath.Join(root, "ja-mini"))
	copyTree(t, filepath.Join(committedPacks, "jlpt-words"), filepath.Join(root, "jlpt-words"))
	if err := seed(ctx, sqlDB, t.TempDir(), []string{root}, io.Discard); err != nil {
		t.Fatalf("seed: %v", err)
	}

	schemes, err := levels.List(ctx, sqlDB)
	if err != nil || len(schemes) != 1 {
		t.Fatalf("schemes = %+v, %v; want jlpt-words alone", schemes, err)
	}
	s := schemes[0]
	var names []string
	for _, l := range s.Levels {
		names = append(names, l.Name)
	}
	if s.PackID != "jlpt-words" || s.Name != "JLPT words (approximate)" || s.Unit != levels.UnitWord ||
		!slices.Equal(names, []string{"≈ N5", "≈ N4", "≈ N3", "≈ N2", "≈ N1"}) || s.License != "CC BY-SA 4.0" {
		t.Fatalf("scheme = %+v (levels %q); want JLPT words (approximate), unit word, ≈ N5 … ≈ N1, CC BY-SA 4.0", s, names)
	}

	lx := lexicon.Store{DB: sqlDB}
	var ids []int64
	for _, form := range []string{"学校", "水", "食べる"} {
		byForm, err := lx.ByForm(ctx, "ja", []string{form})
		if err != nil || len(byForm[form]) != 1 {
			t.Fatalf("ByForm(%s) = %+v, %v", form, byForm, err)
		}
		id := byForm[form][0].ID
		ids = append(ids, id)
		badges, err := levels.ForEntry(ctx, sqlDB, id)
		if err != nil || len(badges) != 1 || badges[0].SchemeName != "JLPT words (approximate)" || badges[0].LevelName != "≈ N5" || badges[0].Derived {
			t.Errorf("%s badges = %+v, %v; want one direct ≈ N5 · JLPT words (approximate)", form, badges, err)
		}
	}
	members, err := levels.EntryIDs(ctx, sqlDB, s.ID, "≈ N5")
	if err != nil {
		t.Fatal(err)
	}
	slices.Sort(members)
	slices.Sort(ids)
	if !slices.Equal(members, ids) {
		t.Errorf("≈ N5 members = %v, want the three sample words %v", members, ids)
	}
}
