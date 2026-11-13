package lexicon_test

import (
	"context"
	"fmt"
	"reflect"
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
		{ID: nichi, Char: "日", Strokes: 4, Grade: 1, JLPT: 4, Freq: 1, Reading: "ニチ", Gloss: "day"},
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
	if err := st.Link(context.Background(), xue, xue, lexicon.LinkVariant); err != nil {
		t.Fatal(err)
	}
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
		insert("ja", string(rune(base+i)), `{"freq":"12","grade":"3","jlpt":"2","src":"kd2","strokes":"8"}`, "on", "カン", "a gloss")
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if _, err := st.DB.Exec(`ANALYZE`); err != nil {
		t.Fatal(err)
	}
}

// TestCharactersPerformance guards the endpoint's cold cost: the version
// and the full list of a 15k-character universe stay under 300 ms.
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
		if limit := 300 * time.Millisecond; best > limit && !raceEnabled {
			t.Errorf("%s: version + list cost %v, want < %v", language, best, limit)
		}
	}
}
