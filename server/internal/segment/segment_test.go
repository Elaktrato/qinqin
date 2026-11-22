package segment_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"qinqin/internal/db"
	"qinqin/internal/dict"
	"qinqin/internal/freq"
	"qinqin/internal/lang"
	"qinqin/internal/lexicon"
	"qinqin/internal/lookup"
	"qinqin/internal/segment"
)

func init() {
	lang.Register(lang.Ja{})
	lang.Register(lang.Zh{})
}

// jmdictHead is the JMdict DOCTYPE in the real file's shape: some
// entities declared, the rest arriving as "&name;" text.
const jmdictHead = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE JMdict [
<!ENTITY rK "rarely used kanji form">
<!ENTITY uk "word usually written using kana alone">
<!ENTITY v1 "Ichidan verb">
<!ENTITY n "noun (common) (futsuumeishi)">
]>
<JMdict>
`

// jw is one JMdict word of the in-test dictionary.
type jw struct {
	kanji, readings []string
	pos             []string // entity names, e.g. "v1"
	pri             []string // priority tags on the first form (or reading)
	uk              bool
	// senses, when set, replaces pos/uk: one sense each, in order.
	senses []jwSense
}

// jwSense is one sense of an in-test word.
type jwSense struct {
	pos []string
	uk  bool
}

// jmdictXML renders words as a JMdict file, ent_seq in order.
func jmdictXML(words []jw) string {
	var b strings.Builder
	b.WriteString(jmdictHead)
	for i, w := range words {
		fmt.Fprintf(&b, "<entry>\n<ent_seq>%d</ent_seq>\n", 1000000+i)
		for j, k := range w.kanji {
			b.WriteString("<k_ele><keb>" + k + "</keb>")
			if j == 0 {
				for _, p := range w.pri {
					b.WriteString("<ke_pri>" + p + "</ke_pri>")
				}
			}
			b.WriteString("</k_ele>\n")
		}
		for j, r := range w.readings {
			b.WriteString("<r_ele><reb>" + r + "</reb>")
			if j == 0 {
				for _, p := range w.pri {
					b.WriteString("<re_pri>" + p + "</re_pri>")
				}
			}
			b.WriteString("</r_ele>\n")
		}
		senses := w.senses
		if len(senses) == 0 {
			senses = []jwSense{{pos: w.pos, uk: w.uk}}
		}
		for j, sn := range senses {
			b.WriteString("<sense>")
			for _, p := range sn.pos {
				b.WriteString("<pos>&" + p + ";</pos>")
			}
			if sn.uk {
				b.WriteString("<misc>&uk;</misc>")
			}
			fmt.Fprintf(&b, "<gloss>gloss %d.%d</gloss></sense>\n", i, j)
		}
		b.WriteString("</entry>\n")
	}
	b.WriteString("</JMdict>\n")
	return b.String()
}

func openDB(t *testing.T) *sql.DB {
	t.Helper()
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	return sqlDB
}

// importPack writes the manifest and one data file into a fresh pack
// directory and imports it with the real importer of its type.
func importPack(t *testing.T, sqlDB *sql.DB, m dict.Manifest, file, content string) {
	t.Helper()
	dir := t.TempDir()
	manifest, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	for name, body := range map[string]string{"manifest.json": string(manifest), file: content} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	p, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatalf("LoadPack(%s): %v", m.ID, err)
	}
	ctx := context.Background()
	if m.Type == dict.TypeFrequency {
		_, err = freq.Import(ctx, sqlDB, &p)
	} else {
		_, err = dict.ImportLexicon(ctx, sqlDB, &p)
	}
	if err != nil {
		t.Fatalf("import %s: %v", m.ID, err)
	}
}

func service(sqlDB *sql.DB) segment.Service {
	return segment.Service{Lookup: lookup.Service{Lexicon: lexicon.Store{DB: sqlDB}, Freq: freq.Store{DB: sqlDB}, DB: sqlDB}}
}

// jaService imports words as JMdict and, when freqRows is not empty, a
// frequency pack of "term,reading,rank" rows.
func jaService(t *testing.T, words []jw, freqRows string) (segment.Service, *sql.DB) {
	t.Helper()
	sqlDB := openDB(t)
	importPack(t, sqlDB, dict.Manifest{
		ID: "jmdict-test", Name: "JMdict test", Version: "1", Type: "dictionary", Language: "ja",
		License: "CC BY-SA 4.0", Attribution: "EDRDG", Format: "jmdict",
	}, "jmdict.xml", jmdictXML(words))
	if freqRows != "" {
		importPack(t, sqlDB, dict.Manifest{
			ID: "freq-test", Name: "Freq test", Version: "1", Type: "frequency", Language: "ja",
			License: "CC BY-SA 4.0", Attribution: "test", Format: "freq-csv",
		}, "freq.csv", "term,reading,rank\n"+freqRows)
	}
	return service(sqlDB), sqlDB
}

// zhLines is CC-CEDICT: traditional, simplified, [pinyin], /glosses/.
const zhLines = `我 我 [wo3] /I/
喜 喜 [xi3] /happy/
歡 欢 [huan1] /joyous/
喜歡 喜欢 [xi3 huan5] /to like/
學 学 [xue2] /to learn/
習 习 [xi2] /to practice/
學習 学习 [xue2 xi2] /to learn/
漢 汉 [han4] /Han/
語 语 [yu3] /language/
漢語 汉语 [Han4 yu3] /Chinese language/
𠮷 𠮷 [ji2] /variant of 吉/
`

func zhService(t *testing.T) segment.Service {
	t.Helper()
	sqlDB := openDB(t)
	importPack(t, sqlDB, dict.Manifest{
		ID: "cedict-test", Name: "CC-CEDICT test", Version: "1", Type: "dictionary", Language: "zh",
		License: "CC BY-SA 4.0", Attribution: "CC-CEDICT", Format: "cedict",
	}, "dictionary.txt", zhLines)
	return service(sqlDB)
}

// headwords returns the first form (else first reading) of every
// candidate of m, in order.
func headwords(t *testing.T, sqlDB *sql.DB, m *segment.Match) []string {
	t.Helper()
	ids := make([]int64, len(m.Entries))
	for i, c := range m.Entries {
		ids[i] = c.ID
	}
	es, err := lexicon.Store{DB: sqlDB}.GetMany(context.Background(), ids)
	if err != nil {
		t.Fatalf("GetMany: %v", err)
	}
	byID := map[int64]lexicon.Entry{}
	for _, e := range es {
		byID[e.ID] = e
	}
	out := make([]string, len(ids))
	for i, id := range ids {
		e, ok := byID[id]
		switch {
		case !ok:
			t.Fatalf("candidate %d not in the lexicon", id)
		case len(e.Forms) > 0:
			out[i] = e.Forms[0].Text
		case len(e.Readings) > 0:
			out[i] = e.Readings[0].Value
		}
	}
	return out
}

func matchAt(t *testing.T, svc segment.Service, language, text string, offset int) *segment.Match {
	t.Helper()
	m, err := svc.MatchAt(context.Background(), language, text, offset)
	if err != nil {
		t.Fatalf("MatchAt(%s, %q, %d): %v", language, text, offset, err)
	}
	return m
}

// --- Chinese ---

func TestMatchAtLongestWord(t *testing.T) {
	m := matchAt(t, zhService(t), "zh", "我喜欢学习汉语", 3)
	if m == nil {
		t.Fatal("MatchAt = nil")
	}
	if m.Surface != "学习" || m.Start != 3 || m.End != 5 || m.Lemma != "学习" || m.Reason != "" {
		t.Errorf("match = %+v, want 学习 3..5", m)
	}
	if len(m.Entries) != 1 || m.Entries[0].Kind != "word" || m.Entries[0].ID == 0 || m.Entries[0].Reading {
		t.Errorf("entries = %+v, want one written word candidate", m.Entries)
	}
}

func TestMatchAtFallsBackToSingleChar(t *testing.T) {
	// 我喜 is not a word; 我 is a character.
	m := matchAt(t, zhService(t), "zh", "我喜", 0)
	if m == nil || m.Surface != "我" || m.Start != 0 || m.End != 1 {
		t.Fatalf("match = %+v, want 我 0..1", m)
	}
	if len(m.Entries) == 0 || m.Entries[0].Kind != "character" {
		t.Errorf("entries = %+v, want the character 我", m.Entries)
	}
}

func TestMatchAtNothing(t *testing.T) {
	svc := zhService(t)
	for _, text := range []string{"，", " ", "a", "7", "。我", "Hello"} {
		if m := matchAt(t, svc, "zh", text, 0); m != nil {
			t.Errorf("MatchAt(%q) = %+v, want nil", text, m)
		}
	}
}

func TestMatchAtAstral(t *testing.T) {
	m := matchAt(t, zhService(t), "zh", "a𠮷b", 1)
	if m == nil || m.Surface != "𠮷" || m.Start != 1 || m.End != 2 {
		t.Errorf("match = %+v, want 𠮷 1..2", m)
	}
	// Offsets after an astral rune are code points too.
	m = matchAt(t, zhService(t), "zh", "𠮷学习", 1)
	if m == nil || m.Surface != "学习" || m.Start != 1 || m.End != 3 {
		t.Errorf("match = %+v, want 学习 1..3", m)
	}
}

func TestMatchAtOffsetOutOfRange(t *testing.T) {
	svc := zhService(t)
	for _, off := range []int{-1, 2, 99} {
		if m := matchAt(t, svc, "zh", "我喜", off); m != nil {
			t.Errorf("offset %d = %+v, want nil", off, m)
		}
	}
}

func TestMatchAtTraditionalAndSimplified(t *testing.T) {
	svc := zhService(t)
	var ids []int64
	for _, w := range []string{"學習", "学习"} {
		m := matchAt(t, svc, "zh", w+"漢語", 0)
		if m == nil || m.Surface != w || m.Lemma != w || m.End != 2 || len(m.Entries) != 1 {
			t.Fatalf("MatchAt(%q) = %+v", w, m)
		}
		ids = append(ids, m.Entries[0].ID)
	}
	if ids[0] != ids[1] {
		t.Errorf("學習 and 学习 resolve to entries %v, want one entry", ids)
	}
}

func TestSegmentCoversChineseText(t *testing.T) {
	text := "我喜欢，学习 abc 汉语!"
	ms, err := zhService(t).Segment(context.Background(), "zh", text)
	if err != nil {
		t.Fatalf("Segment: %v", err)
	}
	want := []struct {
		s          string
		start, end int
	}{{"我", 0, 1}, {"喜欢", 1, 3}, {"学习", 4, 6}, {"汉语", 11, 13}}
	if len(ms) != len(want) {
		t.Fatalf("matches = %+v, want %d", ms, len(want))
	}
	for i, w := range want {
		if ms[i].Surface != w.s || ms[i].Start != w.start || ms[i].End != w.end {
			t.Errorf("match %d = %+v, want %+v", i, ms[i], w)
		}
	}
}

// --- Japanese ---

// jaWords is a small JMdict in the real file's shape.
var jaWords = []jw{
	{kanji: []string{"為る"}, readings: []string{"する"}, pos: []string{"vs-i", "vt"}, pri: []string{"ichi1"}, uk: true},
	{kanji: []string{"下"}, readings: []string{"した"}, pos: []string{"n"}, pri: []string{"ichi1", "news1", "nf05"}},
	{kanji: []string{"舌"}, readings: []string{"した"}, pos: []string{"n"}, pri: []string{"ichi1"}},
	{kanji: []string{"宿題"}, readings: []string{"しゅくだい"}, pos: []string{"n"}, pri: []string{"ichi1"}},
	{kanji: []string{"昨日"}, readings: []string{"きのう", "さくじつ"}, pos: []string{"n", "adv"}, pri: []string{"ichi1"}},
	{kanji: []string{"友達"}, readings: []string{"ともだち"}, pos: []string{"n"}, pri: []string{"ichi1"}},
	{kanji: []string{"電話"}, readings: []string{"でんわ"}, pos: []string{"n", "vs", "vi"}, pri: []string{"ichi1"}},
	{readings: []string{"を"}, pos: []string{"prt"}, pri: []string{"spec1"}},
	{readings: []string{"に"}, pos: []string{"prt"}, pri: []string{"spec1"}},
	{kanji: []string{"食べる"}, readings: []string{"たべる"}, pos: []string{"v1", "vt"}, pri: []string{"ichi1"}},
	{kanji: []string{"食"}, readings: []string{"しょく"}, pos: []string{"n"}},
	{kanji: []string{"話す"}, readings: []string{"はなす"}, pos: []string{"v5s", "vt"}, pri: []string{"ichi1"}},
	{kanji: []string{"話"}, readings: []string{"はなし"}, pos: []string{"n"}, pri: []string{"ichi1"}}, // no vs: never 話する
	{kanji: []string{"来る"}, readings: []string{"くる"}, pos: []string{"vk", "vi"}, pri: []string{"ichi1"}},
	{kanji: []string{"行く"}, readings: []string{"いく", "ゆく"}, pos: []string{"v5k-s", "vi"}, pri: []string{"ichi1"}},
	{kanji: []string{"事"}, readings: []string{"こと"}, pos: []string{"n"}, pri: []string{"ichi1", "news1", "nf01"}, uk: true},
	{kanji: []string{"琴"}, readings: []string{"こと"}, pos: []string{"n"}},
	{kanji: []string{"林檎"}, readings: []string{"りんご"}, pos: []string{"n"}, uk: true},
	{kanji: []string{"読む"}, readings: []string{"よむ"}, pos: []string{"v5m", "vt"}},
	{kanji: []string{"読まれる"}, readings: []string{"よまれる"}, pos: []string{"v1", "vi"}},
}

// jaFreq ranks する far above the nouns read した, as real frequency
// lists do.
const jaFreq = "為る,する,15\n下,した,600\n舌,した,5000\n"

func TestMatchAtJapaneseDeinflected(t *testing.T) {
	svc, sqlDB := jaService(t, jaWords, "")
	m := matchAt(t, svc, "ja", "昨日ケーキを食べた", 6)
	if m == nil || m.Surface != "食べた" || m.Lemma != "食べる" || m.Reason != "past" || m.Start != 6 || m.End != 9 {
		t.Fatalf("match = %+v, want 食べた -> 食べる past 6..9", m)
	}
	if got := headwords(t, sqlDB, m); strings.Join(got, ",") != "食べる" || m.Entries[0].Reading {
		t.Errorf("candidates = %v %+v, want the 食べる entry matched by its form", got, m.Entries)
	}
	// The exact dictionary form matches with no reason.
	if m := matchAt(t, svc, "ja", "食べる", 0); m == nil || m.Surface != "食べる" || m.Lemma != "食べる" || m.Reason != "" {
		t.Errorf("exact match = %+v", m)
	}
}

func TestMatchAtPartOfSpeechGating(t *testing.T) {
	svc, sqlDB := jaService(t, jaWords, "")
	// 話した is 話す (v5s) in the past; the noun 話 is no する verb, so
	// 話する is never offered.
	m := matchAt(t, svc, "ja", "話した", 0)
	if m == nil || m.Surface != "話した" || m.Lemma != "話す" || m.Reason != "past" {
		t.Fatalf("match = %+v, want 話した -> 話す (past)", m)
	}
	if got := headwords(t, sqlDB, m); strings.Join(got, ",") != "話す" {
		t.Errorf("candidates = %v, want only 話す", got)
	}
	// 電話 is a する noun: 電話した is one word, 電話する in the past.
	m = matchAt(t, svc, "ja", "電話した", 0)
	if m == nil || m.Surface != "電話した" || m.Lemma != "電話する" || m.Reason != "past" {
		t.Fatalf("match = %+v, want 電話した -> 電話する (past)", m)
	}
	if got := headwords(t, sqlDB, m); strings.Join(got, ",") != "電話" {
		t.Errorf("candidates = %v, want the noun 電話", got)
	}
}

func TestMatchAtExactBeatsDeinflected(t *testing.T) {
	// 食べた is itself an entry and also deinflects to 食べる.
	words := append([]jw{{kanji: []string{"食べた"}, readings: []string{"たべた"}, pos: []string{"n"}}}, jaWords...)
	svc, sqlDB := jaService(t, words, "")
	m := matchAt(t, svc, "ja", "食べた", 0)
	if m == nil || m.Surface != "食べた" || m.Lemma != "食べた" || m.Reason != "" {
		t.Fatalf("match = %+v, want exact 食べた with no reason", m)
	}
	// Both words cover the surface; the exact one ranks first.
	if got := headwords(t, sqlDB, m); strings.Join(got, ",") != "食べた,食べる" {
		t.Errorf("candidates = %v, want 食べた,食べる", got)
	}
}

func TestMatchAtPrefersShallowerDeinflection(t *testing.T) {
	// 読まれた -> 読まれる (past) and -> 読む (passive past).
	svc, sqlDB := jaService(t, jaWords, "")
	m := matchAt(t, svc, "ja", "読まれた", 0)
	if m == nil || m.Lemma != "読まれる" || m.Reason != "past" {
		t.Fatalf("match = %+v, want shallower 読まれる (past)", m)
	}
	if got := headwords(t, sqlDB, m); strings.Join(got, ",") != "読まれる,読む" {
		t.Errorf("candidates = %v, want 読まれる,読む", got)
	}
}

func TestMatchAtIrregularVerbs(t *testing.T) {
	svc, _ := jaService(t, jaWords, jaFreq)
	for _, c := range []struct{ text, lemma, reason string }{
		{"した", "する", "past"},
		{"しない", "する", "negative"},
		{"来ました", "来る", "polite past"},
		{"きて", "くる", "te-form"},
		{"行って", "行く", "te-form"},
	} {
		m := matchAt(t, svc, "ja", c.text, 0)
		if m == nil || m.Surface != c.text || m.Lemma != c.lemma || m.Reason != c.reason {
			t.Errorf("MatchAt(%q) = %+v, want %s (%s)", c.text, m, c.lemma, c.reason)
		}
	}
}

func TestMatchAtShitaFollowsFrequency(t *testing.T) {
	// With a frequency pack する outranks the nouns read した: the match is
	// the verb, and the nouns stay candidates of the same surface.
	svc, sqlDB := jaService(t, jaWords, jaFreq)
	m := matchAt(t, svc, "ja", "した", 0)
	if m == nil || m.Lemma != "する" || m.Reason != "past" {
		t.Fatalf("match = %+v, want する (past)", m)
	}
	if got := headwords(t, sqlDB, m); strings.Join(got, ",") != "為る,下,舌" {
		t.Errorf("candidates = %v, want 為る,下,舌", got)
	}
	for _, c := range m.Entries {
		if !c.Reading || c.Kind != "word" {
			t.Errorf("candidate %+v, want a word matched by reading", c)
		}
	}
	// Without frequency data kana fit decides the same way (issue #165):
	// 下 and 舌 are kanji words matched only by their reading.
	svc, _ = jaService(t, jaWords, "")
	if m := matchAt(t, svc, "ja", "した", 0); m == nil || m.Lemma != "する" || m.Reason != "past" {
		t.Errorf("no-frequency match = %+v, want する (past)", m)
	}
}

func TestMatchAtKanaByReading(t *testing.T) {
	svc, sqlDB := jaService(t, jaWords, "")
	m := matchAt(t, svc, "ja", "ことを", 0)
	if m == nil || m.Surface != "こと" || m.Lemma != "こと" || m.Start != 0 || m.End != 2 {
		t.Fatalf("match = %+v, want こと 0..2", m)
	}
	// 事 is usually kana and common.
	if got := headwords(t, sqlDB, m); strings.Join(got, ",") != "事,琴" {
		t.Errorf("こと candidates = %v, want 事,琴", got)
	}
	for _, c := range m.Entries {
		if !c.Reading {
			t.Errorf("candidate %+v, want reading=true", c)
		}
	}
	// Katakana folds to the hiragana reading.
	m = matchAt(t, svc, "ja", "リンゴを食べた", 0)
	if m == nil || m.Surface != "リンゴ" || strings.Join(headwords(t, sqlDB, m), ",") != "林檎" {
		t.Errorf("MatchAt(リンゴ) = %+v, want 林檎", m)
	}
}

func TestMatchAtReadingCandidatesCapped(t *testing.T) {
	var words []jw
	for _, k := range []string{"間", "感", "缶", "館", "巻", "官", "管", "簡", "観", "寒"} {
		words = append(words, jw{kanji: []string{k}, readings: []string{"かん"}, pos: []string{"n"}})
	}
	words[8].pri = []string{"news1"}                    // 観
	words[9].pri, words[9].uk = []string{"news2"}, true // 寒
	svc, sqlDB := jaService(t, words, "")
	m := matchAt(t, svc, "ja", "かん", 0)
	if m == nil {
		t.Fatal("MatchAt(かん) = nil")
	}
	got := headwords(t, sqlDB, m)
	if len(got) != segment.MaxReadingCandidates {
		t.Fatalf("candidates = %v, want %d", got, segment.MaxReadingCandidates)
	}
	// The cap applies after ranking: the usually-kana and common words
	// survive though they come last in the file.
	if got[0] != "寒" || got[1] != "観" {
		t.Errorf("candidates = %v, want 寒,観 first", got)
	}
}

func TestMatchAtReadingIsJapaneseOnly(t *testing.T) {
	svc, _ := jaService(t, jaWords, "")
	if m := matchAt(t, svc, "zh", "する", 0); m != nil {
		t.Errorf("MatchAt(zh, する) = %+v, want nil", m)
	}
}

// TestSegmentProgressive: している is one token (the progressive of する),
// not してい (指定) plus る. Lemma is the dictionary form, する; the
// entry is 為る. When 勉強 is a する noun (as in JMdict) the longest
// match is 勉強している, one token whose entry is 勉強.
func TestSegmentProgressive(t *testing.T) {
	words := append([]jw{
		{kanji: []string{"私"}, readings: []string{"わたし"}, pos: []string{"pn"}, pri: []string{"ichi1"}},
		{readings: []string{"は"}, pos: []string{"prt"}, pri: []string{"spec1"}},
		{kanji: []string{"毎日"}, readings: []string{"まいにち"}, pos: []string{"n", "adv"}, pri: []string{"ichi1"}},
		{kanji: []string{"指定"}, readings: []string{"してい"}, pos: []string{"n", "vs"}, pri: []string{"ichi1"}},
	}, jaWords...)
	for _, c := range []struct {
		name string
		vs   bool
		want []string // surface:lemma:reason:headword of the first entry
	}{
		{"study as a plain noun", false, []string{"私:私::私", "は:は::は", "毎日:毎日::毎日", "勉強:勉強::勉強", "している:する:te-form progressive:為る"}},
		{"study as a する noun", true, []string{"私:私::私", "は:は::は", "毎日:毎日::毎日", "勉強している:勉強する:te-form progressive:勉強"}},
	} {
		t.Run(c.name, func(t *testing.T) {
			pos := []string{"n"}
			if c.vs {
				pos = append(pos, "vs")
			}
			svc, sqlDB := jaService(t, append(words, jw{kanji: []string{"勉強"}, readings: []string{"べんきょう"}, pos: pos, pri: []string{"ichi1"}}), "")
			ms, err := svc.Segment(context.Background(), "ja", "私は毎日勉強している。")
			if err != nil {
				t.Fatalf("Segment: %v", err)
			}
			var got []string
			for i := range ms {
				m := &ms[i]
				got = append(got, m.Surface+":"+m.Lemma+":"+m.Reason+":"+headwords(t, sqlDB, m)[0])
			}
			if !slices.Equal(got, c.want) {
				t.Errorf("tokens = %q, want %q", got, c.want)
			}
		})
	}
}

func TestSegmentJapaneseSentence(t *testing.T) {
	svc, _ := jaService(t, jaWords, jaFreq)
	ms, err := svc.Segment(context.Background(), "ja", "宿題をした。昨日、友達に電話した。")
	if err != nil {
		t.Fatalf("Segment: %v", err)
	}
	want := []struct {
		surface, lemma, reason string
		start, end             int
	}{
		{"宿題", "宿題", "", 0, 2},
		{"を", "を", "", 2, 3},
		{"した", "する", "past", 3, 5},
		{"昨日", "昨日", "", 6, 8},
		{"友達", "友達", "", 9, 11},
		{"に", "に", "", 11, 12},
		{"電話した", "電話する", "past", 12, 16},
	}
	if len(ms) != len(want) {
		t.Fatalf("matches = %+v, want %d", ms, len(want))
	}
	for i, w := range want {
		m := ms[i]
		if m.Surface != w.surface || m.Lemma != w.lemma || m.Reason != w.reason || m.Start != w.start || m.End != w.end || len(m.Entries) == 0 {
			t.Errorf("match %d = %+v, want %+v", i, m, w)
		}
	}
}

// --- Readings ---

func TestSegmentReadingsOffByDefault(t *testing.T) {
	ms, err := zhService(t).Segment(context.Background(), "zh", "我学习")
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(ms)
	if strings.Contains(string(raw), `"reading"`) {
		t.Errorf("JSON without the option = %s, want no reading key", raw)
	}
}

func TestSegmentReadingsChinese(t *testing.T) {
	svc := zhService(t)
	svc.WithReadings = true
	ms, err := svc.Segment(context.Background(), "zh", "我学习")
	if err != nil || len(ms) != 2 {
		t.Fatalf("Segment = %+v, %v, want 2 matches", ms, err)
	}
	if r := ms[0].Reading; r == nil || r.Type != "pinyin" || r.Value != "wǒ" {
		t.Errorf("我 reading = %+v, want pinyin wǒ", r)
	}
	if r := ms[1].Reading; r == nil || r.Type != "pinyin" || r.Value != "xué xí" {
		t.Errorf("学习 reading = %+v, want pinyin xué xí", r)
	}
}

func TestSegmentReadingsJapanese(t *testing.T) {
	svc, _ := jaService(t, jaWords, "")
	svc.WithReadings = true
	ms, err := svc.Segment(context.Background(), "ja", "食べました")
	if err != nil || len(ms) == 0 {
		t.Fatalf("Segment = %+v, %v", ms, err)
	}
	if ms[0].Lemma != "食べる" || ms[0].Reading == nil || ms[0].Reading.Type != "kana" || ms[0].Reading.Value != "たべる" {
		t.Errorf("食べました = %+v, want lemma 食べる reading kana たべる", ms[0])
	}
	// A kana match by reading carries the matched reading, not another one.
	ms, err = svc.Segment(context.Background(), "ja", "さくじつ")
	if err != nil || len(ms) != 1 || ms[0].Reading == nil || ms[0].Reading.Value != "さくじつ" {
		t.Errorf("さくじつ = %+v, %v, want the matched reading さくじつ", ms, err)
	}
}

// TestSegmentStemOfCompound: a する compound found by its noun reports the
// noun as Stem (furigana aligns against it); other matches have none.
func TestSegmentStemOfCompound(t *testing.T) {
	words := append([]jw{{kanji: []string{"勉強"}, readings: []string{"べんきょう"}, pos: []string{"n", "vs"}, pri: []string{"ichi1"}}}, jaWords...)
	svc, _ := jaService(t, words, "")
	ms, err := svc.Segment(context.Background(), "ja", "勉強しています。食べた")
	if err != nil {
		t.Fatal(err)
	}
	if len(ms) != 2 || ms[0].Lemma != "勉強する" || ms[0].Stem != "勉強" || ms[1].Lemma != "食べる" || ms[1].Stem != "" {
		t.Errorf("matches = %+v, want 勉強しています (stem 勉強) and 食べた (no stem)", ms)
	}
}

// TestBoundaryWithAnExactHomographAfterTheParticle: without a frequency
// pack the usually-kana noun 仕手 (read して) ranks before する's te-form,
// yet をして still yields: some candidate of the match after the particle
// is an inflection of a word with priority.
func TestBoundaryWithAnExactHomographAfterTheParticle(t *testing.T) {
	words := append([]jw{
		{kanji: []string{"仕事"}, readings: []string{"しごと"}, pos: []string{"n", "vs"}, pri: []string{"ichi1"}},
		{readings: []string{"を"}, pos: []string{"prt"}, pri: []string{"spec1"}},
		{readings: []string{"をして"}, pos: []string{"exp"}},
		{kanji: []string{"仕手"}, readings: []string{"して"}, pos: []string{"n"}, pri: []string{"ichi1", "nf08"}, uk: true},
		{kanji: []string{"帰る"}, readings: []string{"かえる"}, pos: []string{"v5r", "vi"}, pri: []string{"ichi1"}},
	}, jaWords...)
	svc, _ := jaService(t, words, "")
	ms, err := svc.Segment(context.Background(), "ja", "仕事をして帰った")
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, m := range ms {
		got = append(got, m.Surface)
	}
	if want := []string{"仕事", "を", "して", "帰った"}; !slices.Equal(got, want) {
		t.Errorf("tokens = %q, want %q", got, want)
	}
}

// TestBoundaryKeepsAnExpressionOverAWeakInflection: かねない stays one
// token: the inflection after か (ねない of 寝る) is reached only through
// the kana reading of a word written in kanji, too weak to split it.
func TestBoundaryKeepsAnExpressionOverAWeakInflection(t *testing.T) {
	words := append([]jw{
		{readings: []string{"か"}, pos: []string{"prt"}, pri: []string{"spec1"}},
		{readings: []string{"かねない"}, pos: []string{"exp"}},
		{kanji: []string{"寝る"}, readings: []string{"ねる"}, pos: []string{"v1", "vi"}, pri: []string{"ichi1"}},
	}, jaWords...)
	svc, _ := jaService(t, words, "")
	ms, err := svc.Segment(context.Background(), "ja", "かねない")
	if err != nil {
		t.Fatal(err)
	}
	if len(ms) != 1 || ms[0].Surface != "かねない" {
		t.Errorf("matches = %+v, want the expression かねない", ms)
	}
}
