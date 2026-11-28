package lexicon_test

import (
	"context"
	"fmt"
	"os"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"qinqin/internal/lexicon"
)

// charFixture is a character entry for the universe tests.
type charFixture struct {
	lang, char string
	attrs      map[string]string
	readings   []lexicon.Reading
	glosses    [][]string // one sense per element
}

func putChar(t *testing.T, st lexicon.Store, dictID int64, f charFixture) int64 {
	t.Helper()
	e := &lexicon.Entry{Language: f.lang, Kind: "character", Key: f.char,
		Forms: []lexicon.Form{{Text: f.char}}, Readings: f.readings, Attrs: f.attrs}
	for _, g := range f.glosses {
		e.Senses = append(e.Senses, lexicon.Sense{Glosses: g})
	}
	return mustPut(t, st, e, dictID)
}

func on(v string) lexicon.Reading     { return lexicon.Reading{Type: "on", Value: v, Plain: v} }
func kun(v string) lexicon.Reading    { return lexicon.Reading{Type: "kun", Value: v, Plain: v} }
func pinyin(v string) lexicon.Reading { return lexicon.Reading{Type: "pinyin", Value: v, Plain: v} }

func mustExec(t *testing.T, st lexicon.Store, query string, args ...any) {
	t.Helper()
	if _, err := st.DB.Exec(query, args...); err != nil {
		t.Fatalf("exec %q: %v", query, err)
	}
}

// characters lists language's universe and fails unless its staleness
// is wantStale.
func characters(t *testing.T, st lexicon.Store, language string, wantStale bool) []lexicon.CharacterRow {
	t.Helper()
	set, err := st.Characters(context.Background(), language)
	if err != nil {
		t.Fatalf("Characters(%s): %v", language, err)
	}
	if set.Rows == nil {
		t.Fatalf("Characters(%s).Rows = nil, want a non-nil slice", language)
	}
	if set.Stale != wantStale {
		t.Fatalf("Characters(%s).Stale = %v, want %v", language, set.Stale, wantStale)
	}
	return set.Rows
}

