package aozora

import (
	"context"
	"fmt"
	"reflect"
	"testing"

	"qinqin/internal/library/sources"
)

// readingHeader is the catalog header with the optional reading columns,
// in the order of the live list_person_all_extended_utf8.csv.
var readingHeader = []string{
	"作品ID", "作品名", "作品名読み", "作品著作権フラグ", "公開日", "図書カードURL", "姓", "名",
	"姓読み", "名読み", "役割フラグ", "人物著作権フラグ", "テキストファイルURL", "XHTML/HTMLファイルURL",
}

func readingRows(base string) [][]string {
	row := func(id, title, reading, workFlag, family, given, familyR, givenR, role, personFlag string) []string {
		return []string{id, title, reading, workFlag, "2020-04-03", base + "/cards/" + id + ".html",
			family, given, familyR, givenR, role, personFlag, base + "/f/4_ruby.zip", ""}
	}
	return [][]string{
		row("000010", "東京八景", "とうきょうはっけい", "なし", "太宰", "治", "だざい", "おさむ", "著者", "なし"),
		row("000011", "東京", "とうきょう", "なし", "某", "某", "なにがし", "なにがし", "著者", "なし"),
		row("000012", "京都", "きょうと", "なし", "夏目", "漱石", "なつめ", "そうせき", "著者", "なし"),
		// a phonetic match whose title also contains the query word in kanji
		row("000013", "東京日記", "とうきょうにっき", "なし", "内田", "百閒", "うちだ", "ひゃっけん", "著者", "なし"),
		// copyright-flagged works never match, not even phonetically
		row("000014", "東京物語", "とうきょうものがたり", "あり", "某", "某", "なにがし", "なにがし", "著者", "なし"),
		row("000015", "トウキョウ", "とうきょう", "なし", "現代", "作家", "げんだい", "さっか", "著者", "あり"),
		// a reading in katakana, as the live catalog writes loanwords
		row("000016", "ウェストミンスター寺院", "ウェストミンスターじいん", "なし", "アーヴィング", "ワシントン", "アーヴィング", "ワシントン", "著者", "なし"),
	}
}

func TestAozoraPhoneticSearch(t *testing.T) {
	f := newFixtureWith(t, readingHeader, readingRows)
	ctx := context.Background()
	for _, q := range []string{"tokyo", "とうきょう", "トウキョウ", "Tōkyō", "ＴＯＫＹＯ", "ToKyO", "to kyo", "to-kyo", "toukyou"} {
		rs, err := f.ad.Search(ctx, q, 10)
		if err != nil {
			t.Fatalf("Search(%q): %v", q, err)
		}
		// exact title first, then prefixes by id; flagged works never
		if want := []string{"000011", "000010", "000013"}; !reflect.DeepEqual(ids(rs), want) {
			t.Errorf("Search(%q) = %v, want %v", q, ids(rs), want)
			continue
		}
		if rs[0].Reading != "とうきょう" || rs[1].Reading != "とうきょうはっけい" {
			t.Errorf("Search(%q) readings = %q %q", q, rs[0].Reading, rs[1].Reading)
		}
	}
	// author readings match too
	if rs, _ := f.ad.Search(ctx, "soseki", 10); !reflect.DeepEqual(ids(rs), []string{"000012"}) {
		t.Errorf("author reading: %v", ids(rs))
	}
	if rs, _ := f.ad.Search(ctx, "westminster", 10); len(rs) != 0 {
		t.Errorf("english spelling is no reading: %v", ids(rs))
	}
	if rs, _ := f.ad.Search(ctx, "uesutominsuta", 10); !reflect.DeepEqual(ids(rs), []string{"000016"}) {
		t.Errorf("katakana reading: %v", ids(rs))
	}
}

func TestAozoraShortPhoneticQueriesDoNotMatch(t *testing.T) {
	f := newFixtureWith(t, readingHeader, readingRows)
	ctx := context.Background()
	for _, q := range []string{"a", "ko", "to", "tou", "とう", "こ", "トー"} {
		if rs, err := f.ad.Search(ctx, q, 10); err != nil || len(rs) != 0 {
			t.Errorf("Search(%q) = %v, %v; want nothing", q, ids(rs), err)
		}
	}
	for q, want := range map[string]string{"tokyo": "000011", "soseki": "000012", "kyoto": "000012"} {
		if rs, _ := f.ad.Search(ctx, q, 10); len(rs) == 0 || rs[0].SourceID != want {
			t.Errorf("Search(%q) = %v, want %s first", q, ids(rs), want)
		}
	}
	// a one-character written query still matches
	if rs, _ := f.ad.Search(ctx, "京", 10); len(rs) != 4 {
		t.Errorf("Search(京) = %v", ids(rs))
	}
}

