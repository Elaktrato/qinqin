package lexicon_test

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"testing"

	"qinqin/internal/lang"
	"qinqin/internal/lexicon"
)

func init() {
	lang.Register(lang.Zh{})
	lang.Register(lang.Ja{})
}

// zhWord is a zh entry with one form, a pinyin reading (plain given) and
// optionally a bopomofo reading and glosses.
func zhWord(kind, form, pinyin, plain, bopomofo string, pri int, gloss ...string) *lexicon.Entry {
	e := &lexicon.Entry{
		Language: "zh", Kind: kind, Key: form,
		Forms:    []lexicon.Form{{Text: form}},
		Readings: []lexicon.Reading{{Type: "pinyin", Value: pinyin, Plain: plain}},
		Pri:      pri,
	}
	if bopomofo != "" {
		e.Readings = append(e.Readings, lexicon.Reading{Type: "bopomofo", Value: bopomofo, Plain: bopomofo})
	}
	if len(gloss) > 0 {
		e.Senses = []lexicon.Sense{{Glosses: gloss}}
	}
	return e
}

// hitView is a hit reduced to what the search tests compare.
type hitView struct {
	ID     int64
	Source string
}

func mustSearch(t *testing.T, st lexicon.Store, q lexicon.SearchQuery) []hitView {
	t.Helper()
	hits, err := st.Search(context.Background(), q)
	if err != nil {
		t.Fatalf("Search(%+v): %v", q, err)
	}
	if hits == nil {
		t.Fatalf("Search(%+v) = nil, want a non-nil slice", q)
	}
	out := []hitView{}
	for _, h := range hits {
		if h.Entry.ID == 0 || len(h.Entry.Forms) == 0 && len(h.Entry.Readings) == 0 {
			t.Errorf("hit %+v is not a loaded entry", h.Entry)
		}
		out = append(out, hitView{h.Entry.ID, h.Source})
	}
	return out
}

// zhFixture is a small zh lexicon covering every tier for the query "hao".
type zhFixture struct {
	st                             lexicon.Store
	dictID                         int64
	hao, hao4, haohua, liang, ziJa int64
}

func seedZh(t *testing.T) zhFixture {
	t.Helper()
	st := newStore(t)
	d := addDictionary(t, st, "zh-dict")
	f := zhFixture{st: st, dictID: d}
	// 号 is put first (lower id) but ranks below 好 by priority.
	f.hao4 = mustPut(t, st, zhWord("character", "号", "hào", "hao", "ㄏㄠˋ", 0, "number"), d)
	f.hao = mustPut(t, st, zhWord("character", "好", "hǎo", "hao", "ㄏㄠˇ", 5, "good"), d)
	f.haohua = mustPut(t, st, zhWord("word", "豪华", "háo huá", "haohua", "ㄏㄠˊ ㄏㄨㄚˊ", 0, "luxurious"), d)
	f.liang = mustPut(t, st, zhWord("character", "良", "liáng", "liang", "", 0, "good; hao (fixture)"), d)
	f.ziJa = mustPut(t, st, &lexicon.Entry{
		Language: "ja", Kind: "character", Key: "好",
		Forms:    []lexicon.Form{{Text: "好"}},
		Readings: []lexicon.Reading{{Type: "kun", Value: "この", Plain: "この"}},
	}, d)
	return f
}

func TestSearchTiersInOrder(t *testing.T) {
	f := seedZh(t)
	got := mustSearch(t, f.st, lexicon.SearchQuery{Text: "hao", Lang: "zh"})
	want := []hitView{
		{f.hao, "pinyin"},    // exact plain, priority 5
		{f.hao4, "pinyin"},   // exact plain, priority 0
		{f.haohua, "pinyin"}, // plain prefix
		{f.liang, "gloss"},   // gloss substring
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("hao = %+v, want %+v", got, want)
	}
}

func TestSearchFormBeforeReadingAndOneHitPerEntry(t *testing.T) {
	f := seedZh(t)
	// 好 matches by form; its gloss tier match ("good") is not repeated.
	got := mustSearch(t, f.st, lexicon.SearchQuery{Text: "好", Lang: "zh"})
	if want := []hitView{{f.hao, "written"}}; !reflect.DeepEqual(got, want) {
		t.Errorf("好 = %+v, want %+v", got, want)
	}
	got = mustSearch(t, f.st, lexicon.SearchQuery{Text: "good", Lang: "zh"})
	if want := []hitView{{f.hao, "gloss"}, {f.liang, "gloss"}}; !reflect.DeepEqual(got, want) {
		t.Errorf("good = %+v, want %+v (ranked by priority)", got, want)
	}
}

