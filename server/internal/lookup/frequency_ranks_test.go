package lookup_test

import (
	"context"
	"database/sql"
	"slices"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/lexicon"
	"qinqin/internal/lookup"
	"qinqin/internal/pack"
)

func importFreqCSV(t *testing.T, sqlDB *sql.DB, id, language, body string) {
	t.Helper()
	importPack(t, sqlDB, pack.Manifest{
		ID: id, Name: "Pack " + id, Version: "1", Type: "frequency", Language: language,
		License: "CC BY-SA 4.0", Attribution: "test", Format: "freq-csv",
	}, "freq.csv", "term,reading,rank\n"+body)
}

func bestWord(t *testing.T, s lookup.Service, form string) lexicon.Entry {
	t.Helper()
	e, err := s.Lexicon.BestWord(context.Background(), "ja", form)
	if err != nil {
		t.Fatalf("BestWord(%s): %v", form, err)
	}
	return *e
}

func entryRanks(t *testing.T, s lookup.Service, language string, es ...lexicon.Entry) (string, []int) {
	t.Helper()
	pk, ranks, err := s.EntryRanks(context.Background(), language, es)
	if err != nil {
		t.Fatal(err)
	}
	if pk == nil {
		return "", ranks
	}
	return pk.PackID, ranks
}

// TestEntryRanksUseTheFirstPackOnly: the ranking pack is the first pack
// of the language, whatever data the later ones have, so a batch's
// answer never depends on which entries are in it.
func TestEntryRanksUseTheFirstPackOnly(t *testing.T) {
	sqlDB := dbtest.Open(t)
	importJMdict(t, sqlDB, jaWords)
	importFreqCSV(t, sqlDB, "first", "ja", "為る,する,15\n")
	importFreqCSV(t, sqlDB, "second", "ja", "為る,する,3\n事,こと,30\n")
	importFreqCSV(t, sqlDB, "zh-later", "zh", "事,,1\n")
	s := service(sqlDB)
	suru, koto := bestWord(t, s, "為る"), bestWord(t, s, "事")

	pk, ranks := entryRanks(t, s, "ja", suru, koto)
	if pk != "first" || !slices.Equal(ranks, []int{15, 0}) {
		t.Errorf("EntryRanks = %s %v, want first [15 0]", pk, ranks)
	}
	// Split in two calls: the same answers.
	if _, r := entryRanks(t, s, "ja", koto); !slices.Equal(r, []int{0}) {
		t.Errorf("EntryRanks(事) = %v, want [0] (the first pack has no row for it)", r)
	}
	if _, r := entryRanks(t, s, "ja", suru); !slices.Equal(r, []int{15}) {
		t.Errorf("EntryRanks(為る) = %v, want [15]", r)
	}
	// A Japanese character entry has no word rank.
	char := lexicon.Entry{Language: "ja", Kind: "character", Forms: []lexicon.Form{{Text: "為る"}}}
	if _, r := entryRanks(t, s, "ja", char); !slices.Equal(r, []int{0}) {
		t.Errorf("EntryRanks(character) = %v, want [0]", r)
	}
}

func TestEntryRanksWithoutAPackIsNil(t *testing.T) {
	sqlDB := dbtest.Open(t)
	importJMdict(t, sqlDB, jaWords)
	importFreqCSV(t, sqlDB, "ja-only", "ja", "為る,する,15\n")
	s := service(sqlDB)
	pk, ranks, err := s.EntryRanks(context.Background(), "zh", []lexicon.Entry{bestWord(t, s, "為る")})
	if err != nil || pk != nil || !slices.Equal(ranks, []int{0}) {
		t.Errorf("EntryRanks(zh) = %v, %v, %v; want nil pack, [0]", pk, ranks, err)
	}
}

// TestEntryRanksUsuallyKanaByKanaRow: a usually-kana word with no row
// for its kanji form is ranked by its kana row.
func TestEntryRanksUsuallyKanaByKanaRow(t *testing.T) {
	sqlDB := dbtest.Open(t)
	importJMdict(t, sqlDB, jaWords)
	importFreqCSV(t, sqlDB, "kana", "ja", "ある,,7\n")
	s := service(sqlDB)
	if _, r := entryRanks(t, s, "ja", bestWord(t, s, "有る")); !slices.Equal(r, []int{7}) {
		t.Errorf("EntryRanks(有る) = %v, want [7] from the kana row", r)
	}
}