func TestAozoraKanjiMatchRanksBeforePhonetic(t *testing.T) {
	f := newFixtureWith(t, readingHeader, readingRows)
	rs, err := f.ad.Search(context.Background(), "京都", 10)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(ids(rs), []string{"000012"}) || rs[0].Reading != "" {
		t.Errorf("kanji query: %v %+v", ids(rs), rs)
	}
	// "kyoto" is the reading of 京都 (phonetic exact) and part of no other
	rs, _ = f.ad.Search(context.Background(), "kyoto", 10)
	if !reflect.DeepEqual(ids(rs), []string{"000012"}) || rs[0].Reading != "きょうと" {
		t.Errorf("romaji query: %v", rs)
	}
	// 東京 matches the kanji titles directly: those rank before any
	// phonetic-only hit, and carry no reading
	rs, _ = f.ad.Search(context.Background(), "東京", 10)
	if want := []string{"000011", "000010", "000013"}; !reflect.DeepEqual(ids(rs), want) {
		t.Errorf("東京 = %v, want %v", ids(rs), want)
	}
	for _, r := range rs {
		if r.Reading != "" {
			t.Errorf("direct match carries a reading: %+v", r)
		}
	}
}

func TestAozoraWithoutReadingColumnsStillSearches(t *testing.T) {
	f := newFixture(t, header) // the old header: no reading columns
	rs, err := f.ad.Search(context.Background(), "漱石", 10)
	if err != nil || !reflect.DeepEqual(ids(rs), []string{"000001"}) {
		t.Fatalf("kanji search: %v %v", ids(rs), err)
	}
	if rs, err := f.ad.Search(context.Background(), "soseki", 10); err != nil || len(rs) != 0 {
		t.Fatalf("romaji search without readings: %v %v", ids(rs), err)
	}
}

func TestAozoraBrowse(t *testing.T) {
	f := newFixtureWith(t, readingHeader, func(base string) [][]string {
		var rows [][]string
		for i := 1; i <= 40; i++ {
			flag := "なし"
			if i%10 == 0 {
				flag = "あり" // copyrighted: never browsed
			}
			rows = append(rows, []string{fmt.Sprintf("%06d", i), fmt.Sprintf("作品%d", i), "さくひん", flag,
				"2020-04-03", base + "/c.html", "某", "某", "", "", "著者", "なし", base + "/f/4_ruby.zip", ""})
		}
		return rows
	})
	b, ok := sources.Source(f.ad).(sources.Browser)
	if !ok {
		t.Fatal("aozora adapter is not a sources.Browser")
	}
	ctx := context.Background()
	a1, err := b.Browse(ctx, "ja", "2026-11-13", 12)
	if err != nil {
		t.Fatal(err)
	}
	a2, _ := b.Browse(ctx, "ja", "2026-11-13", 12)
	if len(a1) != 12 || !reflect.DeepEqual(a1, a2) {
		t.Fatalf("not deterministic: %v vs %v", ids(a1), ids(a2))
	}
	if a3, _ := b.Browse(ctx, "ja", "2026-11-14", 12); reflect.DeepEqual(ids(a1), ids(a3)) {
		t.Errorf("seed does not vary: %v", ids(a1))
	}
	all, _ := b.Browse(ctx, "ja", "s", 50)
	seen := map[string]bool{}
	for _, r := range all {
		if seen[r.SourceID] {
			t.Errorf("repeat %s", r.SourceID)
		}
		seen[r.SourceID] = true
		if r.SourceID == "000010" || r.SourceID == "000020" {
			t.Errorf("copyrighted work browsed: %s", r.SourceID)
		}
		if r.Language != "ja" || r.Title == "" {
			t.Errorf("result = %+v", r)
		}
	}
	if len(all) != 36 {
		t.Errorf("browse all = %d works, want 36", len(all))
	}
	if rs, err := b.Browse(ctx, "zh", "s", 12); err != nil || rs == nil || len(rs) != 0 {
		t.Errorf("zh browse = %#v, %v; want empty", rs, err)
	}
	if rs, err := b.Browse(ctx, "", "s", 5); err != nil || len(rs) != 5 {
		t.Errorf("any-language browse = %d, %v", len(rs), err)
	}
}

func TestAozoraBrowseEmptyCatalogAndOffline(t *testing.T) {
	f := newFixtureWith(t, readingHeader, func(string) [][]string { return nil })
	rs, err := f.ad.Browse(context.Background(), "ja", "s", 12)
	if err != nil || rs == nil || len(rs) != 0 {
		t.Fatalf("empty catalog: %#v, %v", rs, err)
	}
	off := newFixture(t, header)
	off.catMode.Store(catFail)
	if _, err := off.ad.Browse(context.Background(), "ja", "s", 12); err == nil {
		t.Fatal("offline browse returned no error")
	}
}
