package gutenberg

import (
	"context"
	"fmt"
	"reflect"
	"sync/atomic"
	"testing"

	"qinqin/internal/library/sources"
)

var zhRows = [][]string{
	{"24264", "Text", "2008-01-01", "紅樓夢", "zh", "曹, 雪芹", "", "", ""},
	{"24265", "Text", "2008-01-01", "紅樓夢補", "zh", "歸, 鋤子", "", "", ""},
	{"24266", "Text", "2008-01-01", "夢紅樓", "zh", "某人", "", "", ""},
	{"23950", "Text", "2008-01-01", "三國志演義", "zh", "羅, 貫中", "", "", ""},
	{"1982", "Text", "1999-11-01", "羅生門", "ja", "芥川, 龍之介", "", "", ""},
}

// fakePhonetics converts the fixture's Han texts like the lexicon would.
func fakePhonetics(calls *atomic.Int32) sources.Phonetics {
	m := map[string]string{
		"紅樓夢":   "hong lou meng",
		"紅樓夢補":  "hong lou meng bu",
		"夢紅樓":   "meng hong lou",
		"曹, 雪芹": "cao xue qin",
		"三國志演義": "san guo zhi yan yi",
		"羅, 貫中": "luo guan zhong",
	}
	return func(_ context.Context, text string) string {
		calls.Add(1)
		return m[text]
	}
}

func TestGutenbergPinyinSearch(t *testing.T) {
	f := newFixtureWith(t, header, zhRows)
	var calls atomic.Int32
	f.ad.phonetics = fakePhonetics(&calls)
	ctx := context.Background()
	for _, q := range []string{"hong lou meng", "hónglóumèng", "hong2lou2meng4", "Hong Lou Meng", "HONGLOUMENG", "hóng-lóu-mèng"} {
		rs, err := f.ad.Search(ctx, q, 10)
		if err != nil {
			t.Fatal(err)
		}
		// the phonetic exact title, then the phonetic prefix
		if want := []string{"24264", "24265"}; !reflect.DeepEqual(ids(rs), want) {
			t.Errorf("Search(%q) = %v, want %v", q, ids(rs), want)
			continue
		}
		if rs[0].Reading != "hong lou meng" || rs[1].Reading != "hong lou meng bu" {
			t.Errorf("Search(%q) readings = %q %q", q, rs[0].Reading, rs[1].Reading)
		}
	}
	// authors match by pinyin too
	if rs, _ := f.ad.Search(ctx, "cao xueqin", 10); !reflect.DeepEqual(ids(rs), []string{"24264"}) {
		t.Errorf("author pinyin: %v", ids(rs))
	}
	// the kanji title still matches directly, before phonetic hits
	if rs, _ := f.ad.Search(ctx, "紅樓夢", 10); !reflect.DeepEqual(ids(rs), []string{"24264", "24265"}) {
		t.Errorf("kanji: %v", ids(rs))
	}
	// the catalog is converted once, at load: searches add no calls
	n := calls.Load()
	f.ad.Search(ctx, "san guo", 10)
	if calls.Load() != n {
		t.Errorf("phonetics called per search: %d -> %d", n, calls.Load())
	}
	// Japanese works get no pinyin
	if rs, _ := f.ad.Search(ctx, "luo sheng men", 10); len(rs) != 0 {
		t.Errorf("ja work matched pinyin: %v", ids(rs))
	}
}

func TestGutenbergDirectMatchRanksBeforePinyin(t *testing.T) {
	rows := append([][]string{{"30000", "Text", "2010-01-01", "Hong Lou Meng notes", "en;zh", "Someone", "", "", ""}}, zhRows...)
	f := newFixtureWith(t, header, rows)
	var calls atomic.Int32
	f.ad.phonetics = fakePhonetics(&calls)
	rs, err := f.ad.Search(context.Background(), "hong lou meng", 10)
	if err != nil {
		t.Fatal(err)
	}
	// the romanized title matches directly (prefix) and ranks before the
	// phonetic exact match
	if want := []string{"30000", "24264", "24265"}; !reflect.DeepEqual(ids(rs), want) {
		t.Fatalf("ids = %v, want %v", ids(rs), want)
	}
	if rs[0].Reading != "" {
		t.Errorf("direct match carries a reading: %+v", rs[0])
	}
}

