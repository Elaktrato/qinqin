package freq_test

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"qinqin/internal/freq"
)

func TestRowsOrderedByPackPriorityAcrossChunks(t *testing.T) {
	sqlDB := openDB(t)
	// 600 terms span two IN chunks; the second pack has two of them.
	var body strings.Builder
	var terms []string
	for i := 0; i < 600; i++ {
		term := fmt.Sprintf("t%03d", i)
		terms = append(terms, term)
		fmt.Fprintf(&body, "%s,,%d\n", term, i+1)
	}
	mustImport(t, sqlDB, csvPack(t, "first", body.String()))
	mustImport(t, sqlDB, csvPack(t, "second", "t599,,7\nt000,,9\n"))

	rows, err := freq.Store{DB: sqlDB}.Rows(context.Background(), append(terms, "t000"))
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 602 {
		t.Fatalf("rows = %d, want 602", len(rows))
	}
	for i, r := range rows[:600] {
		if r.PackName != "Pack first" || r.Term != terms[i] {
			t.Fatalf("row %d = %+v, want pack first term %s", i, r, terms[i])
		}
	}
	if a, b := rows[600], rows[601]; a.PackName != "Pack second" || a.Term != "t599" || b.Term != "t000" {
		t.Errorf("second pack rows = %+v %+v, want t599 then t000 in file order", a, b)
	}
}

func TestBestHitsAcrossTermsAndReadings(t *testing.T) {
	sqlDB := openDB(t)
	mustImport(t, sqlDB, csvPack(t, "a", "為る,する,40\n為る,なる,5\n爲る,,30\n"))
	mustImport(t, sqlDB, csvPack(t, "b", "為る,なる,2\n"))
	rows, err := freq.Store{DB: sqlDB}.Rows(context.Background(), []string{"為る", "爲る"})
	if err != nil {
		t.Fatal(err)
	}
	// Reading する: pack a's なる row does not apply and 爲る's
	// reading-less row (30) beats 為る/する (40); pack b only has なる.
	got := freq.BestHits(rows, []string{"為る", "爲る"}, []string{"する"})
	if len(got) != 1 || got[0].PackName != "Pack a" || got[0].Rank != 30 {
		t.Errorf("BestHits(する) = %+v, want one: Pack a rank 30", got)
	}
	// No readings: the best row overall per pack, in pack order.
	got = freq.BestHits(rows, []string{"為る"}, nil)
	if len(got) != 2 || got[0].Rank != 5 || got[1].Rank != 2 {
		t.Errorf("BestHits(any) = %+v, want Pack a 5 then Pack b 2", got)
	}
	// One term: the same answer as Lookup.
	hits := lookup(t, sqlDB, []string{"為る"}, map[string][]string{"為る": {"なる"}})
	if want := freq.BestHits(rows, []string{"為る"}, []string{"なる"}); fmt.Sprint(hits["為る"]) != fmt.Sprint(want) {
		t.Errorf("Lookup = %+v, BestHits = %+v, want equal", hits["為る"], want)
	}
}