func TestSearchToneInsensitiveAndBopomofoPrefix(t *testing.T) {
	f := seedZh(t)
	got := mustSearch(t, f.st, lexicon.SearchQuery{Text: "hǎo", Lang: "zh"})
	if len(got) < 2 || got[0] != (hitView{f.hao, "pinyin"}) {
		t.Errorf("hǎo = %+v, want 好 via pinyin first", got)
	}
	got = mustSearch(t, f.st, lexicon.SearchQuery{Text: "ㄏㄠ", Lang: "zh"})
	want := []hitView{{f.hao, "bopomofo"}, {f.hao4, "bopomofo"}, {f.haohua, "bopomofo"}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("ㄏㄠ = %+v, want %+v", got, want)
	}
}

func TestSearchFilters(t *testing.T) {
	f := seedZh(t)
	got := mustSearch(t, f.st, lexicon.SearchQuery{Text: "hao", Lang: "zh", Kind: "word"})
	if want := []hitView{{f.haohua, "pinyin"}}; !reflect.DeepEqual(got, want) {
		t.Errorf("hao kind=word = %+v, want %+v", got, want)
	}

	// A scheme with level 1 = {号}, level 2 = {豪华}.
	db := f.st.DB
	var schemeID, l1, l2 int64
	if err := db.QueryRow(`INSERT INTO schemes (pack_id, name, unit, language, version, license, attribution, updated_at)
		VALUES ('hsk-x', 'HSK x', 'word', 'zh', '1', 'x', 'x', '2026-01-01T00:00:00Z') RETURNING id`).Scan(&schemeID); err != nil {
		t.Fatal(err)
	}
	for name, dst := range map[string]*int64{"1": &l1, "2": &l2} {
		if err := db.QueryRow(`INSERT INTO levels (scheme_id, ord, name, updated_at)
			VALUES (?, ?, ?, '2026-01-01T00:00:00Z') RETURNING id`, schemeID, name, name).Scan(dst); err != nil {
			t.Fatal(err)
		}
	}
	for level, entry := range map[int64]int64{l1: f.hao4, l2: f.haohua} {
		if _, err := db.Exec(`INSERT INTO level_members (level_id, entry_id, updated_at)
			VALUES (?, ?, '2026-01-01T00:00:00Z')`, level, entry); err != nil {
			t.Fatal(err)
		}
	}
	got = mustSearch(t, f.st, lexicon.SearchQuery{Text: "hao", Lang: "zh", SchemeID: "hsk-x"})
	if want := []hitView{{f.hao4, "pinyin"}, {f.haohua, "pinyin"}}; !reflect.DeepEqual(got, want) {
		t.Errorf("hao scheme=hsk-x = %+v, want %+v", got, want)
	}
	got = mustSearch(t, f.st, lexicon.SearchQuery{Text: "hao", Lang: "zh", SchemeID: "hsk-x", LevelName: "2"})
	if want := []hitView{{f.haohua, "pinyin"}}; !reflect.DeepEqual(got, want) {
		t.Errorf("hao scheme=hsk-x level=2 = %+v, want %+v", got, want)
	}
}

func TestSearchLanguageScopedAndCaseInsensitive(t *testing.T) {
	f := seedZh(t)
	got := mustSearch(t, f.st, lexicon.SearchQuery{Text: "好", Lang: "JA"})
	if want := []hitView{{f.ziJa, "written"}}; !reflect.DeepEqual(got, want) {
		t.Errorf("好 in ja = %+v, want %+v", got, want)
	}
}

func TestSearchRanksUsuallyKanaWithPriorityFirst(t *testing.T) {
	st := newStore(t)
	d := addDictionary(t, st, "jmdict")
	word := func(key, form string, pri int, uk bool) int64 {
		return mustPut(t, st, &lexicon.Entry{
			Language: "ja", Kind: "word", Key: key,
			Forms:    []lexicon.Form{{Text: form}},
			Readings: []lexicon.Reading{{Type: "kana", Value: "する", Plain: "する"}, {Type: "romaji", Value: "suru", Plain: "suru"}},
			Senses:   []lexicon.Sense{{Glosses: []string{key}}},
			Pri:      pri, UK: uk,
		}, d)
	}
	plain := word("j:1", "摺る", 0, false)
	frequent := word("j:2", "刷る", 20, false)
	suru := word("j:3", "為る", 10, true)
	got := mustSearch(t, st, lexicon.SearchQuery{Text: "suru", Lang: "ja"})
	want := []hitView{{suru, "kana"}, {frequent, "kana"}, {plain, "kana"}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("suru = %+v, want %+v", got, want)
	}
}