func TestGutenbergShortPinyinQueriesDoNotMatch(t *testing.T) {
	f := newFixtureWith(t, header, zhRows)
	var calls atomic.Int32
	f.ad.phonetics = fakePhonetics(&calls)
	ctx := context.Background()
	for _, q := range []string{"me", "mé", "lo", "s"} {
		if rs, err := f.ad.Search(ctx, q, 10); err != nil || len(rs) != 0 {
			t.Errorf("Search(%q) = %v, %v; want nothing", q, ids(rs), err)
		}
	}
	if rs, _ := f.ad.Search(ctx, "meng", 10); !reflect.DeepEqual(ids(rs), []string{"24266", "24264", "24265"}) {
		t.Errorf("Search(meng) = %v", ids(rs))
	}
	if rs, _ := f.ad.Search(ctx, "夢", 10); len(rs) != 3 {
		t.Errorf("Search(夢) = %v", ids(rs))
	}
}

func TestGutenbergBrowseIgnoresCatalogOrder(t *testing.T) {
	var rows, reversed [][]string
	for i := 1; i <= 30; i++ {
		rows = append(rows, []string{fmt.Sprint(i * 7), "Text", "2000-01-01", fmt.Sprintf("Work %d", i), "zh", "A", "", "", ""})
	}
	for i := len(rows) - 1; i >= 0; i-- {
		reversed = append(reversed, rows[i])
	}
	a, err := newFixtureWith(t, header, rows).ad.Browse(context.Background(), "zh", "s", 12)
	if err != nil {
		t.Fatal(err)
	}
	b, err := newFixtureWith(t, header, reversed).ad.Browse(context.Background(), "zh", "s", 12)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(ids(a), ids(b)) {
		t.Errorf("browse depends on catalog order: %v vs %v", ids(a), ids(b))
	}
}

func TestGutenbergWithoutPhoneticsIsKanjiOnly(t *testing.T) {
	f := newFixtureWith(t, header, zhRows) // phonetics nil
	if rs, err := f.ad.Search(context.Background(), "hongloumeng", 10); err != nil || len(rs) != 0 {
		t.Errorf("no phonetics: %v %v", ids(rs), err)
	}
	if rs, _ := f.ad.Search(context.Background(), "紅樓", 10); !reflect.DeepEqual(ids(rs), []string{"24264", "24265", "24266"}) {
		t.Errorf("kanji: %v", ids(rs))
	}
}

func TestGutenbergBrowse(t *testing.T) {
	var rows [][]string
	for i := 1; i <= 30; i++ {
		lang := "zh"
		if i%3 == 0 {
			lang = "ja"
		}
		rows = append(rows, []string{fmt.Sprint(1000 + i), "Text", "2000-01-01", fmt.Sprintf("Work %d", i), lang, "A", "", "", ""})
	}
	f := newFixtureWith(t, header, rows)
	b, ok := sources.Source(f.ad).(sources.Browser)
	if !ok {
		t.Fatal("gutenberg adapter is not a sources.Browser")
	}
	ctx := context.Background()
	a1, err := b.Browse(ctx, "zh", "2026-11-13", 12)
	if err != nil {
		t.Fatal(err)
	}
	a2, _ := b.Browse(ctx, "zh", "2026-11-13", 12)
	if len(a1) != 12 || !reflect.DeepEqual(a1, a2) {
		t.Fatalf("not deterministic: %v vs %v", ids(a1), ids(a2))
	}
	if a3, _ := b.Browse(ctx, "zh", "other", 12); reflect.DeepEqual(ids(a1), ids(a3)) {
		t.Errorf("seed does not vary: %v", ids(a1))
	}
	zh, _ := b.Browse(ctx, "zh", "s", 100)
	if len(zh) != 20 {
		t.Errorf("zh works = %d, want 20", len(zh))
	}
	seen := map[string]bool{}
	for _, r := range zh {
		if r.Language != "zh" || seen[r.SourceID] {
			t.Errorf("bad or repeated result %+v", r)
		}
		seen[r.SourceID] = true
	}
	if ja, _ := b.Browse(ctx, "ja", "s", 100); len(ja) != 10 {
		t.Errorf("ja works = %d, want 10", len(ja))
	}
	if es, err := b.Browse(ctx, "es", "s", 12); err != nil || es == nil || len(es) != 0 {
		t.Errorf("es browse = %#v, %v", es, err)
	}
}

func TestGutenbergBrowseEmptyAndOffline(t *testing.T) {
	f := newFixtureWith(t, header, nil)
	if rs, err := f.ad.Browse(context.Background(), "zh", "s", 12); err != nil || rs == nil || len(rs) != 0 {
		t.Fatalf("empty catalog: %#v %v", rs, err)
	}
	off := newFixture(t, header)
	off.catMode.Store(catFail)
	if _, err := off.ad.Browse(context.Background(), "zh", "s", 12); err == nil {
		t.Fatal("offline browse returned no error")
	}
}