func TestCharactersJapaneseUniverse(t *testing.T) {
	st := newStore(t)
	kd2 := addDictionary(t, st, "kanjidic2")
	other := addDictionary(t, st, "other")

	// "jlpt" (the pre-2010 scale) is what an older seed stored: ignored.
	nichi := putChar(t, st, kd2, charFixture{lang: "ja", char: "日",
		attrs:    map[string]string{"src": "kd2", "strokes": "4", "grade": "1", "jlpt": "4", "freq": "1"},
		readings: []lexicon.Reading{kun("ひ"), on("ニチ"), on("ジツ")},
		glosses:  [][]string{{"day", "sun"}, {"Japan"}}})
	// Only kun readings: the first kun is used.
	kunOnly := putChar(t, st, kd2, charFixture{lang: "ja", char: "込",
		attrs:    map[string]string{"src": "kd2", "strokes": "5"},
		readings: []lexicon.Reading{kun("こ.む"), kun("こ.める")},
		glosses:  [][]string{{}, {"crowded"}}}) // an empty first sense is skipped
	// KANJIDIC2 character without readings, senses or levels.
	bare := putChar(t, st, kd2, charFixture{lang: "ja", char: "丂",
		attrs: map[string]string{"src": "kd2", "grade": "x", "jlpt": "0", "freq": "-3"}})
	// Long reading and gloss are cut.
	long := putChar(t, st, kd2, charFixture{lang: "ja", char: "龘",
		attrs:    map[string]string{"src": "kd2"},
		readings: []lexicon.Reading{on(strings.Repeat("ア", 20))},
		glosses:  [][]string{{strings.Repeat("g", 60)}}})
	// The gloss comes from the lowest dictionary id, then sense order.
	multi := putChar(t, st, other, charFixture{lang: "ja", char: "語",
		attrs: map[string]string{"src": "kd2", "grade": "2"}, glosses: [][]string{{"other gloss"}}})
	putChar(t, st, kd2, charFixture{lang: "ja", char: "語",
		attrs: map[string]string{"src": "kd2", "grade": "2"}, glosses: [][]string{{"word"}, {"speech"}}})

	// Outside the universe: a bare radical (no src), a word, a deleted
	// character and another language's character.
	putChar(t, st, kd2, charFixture{lang: "ja", char: "戶", attrs: map[string]string{"strokes": "4"}})
	mustPut(t, st, &lexicon.Entry{Language: "ja", Kind: "word", Key: "w1",
		Forms: []lexicon.Form{{Text: "日本"}}, Attrs: map[string]string{"src": "kd2"}}, kd2)
	gone := putChar(t, st, kd2, charFixture{lang: "ja", char: "亡", attrs: map[string]string{"src": "kd2"}})
	mustExec(t, st, `UPDATE entries SET deleted_at = '2026-01-02T00:00:00Z' WHERE id = ?`, gone)
	putChar(t, st, kd2, charFixture{lang: "zh", char: "日", attrs: map[string]string{"src": "kd2", "tghz": "1"}})

	got := characters(t, st, "ja", false)
	want := []lexicon.CharacterRow{
		{ID: bare, Char: "丂"},
		{ID: nichi, Char: "日", Strokes: 4, Grade: 1, Freq: 1, Reading: "ニチ", Gloss: "day"},
		{ID: multi, Char: "語", Grade: 2, Gloss: "word"},
		{ID: kunOnly, Char: "込", Strokes: 5, Reading: "こ.む", Gloss: "crowded"},
		{ID: long, Char: "龘", Reading: strings.Repeat("ア", 15) + "…", Gloss: strings.Repeat("g", 47) + "…"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Characters(ja) =\n%+v\nwant\n%+v", got, want)
	}

	// Uninstalling the first dictionary falls back to the next one's gloss.
	mustExec(t, st, `UPDATE dictionaries SET deleted_at = '2026-01-02T00:00:00Z' WHERE id = ?`, kd2)
	for _, r := range characters(t, st, "ja", false) {
		if r.ID == multi && r.Gloss != "other gloss" {
			t.Errorf("語 gloss after uninstall = %q, want %q", r.Gloss, "other gloss")
		}
		if r.ID == nichi && r.Gloss != "" {
			t.Errorf("日 gloss after uninstall = %q, want none", r.Gloss)
		}
	}
}

func TestCharactersChineseUniverse(t *testing.T) {
	st := newStore(t)
	cedict := addDictionary(t, st, "cedict")
	unihan := addDictionary(t, st, "unihan")

	ai := putChar(t, st, cedict, charFixture{lang: "zh", char: "爱",
		attrs:    map[string]string{"tghz": "1", "gb": "1", "strokes": "10"},
		readings: []lexicon.Reading{{Type: "bopomofo", Value: "ㄞˋ", Plain: "ㄞˋ"}, pinyin("ài")},
		glosses:  [][]string{{"to love", "affection"}}})
	// The traditional partner: not in the universe, but its grade and form
	// reach the simplified cell.
	aiTrad := putChar(t, st, unihan, charFixture{lang: "zh", char: "愛",
		attrs: map[string]string{"hkgrade": "1", "strokes": "13"}, glosses: [][]string{{"love"}}})
	if err := st.Link(context.Background(), ai, aiTrad, lexicon.LinkVariant); err != nil {
		t.Fatal(err)
	}
	// Standard-list only (no pinyin) and pinyin only (no standard list).
	tghzOnly := putChar(t, st, unihan, charFixture{lang: "zh", char: "乂",
		attrs: map[string]string{"tghz": "1", "gb": "2", "strokes": "2"}})
	pinyinOnly := putChar(t, st, cedict, charFixture{lang: "zh", char: "叒",
		readings: []lexicon.Reading{pinyin("ruò")}, glosses: [][]string{{"obscure"}}})
	// The lowest grade of the character and its partners wins; a link stored in one direction
	// only still counts; a deleted link, a deleted partner and the
	// character's own glyph are not variants; duplicates are dropped.
	xue := putChar(t, st, cedict, charFixture{lang: "zh", char: "学",
		attrs: map[string]string{"tghz": "1", "hkgrade": "2"}, readings: []lexicon.Reading{pinyin("xué")}})
	xueTrad := putChar(t, st, unihan, charFixture{lang: "zh", char: "學", attrs: map[string]string{"hkgrade": "1"}})
	xueOld := putChar(t, st, unihan, charFixture{lang: "zh", char: "斈"})
	xueGone := putChar(t, st, unihan, charFixture{lang: "zh", char: "敩"})
	mustExec(t, st, `INSERT INTO entry_links (from_id, to_id, type, updated_at) VALUES (?, ?, 'variant', '2026-01-01T00:00:00Z')`, xueTrad, xue)
	mustExec(t, st, `INSERT INTO entry_links (from_id, to_id, type, updated_at) VALUES (?, ?, 'variant', '2026-01-01T00:00:00Z')`, xue, xueTrad)
	mustExec(t, st, `INSERT INTO entry_links (from_id, to_id, type, updated_at, deleted_at) VALUES (?, ?, 'variant', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z')`, xue, xueOld)
	if err := st.Link(context.Background(), xue, xueGone, lexicon.LinkVariant); err != nil {
		t.Fatal(err)
	}
	mustExec(t, st, `UPDATE entries SET deleted_at = '2026-01-02T00:00:00Z' WHERE id = ?`, xueGone)
	// A self-link cannot come through Link any more; legacy rows can exist.
	mustExec(t, st, `INSERT INTO entry_links (from_id, to_id, type, updated_at) VALUES (?, ?, 'variant', '2026-01-01T00:00:00Z')`, xue, xue)
	// A radical link is not a variant.
	if err := st.Link(context.Background(), xue, tghzOnly, lexicon.LinkRadical); err != nil {
		t.Fatal(err)
	}

	// Outside: neither list nor pinyin (bopomofo only), a deleted
	// pinyin character, and a pinyin word.
	putChar(t, st, unihan, charFixture{lang: "zh", char: "㐀", attrs: map[string]string{"strokes": "5"},
		readings: []lexicon.Reading{{Type: "bopomofo", Value: "ㄑㄧㄡ", Plain: "ㄑㄧㄡ"}}})
	gone := putChar(t, st, cedict, charFixture{lang: "zh", char: "亡", readings: []lexicon.Reading{pinyin("wáng")}})
	mustExec(t, st, `UPDATE entries SET deleted_at = '2026-01-02T00:00:00Z' WHERE id = ?`, gone)
	mustPut(t, st, &lexicon.Entry{Language: "zh", Kind: "word", Key: "w",
		Forms: []lexicon.Form{{Text: "爱人"}}, Readings: []lexicon.Reading{pinyin("àirén")}}, cedict)
	// CC-CEDICT letter lines are not Han; the ideographic zero is.
	putChar(t, st, cedict, charFixture{lang: "zh", char: "A", readings: []lexicon.Reading{pinyin("a")}})
	putChar(t, st, cedict, charFixture{lang: "zh", char: "○", readings: []lexicon.Reading{pinyin("líng")}})
	ling := putChar(t, st, cedict, charFixture{lang: "zh", char: "〇", readings: []lexicon.Reading{pinyin("líng")}})
	// A deleted pinyin reading does not count.
	putChar(t, st, cedict, charFixture{lang: "zh", char: "丟", readings: []lexicon.Reading{pinyin("diū")}})
	mustExec(t, st, `UPDATE readings SET deleted_at = '2026-01-02T00:00:00Z' WHERE value = 'diū'`)

	got := characters(t, st, "zh", false)
	want := []lexicon.CharacterRow{
		{ID: ling, Char: "〇", Reading: "líng"},
		{ID: tghzOnly, Char: "乂", Strokes: 2, TGHZ: 1, GB: 2},
		{ID: pinyinOnly, Char: "叒", Reading: "ruò", Gloss: "obscure"},
		{ID: xue, Char: "学", TGHZ: 1, HKGrade: 1, Reading: "xué", Variants: []string{"學"}},
		{ID: ai, Char: "爱", Strokes: 10, TGHZ: 1, GB: 1, HKGrade: 1, Reading: "ài", Gloss: "to love", Variants: []string{"愛"}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Characters(zh) =\n%+v\nwant\n%+v", got, want)
	}
}

// The first gloss skips CC-CEDICT's surname and cross-reference lines
// (across all glosses of all live senses, in dictionary then sense
// order), the first reading skips placeholder and digit pinyin, and the
// radical blocks and non-letter marks are not cells.
func TestCharactersMeaningfulFields(t *testing.T) {
	st := newStore(t)
	cedict := addDictionary(t, st, "cedict")
	unihan := addDictionary(t, st, "unihan")
	zh := func(dict int64, char string, readings []lexicon.Reading, glosses ...[]string) int64 {
		return putChar(t, st, dict, charFixture{lang: "zh", char: char, attrs: map[string]string{"tghz": "1"},
			readings: readings, glosses: glosses})
	}
	py := []lexicon.Reading{pinyin("x")}

	san := zh(cedict, "三", []lexicon.Reading{pinyin("sān")}, []string{"surname San"}, []string{"three", "3"})
	zh(unihan, "三", []lexicon.Reading{pinyin("sān")}, []string{"three"})
	// The real meaning sits after meta glosses inside the same sense.
	shi := zh(cedict, "世", py, []string{"Surname Shi", "life", "world"})
	gan := zh(cedict, "干", py, []string{"old variant of 乾|干[gan1]"}, []string{"surname Gan"},
		[]string{"Variant of 乾"}, []string{"dry", "dried food"})
	// Every CEDICT line is meta: the next dictionary's meaning wins.
	ke := zh(cedict, "兙", []lexicon.Reading{pinyin("shi2ke4")}, []string{"(old) contracted variant of 十克[shi2 ke4]"})
	zh(unihan, "兙", []lexicon.Reading{pinyin("shi2ke4")}, []string{"decagram"})
	// Only meta glosses: the first one stays.
	ding := zh(cedict, "丁", py, []string{"see also 丁丁"}, []string{"used in 丁丁[zheng1 zheng1]"})
	// A slang or vulgar line is skipped like a meta line (#345, docs/contracts/senses).
	ji := zh(cedict, "鸡", py, []string{"(slang) prostitute"}, []string{"variant of 雞|鸡[ji1]", "fowl"})
	cao := zh(cedict, "肏", py, []string{"to fuck (vulgar)"})
	metas := map[string]string{
		"乚": "archaic variant of 乙", "乛": "also written 乙", "乜": "abbr. for 乜斜",
		"乞": "CL:个[ge4]", "乡": "Kangxi radical 5", "乢": "see 乞", "乣": "(archaic) variant of 糾",
	}
	metaIDs := map[string]int64{}
	for char, gloss := range metas {
		metaIDs[char] = zh(cedict, char, py, []string{gloss}, []string{"meaning of " + char})
	}
	// Readings: the placeholder and digit forms are skipped.
	iter := zh(cedict, "々", []lexicon.Reading{pinyin("xx5")}, []string{"iteration mark"})
	li := zh(cedict, "里", []lexicon.Reading{pinyin("xx5"), pinyin("Li3"), pinyin("lǐ")}, []string{"inside"})
	// Glyphs: radical-block forms and non-letter marks are not cells;
	// astral and compatibility ideographs and the Suzhou numerals are.
	for _, char := range []string{"⺮", "⼀", "〻", "\U00016FE3"} {
		zh(cedict, char, py, []string{"mark"})
	}
	astral := zh(cedict, "𠀀", py, []string{"astral"})
	compat := zh(cedict, "﨎", py, []string{"compat"})
	suzhou := zh(cedict, "〢", py, []string{"two"})

	got := map[string]lexicon.CharacterRow{}
	for _, r := range characters(t, st, "zh", false) {
		got[r.Char] = r
	}
	for _, c := range []struct {
		char    string
		id      int64
		reading string
		gloss   string
	}{
		{"三", san, "sān", "three"},
		{"世", shi, "x", "life"},
		{"干", gan, "x", "dry"},
		{"兙", ke, "", "decagram"},
		{"丁", ding, "x", "see also 丁丁"},
		{"鸡", ji, "x", "fowl"},
		{"肏", cao, "x", "to fuck (vulgar)"},
		{"々", iter, "", "iteration mark"},
		{"里", li, "lǐ", "inside"},
		{"𠀀", astral, "x", "astral"},
		{"﨎", compat, "x", "compat"},
		{"〢", suzhou, "x", "two"},
	} {
		r, ok := got[c.char]
		if !ok || r.ID != c.id || r.Reading != c.reading || r.Gloss != c.gloss {
			t.Errorf("%s = %+v (listed %v), want id %d reading %q gloss %q", c.char, r, ok, c.id, c.reading, c.gloss)
		}
	}
	for char, id := range metaIDs {
		if r := got[char]; r.ID != id || r.Gloss != "meaning of "+char {
			t.Errorf("%s gloss = %q, want the meaning after %q", char, r.Gloss, metas[char])
		}
	}
	for _, char := range []string{"⺮", "⼀", "〻", "\U00016FE3"} {
		if r, ok := got[char]; ok {
			t.Errorf("%U listed: %+v", []rune(char)[0], r)
		}
	}

	// ja takes the same gloss rule.
	kd2 := addDictionary(t, st, "kd2")
	ja := putChar(t, st, kd2, charFixture{lang: "ja", char: "丈", attrs: map[string]string{"src": "kd2"},
		glosses: [][]string{{"see 丈夫", "length"}}})
	if rows := characters(t, st, "ja", false); len(rows) != 1 || rows[0].ID != ja || rows[0].Gloss != "length" {
		t.Errorf("ja = %+v, want 丈 with gloss length", rows)
	}
}

func TestCharactersOtherLanguages(t *testing.T) {
	st := newStore(t)
	d := addDictionary(t, st, "d")
	putChar(t, st, d, charFixture{lang: "es", char: "ñ", attrs: map[string]string{"src": "kd2", "tghz": "1"},
		readings: []lexicon.Reading{pinyin("x"), on("x")}})
	for _, language := range []string{"es", "ko"} {
		if got := characters(t, st, language, false); len(got) != 0 {
			t.Errorf("Characters(%s) = %+v, want empty", language, got)
		}
		if lexicon.HasCharacterUniverse(language) {
			t.Errorf("HasCharacterUniverse(%s) = true", language)
		}
	}
	// ja and zh without any character at all: empty and stale.
	for _, language := range []string{"ja", "zh"} {
		if got := characters(t, st, language, true); len(got) != 0 {
			t.Errorf("Characters(%s) = %+v, want empty", language, got)
		}
		if !lexicon.HasCharacterUniverse(language) {
			t.Errorf("HasCharacterUniverse(%s) = false", language)
		}
	}
}

// A database seeded before the level attrs existed: ja has no src and zh
// no tghz. The fallback rules still list the characters, marked stale,
// until one character carries the marker.
func TestCharactersStaleFallback(t *testing.T) {
	st := newStore(t)
	d := addDictionary(t, st, "d")
	strokes := putChar(t, st, d, charFixture{lang: "ja", char: "日", attrs: map[string]string{"strokes": "4"}})
	reading := putChar(t, st, d, charFixture{lang: "ja", char: "月", readings: []lexicon.Reading{kun("つき")}})
	putChar(t, st, d, charFixture{lang: "ja", char: "戶"}) // no KANJIDIC2 data
	py := putChar(t, st, d, charFixture{lang: "zh", char: "爱", attrs: map[string]string{"gb": "1"},
		readings: []lexicon.Reading{pinyin("ài")}})
	putChar(t, st, d, charFixture{lang: "zh", char: "乂", attrs: map[string]string{"strokes": "2"}})

	ja := characters(t, st, "ja", true)
	if want := []lexicon.CharacterRow{
		{ID: strokes, Char: "日", Strokes: 4},
		{ID: reading, Char: "月", Reading: "つき"},
	}; !reflect.DeepEqual(ja, want) {
		t.Errorf("stale ja = %+v, want %+v", ja, want)
	}
	zh := characters(t, st, "zh", true)
	if want := []lexicon.CharacterRow{{ID: py, Char: "爱", GB: 1, Reading: "ài"}}; !reflect.DeepEqual(zh, want) {
		t.Errorf("stale zh = %+v, want %+v", zh, want)
	}

	// One marked character switches to the current rule.
	kd2 := putChar(t, st, d, charFixture{lang: "ja", char: "木", attrs: map[string]string{"src": "kd2"}})
	if got := characters(t, st, "ja", false); len(got) != 1 || got[0].ID != kd2 {
		t.Errorf("current ja = %+v, want only 木", got)
	}
	putChar(t, st, d, charFixture{lang: "zh", char: "乂", attrs: map[string]string{"strokes": "2", "tghz": "1"}})
	if got := characters(t, st, "zh", false); len(got) != 2 {
		t.Errorf("current zh = %+v, want 乂 and 爱", got)
	}
}

func TestCharactersVersion(t *testing.T) {
	st := newStore(t)
	ctx := context.Background()
	d := addDictionary(t, st, "d")
	a := putChar(t, st, d, charFixture{lang: "zh", char: "爱", attrs: map[string]string{"tghz": "1"}})
	b := putChar(t, st, d, charFixture{lang: "zh", char: "愛"})

	version := func() string {
		t.Helper()
		v, err := st.CharactersVersion(ctx)
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	first := version()
	if first == "" {
		t.Fatal("empty version")
	}
	if again := version(); again != first {
		t.Fatalf("version changed without a write: %q then %q", first, again)
	}

	// Each kind of write that can alter a list moves the version: an
	// entry or partner update, a new entry, a new link, a link deletion
	// and an uninstalled dictionary.
	changes := []struct {
		name  string
		query string
		args  []any
	}{
		{"entry", `UPDATE entries SET attrs = '{"tghz":"1","gb":"1"}', updated_at = '2099-01-01T00:00:00Z' WHERE id = ?`, []any{a}},
		{"partner entry", `UPDATE entries SET attrs = '{"hkgrade":"1"}', updated_at = '2099-01-02T00:00:00Z' WHERE id = ?`, []any{b}},
		{"new entry", `INSERT INTO entries (language, kind, ext_key, updated_at) VALUES ('zh', 'character', '叒', '2000-01-01T00:00:00Z')`, nil},
		{"link", `INSERT INTO entry_links (from_id, to_id, type, updated_at) VALUES (?, ?, 'variant', '2000-01-01T00:00:00Z')`, []any{a, b}},
		{"link deletion", `UPDATE entry_links SET deleted_at = '2099-01-03T00:00:00Z', updated_at = '2099-01-03T00:00:00Z'`, nil},
		{"dictionary", `UPDATE dictionaries SET deleted_at = '2099-01-04T00:00:00Z', updated_at = '2099-01-04T00:00:00Z' WHERE id = ?`, []any{d}},
	}
	prev := first
	for _, c := range changes {
		mustExec(t, st, c.query, c.args...)
		next := version()
		if next == prev {
			t.Errorf("version unchanged after a %s change: %q", c.name, next)
		}
		prev = next
	}
}

// seedCharacterUniverse writes n zh universe characters (every third with
// a traditional partner outside the universe), n/2 characters outside it
// and n ja KANJIDIC2 characters with raw SQL in one transaction, the
// shape and scale of the real lexicon.
func seedCharacterUniverse(t testing.TB, st lexicon.Store, n int) {
	t.Helper()
	tx, err := st.DB.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	const stamp = "2026-01-01T00:00:00Z"
	var dict int64
	if err := tx.QueryRow(`INSERT INTO dictionaries (pack_id, name, version, license, attribution, updated_at)
		VALUES ('gen', 'gen', '1', 'x', 'x', ?) RETURNING id`, stamp).Scan(&dict); err != nil {
		t.Fatal(err)
	}
	insert := func(language, char, attrs string, readingType, reading, gloss string) int64 {
		var id int64
		if err := tx.QueryRow(`INSERT INTO entries (language, kind, ext_key, attrs, updated_at)
			VALUES (?, 'character', ?, ?, ?) RETURNING id`, language, char, attrs, stamp).Scan(&id); err != nil {
			t.Fatal(err)
		}
		if _, err := tx.Exec(`INSERT INTO forms (entry_id, text, ord, updated_at) VALUES (?, ?, 0, ?)`, id, char, stamp); err != nil {
			t.Fatal(err)
		}
		if reading != "" {
			for ord, typ := range []string{"bopomofo", readingType} {
				if _, err := tx.Exec(`INSERT INTO readings (entry_id, type, value, plain, ord, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
					id, typ, reading, reading, ord, stamp); err != nil {
					t.Fatal(err)
				}
			}
		}
		if gloss != "" {
			for ord := 0; ord < 2; ord++ {
				if _, err := tx.Exec(`INSERT INTO senses (entry_id, dictionary_id, ord, glosses, updated_at) VALUES (?, ?, ?, ?, ?)`,
					id, dict, ord, fmt.Sprintf(`[%q, "more"]`, gloss), stamp); err != nil {
					t.Fatal(err)
				}
			}
		}
		return id
	}
	link := func(a, b int64) {
		for _, p := range [][2]int64{{a, b}, {b, a}} {
			if _, err := tx.Exec(`INSERT INTO entry_links (from_id, to_id, type, updated_at) VALUES (?, ?, 'variant', ?)`, p[0], p[1], stamp); err != nil {
				t.Fatal(err)
			}
		}
	}
	base := 0x4E00
	for i := 0; i < n; i++ {
		attrs := `{"strokes":"7"}`
		reading := "pīn"
		switch i % 3 {
		case 0:
			attrs = `{"gb":"1","strokes":"7","tghz":"1"}`
		case 1:
			attrs = `{"hkgrade":"3","strokes":"9","tghz":"1"}`
			reading = ""
		}
		id := insert("zh", string(rune(base+i)), attrs, "pinyin", reading, "a gloss of moderate length here")
		if i%3 == 0 {
			partner := insert("zh", string(rune(0x20000+i)), `{"hkgrade":"2"}`, "", "", "trad")
			link(id, partner)
		}
	}
	for i := 0; i < n/2; i++ {
		insert("zh", string(rune(0x30000+i)), `{"strokes":"12"}`, "bopomofo", "ㄅ", "")
	}
	for i := 0; i < n; i++ {
		insert("ja", string(rune(base+i)), `{"freq":"12","grade":"3","src":"kd2","strokes":"8"}`, "on", "カン", "a gloss")
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if _, err := st.DB.Exec(`ANALYZE`); err != nil {
		t.Fatal(err)
	}
}

// perfBudget is the most the version plus the full list of the 15k-character
// fixture may cost. It is a regression guard against complexity mistakes (an
// N+1 query, a table scan), not a benchmark: on a developer machine the work
// takes 0.1–0.25 s and on a GitHub-hosted runner 0.4–0.7 s, so the default
// leaves several times that headroom and a slow or busy machine does not
// fail the build. QINQIN_PERF_BUDGET_MS overrides it in milliseconds (set a
// tighter value locally to benchmark, e.g. 300).
func perfBudget(t *testing.T) time.Duration {
	t.Helper()
	if v := os.Getenv("QINQIN_PERF_BUDGET_MS"); v != "" {
		ms, err := strconv.Atoi(v)
		if err != nil || ms <= 0 {
			t.Fatalf("QINQIN_PERF_BUDGET_MS = %q, want a positive number of milliseconds", v)
		}
		return time.Duration(ms) * time.Millisecond
	}
	return 3 * time.Second
}

// TestCharactersPerformance guards the endpoint's cold cost: the version
// and the full list of a 15k-character universe stay within perfBudget.
func TestCharactersPerformance(t *testing.T) {
	if testing.Short() {
		t.Skip("generates a large fixture")
	}
	st := newStore(t)
	const n = 15000
	seedCharacterUniverse(t, st, n)
	ctx := context.Background()
	for _, language := range []string{"zh", "ja"} {
		// Warm the page cache once, as a running server would be.
		if _, err := st.Characters(ctx, language); err != nil {
			t.Fatal(err)
		}
		// The best of three runs, measured as the CPU time of the thread
		// doing the work where the OS reports it (else wall time): the
		// guard is about the work, not about the scheduling of a busy
		// machine running the other packages' tests in parallel.
		var (
			set             lexicon.CharacterSet
			best, bestWall  time.Duration
			measuredCPU     bool
			verErr, listErr error
		)
		for run := 0; run < 3; run++ {
			start := time.Now()
			cpu, ok := threadCPU(func() {
				if _, verErr = st.CharactersVersion(ctx); verErr != nil {
					return
				}
				set, listErr = st.Characters(ctx, language)
			})
			wall := time.Since(start)
			if verErr != nil || listErr != nil {
				t.Fatal(verErr, listErr)
			}
			cost := wall
			if ok {
				cost, measuredCPU = cpu, true
			}
			if run == 0 || cost < best {
				best = cost
			}
			if run == 0 || wall < bestWall {
				bestWall = wall
			}
		}
		rows := set.Rows
		if len(rows) != n || set.Stale {
			t.Fatalf("%s: %d rows (stale %v), want %d", language, len(rows), set.Stale, n)
		}
		if language == "zh" && (rows[0].Variants == nil || rows[0].HKGrade != 2) {
			t.Fatalf("zh first row %+v, want a variant and the partner's grade", rows[0])
		}
		t.Logf("%s: version + list of %d characters: %v (thread CPU: %v), wall %v", language, n, best, measuredCPU, bestWall)
		if limit := perfBudget(t); best > limit && !raceEnabled {
			t.Errorf("%s: version + list cost %v, want < %v", language, best, limit)
		}
	}
}

// Radical is the Kangxi number of the first live form of the live target
// of the character's live radical link; a missing link, a deleted link, a
// deleted radical entry or a target whose glyph is no table character
// gives 0.
func TestCharactersRadical(t *testing.T) {
	st := newStore(t)
	kd2 := addDictionary(t, st, "kanjidic2")
	ctx := context.Background()
	link := func(from, to int64) {
		t.Helper()
		if err := st.Link(ctx, from, to, lexicon.LinkRadical); err != nil {
			t.Fatal(err)
		}
	}
	ja := func(char string) int64 {
		return putChar(t, st, kd2, charFixture{lang: "ja", char: char, attrs: map[string]string{"src": "kd2"}})
	}
	zh := func(char string) int64 {
		return putChar(t, st, kd2, charFixture{lang: "zh", char: char, attrs: map[string]string{"tghz": "1"}})
	}
	// ja: 海 → 水 (85); 語 → 言 (149); 犬 has no link.
	mizu, gen := ja("水"), ja("言")
	umi, go_, inu := ja("海"), ja("語"), ja("犬")
	link(umi, mizu)
	link(go_, gen)
	// A deleted link and a deleted radical entry give no k.
	lost, gone := ja("河"), ja("話")
	link(lost, mizu)
	mustExec(t, st, `UPDATE entry_links SET deleted_at = '2026-01-02T00:00:00Z' WHERE from_id = ? AND type = 'radical'`, lost)
	hi := ja("火")
	link(gone, hi)
	mustExec(t, st, `UPDATE entries SET deleted_at = '2026-01-02T00:00:00Z' WHERE id = ?`, hi)
	// zh: 语 → 言 (149), a simplified character under its Kangxi number.
	zgen, yu := zh("言"), zh("语")
	link(yu, zgen)

	byID := map[int64]int{}
	for _, r := range characters(t, st, "ja", false) {
		byID[r.ID] = r.Radical
	}
	for _, r := range characters(t, st, "zh", false) {
		byID[r.ID] = r.Radical
	}
	for id, want := range map[int64]int{umi: 85, go_: 149, inu: 0, mizu: 0, lost: 0, gone: 0, yu: 149, zgen: 0} {
		if got := byID[id]; got != want {
			t.Errorf("entry %d radical = %d, want %d", id, got, want)
		}
	}

	// The radical subquery seeks the entry_links primary key on from_id,
	// like the variant partners' forward half: two such seeks.
	query, _ := lexicon.CharactersQueryForTest("ja", false)
	rows, err := st.DB.QueryContext(ctx, "EXPLAIN QUERY PLAN "+query, "ja")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var plan []string
	for rows.Next() {
		var id, parent, notused int
		var detail string
		if err := rows.Scan(&id, &parent, &notused, &detail); err != nil {
			t.Fatal(err)
		}
		plan = append(plan, detail)
	}
	t.Logf("query plan:\n%s", strings.Join(plan, "\n"))
	seeks := 0
	for _, d := range plan {
		if strings.Contains(d, "entry_links") && strings.Contains(d, "(from_id=?)") {
			seeks++
		}
	}
	if seeks != 2 {
		t.Errorf("entry_links seeks on from_id = %d, want 2 (variants and radical)", seeks)
	}
}