func TestSearchGlossMatchesWithinOneGloss(t *testing.T) {
	st := newStore(t)
	d := addDictionary(t, st, "d")
	gone := addDictionary(t, st, "gone")
	put := func(key string, dict int64, gloss ...string) int64 {
		return mustPut(t, st, &lexicon.Entry{
			Language: "en", Kind: "word", Key: key, Forms: []lexicon.Form{{Text: key}},
			Senses: []lexicon.Sense{{Glosses: gloss}},
		}, dict)
	}
	rd := put("rd", d, "R&D", "research")
	put("ab", d, "a", "b")
	put("hidden", gone, "research")
	if _, err := st.DB.Exec(`UPDATE dictionaries SET deleted_at = '2026-01-01T00:00:00Z' WHERE id = ?`, gone); err != nil {
		t.Fatal(err)
	}
	if got := mustSearch(t, st, lexicon.SearchQuery{Text: "r&d", Lang: "en"}); !reflect.DeepEqual(got, []hitView{{rd, "gloss"}}) {
		t.Errorf("r&d = %+v, want the R&D entry (HTML-escaped JSON still matches)", got)
	}
	if got := mustSearch(t, st, lexicon.SearchQuery{Text: `","`, Lang: "en"}); len(got) != 0 {
		t.Errorf(`"," = %+v, want no match across gloss boundaries`, got)
	}
	if got := mustSearch(t, st, lexicon.SearchQuery{Text: ",", Lang: "en"}); len(got) != 0 {
		t.Errorf(`"," = %+v, want no match on the array's punctuation`, got)
	}
	if got := mustSearch(t, st, lexicon.SearchQuery{Text: "research", Lang: "en"}); !reflect.DeepEqual(got, []hitView{{rd, "gloss"}}) {
		t.Errorf("research = %+v, want only the active dictionary's entry", got)
	}
	if got := mustSearch(t, st, lexicon.SearchQuery{Text: "%", Lang: "en"}); len(got) != 0 {
		t.Errorf("%% = %+v, want wildcards matched literally", got)
	}
}

func TestSearchQueryValidationAndLimits(t *testing.T) {
	st := newStore(t)
	d := addDictionary(t, st, "es")
	for i := range 250 {
		mustPut(t, st, &lexicon.Entry{
			Language: "es", Kind: "word", Key: fmt.Sprintf("a%03d", i),
			Forms:  []lexicon.Form{{Text: fmt.Sprintf("a%03d", i)}},
			Senses: []lexicon.Sense{{Glosses: []string{"alpha"}}},
		}, d)
	}
	ctx := context.Background()
	if _, err := st.Search(ctx, lexicon.SearchQuery{Text: "x"}); !errors.Is(err, lexicon.ErrInvalidQuery) {
		t.Errorf("no lang: err = %v, want ErrInvalidQuery", err)
	}
	if _, err := st.Search(ctx, lexicon.SearchQuery{Text: "x", Lang: "es", LevelName: "1"}); !errors.Is(err, lexicon.ErrInvalidQuery) {
		t.Errorf("level without scheme: err = %v, want ErrInvalidQuery", err)
	}
	if got := mustSearch(t, st, lexicon.SearchQuery{Text: "  ", Lang: "es"}); len(got) != 0 {
		t.Errorf("blank text = %+v, want none", got)
	}
	for _, tt := range []struct{ limit, want int }{{0, 50}, {2, 2}, {1000, 200}} {
		if got := mustSearch(t, st, lexicon.SearchQuery{Text: "alpha", Lang: "es", Limit: tt.limit}); len(got) != tt.want {
			t.Errorf("limit %d: %d hits, want %d", tt.limit, len(got), tt.want)
		}
	}
}

func TestCharsUnderAndRadicals(t *testing.T) {
	st := newStore(t)
	d := addDictionary(t, st, "unihan")
	char := func(c string) int64 {
		return mustPut(t, st, &lexicon.Entry{Language: "zh", Kind: "character", Key: c, Forms: []lexicon.Form{{Text: c}}}, d)
	}
	nu := char("女")
	zi := char("子")
	// 好 gets the lower id, 她 the smaller headword: the sort must not
	// fall back to id order.
	hao := char("好")
	ta := char("她")
	ctx := context.Background()
	for _, c := range []int64{ta, hao} {
		if err := st.Link(ctx, c, nu, lexicon.LinkRadical); err != nil {
			t.Fatal(err)
		}
	}
	got, err := st.CharsUnder(ctx, nu)
	if err != nil {
		t.Fatal(err)
	}
	// Ordered by headword: 她 (U+5979) before 好 (U+597D), against id order.
	if hao > ta {
		t.Fatalf("fixture: 好 id %d should be below 她 id %d", hao, ta)
	}
	if want := []int64{ta, hao}; !reflect.DeepEqual(ids(got), want) {
		t.Errorf("CharsUnder(女) = %v, want %v", ids(got), want)
	}
	if got, err := st.CharsUnder(ctx, zi); err != nil || got == nil || len(got) != 0 {
		t.Errorf("CharsUnder(子) = %v, %v, want an empty slice", got, err)
	}
	rad, err := st.Radicals(ctx, []int64{ta, hao, zi, nu})
	if err != nil {
		t.Fatal(err)
	}
	if want := map[int64]int64{ta: nu, hao: nu}; !reflect.DeepEqual(rad, want) {
		t.Errorf("Radicals = %v, want %v", rad, want)
	}
}
