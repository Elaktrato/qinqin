package lookup_test

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

// jaWords is a small JMdict: the words the ranking tests look up, with
// realistic part-of-speech, uk and priority markup.
const jaWords = `<entry>
<ent_seq>1157170</ent_seq>
<k_ele><keb>為る</keb><ke_inf>&rK;</ke_inf></k_ele>
<k_ele><keb>爲る</keb><ke_inf>&oK;</ke_inf></k_ele>
<r_ele><reb>する</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&vs-i;</pos><pos>&vt;</pos><misc>&uk;</misc><gloss>to do</gloss></sense>
</entry>
<entry>
<ent_seq>1567440</ent_seq>
<k_ele><keb>掏る</keb></k_ele>
<r_ele><reb>する</reb></r_ele>
<r_ele><reb>スる</reb></r_ele>
<sense><pos>&v5r;</pos><pos>&vt;</pos><misc>&uk;</misc><gloss>to pickpocket</gloss></sense>
</entry>
<entry>
<ent_seq>1009850</ent_seq>
<k_ele><keb>下</keb><ke_pri>ichi1</ke_pri><ke_pri>news1</ke_pri><ke_pri>nf05</ke_pri></k_ele>
<r_ele><reb>した</reb><re_pri>ichi1</re_pri><re_pri>news1</re_pri><re_pri>nf05</re_pri></r_ele>
<sense><pos>&n;</pos><gloss>below</gloss></sense>
</entry>
<entry>
<ent_seq>1374350</ent_seq>
<k_ele><keb>舌</keb><ke_pri>ichi1</ke_pri></k_ele>
<r_ele><reb>した</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&n;</pos><gloss>tongue</gloss></sense>
</entry>
<entry>
<ent_seq>1343810</ent_seq>
<k_ele><keb>宿題</keb><ke_pri>ichi1</ke_pri></k_ele>
<r_ele><reb>しゅくだい</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&n;</pos><gloss>homework</gloss></sense>
</entry>
<entry>
<ent_seq>1512330</ent_seq>
<k_ele><keb>勉強</keb><ke_pri>ichi1</ke_pri></k_ele>
<r_ele><reb>べんきょう</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&n;</pos><pos>&vs;</pos><pos>&vt;</pos><gloss>study</gloss></sense>
</entry>
<entry>
<ent_seq>1580840</ent_seq>
<k_ele><keb>話す</keb><ke_pri>ichi1</ke_pri></k_ele>
<r_ele><reb>はなす</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&v5s;</pos><pos>&vt;</pos><gloss>to talk</gloss></sense>
</entry>
<entry>
<ent_seq>1577980</ent_seq>
<k_ele><keb>居る</keb><ke_inf>&rK;</ke_inf></k_ele>
<r_ele><reb>いる</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&v1;</pos><pos>&vi;</pos><misc>&uk;</misc><gloss>to be</gloss></sense>
</entry>
<entry>
<ent_seq>1546640</ent_seq>
<k_ele><keb>要る</keb><ke_pri>news1</ke_pri><ke_pri>nf20</ke_pri></k_ele>
<r_ele><reb>いる</reb><re_pri>news1</re_pri><re_pri>nf20</re_pri></r_ele>
<sense><pos>&v5r;</pos><pos>&vi;</pos><gloss>to need</gloss></sense>
</entry>
<entry>
<ent_seq>1314590</ent_seq>
<k_ele><keb>射る</keb></k_ele>
<r_ele><reb>いる</reb></r_ele>
<sense><pos>&v1;</pos><pos>&vt;</pos><gloss>to shoot</gloss></sense>
</entry>
<entry>
<ent_seq>1313580</ent_seq>
<k_ele><keb>事</keb><ke_pri>ichi1</ke_pri><ke_pri>news1</ke_pri><ke_pri>nf01</ke_pri></k_ele>
<r_ele><reb>こと</reb><re_pri>ichi1</re_pri><re_pri>news1</re_pri><re_pri>nf01</re_pri></r_ele>
<sense><pos>&n;</pos><misc>&uk;</misc><gloss>thing</gloss></sense>
</entry>
<entry>
<ent_seq>1243400</ent_seq>
<k_ele><keb>琴</keb></k_ele>
<r_ele><reb>こと</reb></r_ele>
<sense><pos>&n;</pos><gloss>koto (Japanese zither)</gloss></sense>
</entry>
<entry>
<ent_seq>1592970</ent_seq>
<k_ele><keb>古都</keb><ke_pri>news2</ke_pri><ke_pri>nf40</ke_pri></k_ele>
<r_ele><reb>こと</reb><re_pri>news2</re_pri><re_pri>nf40</re_pri></r_ele>
<sense><pos>&n;</pos><gloss>ancient city</gloss></sense>
</entry>
<entry>
<ent_seq>1296400</ent_seq>
<k_ele><keb>有る</keb><ke_pri>ichi1</ke_pri></k_ele>
<k_ele><keb>在る</keb><ke_pri>ichi1</ke_pri></k_ele>
<r_ele><reb>ある</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&v5r-i;</pos><pos>&vi;</pos><misc>&uk;</misc><gloss>to be</gloss></sense>
</entry>
<entry>
<ent_seq>1586840</ent_seq>
<k_ele><keb>或る</keb><ke_pri>ichi1</ke_pri><ke_pri>nf10</ke_pri></k_ele>
<r_ele><reb>ある</reb><re_pri>ichi1</re_pri><re_pri>nf10</re_pri></r_ele>
<sense><pos>&adj-pn;</pos><misc>&uk;</misc><gloss>a certain</gloss></sense>
</entry>
`

// hanashi is the noun 話, as a plain noun or (withVs) also a する verb.
func hanashi(withVs bool) string {
	pos := "<pos>&n;</pos>"
	if withVs {
		pos += "<pos>&vs;</pos>"
	}
	return `<entry>
<ent_seq>1580850</ent_seq>
<k_ele><keb>話</keb><ke_pri>ichi1</ke_pri></k_ele>
<r_ele><reb>はなし</reb><re_pri>ichi1</re_pri></r_ele>
<sense>` + pos + `<gloss>talk</gloss></sense>
</entry>
`
}

// homophones is 40 nouns read こう, for the result cap.
func homophones() string {
	var b strings.Builder
	for i := 0; i < 40; i++ {
		fmt.Fprintf(&b, "<entry>\n<ent_seq>%d</ent_seq>\n<k_ele><keb>%c</keb></k_ele>\n<r_ele><reb>こう</reb></r_ele>\n<sense><pos>&n;</pos><gloss>kou %d</gloss></sense>\n</entry>\n", 2900000+i, rune(0x5400+i), i)
	}
	return b.String()
}

// zhLines is CC-CEDICT: traditional, simplified, [pinyin], /glosses/.
const zhLines = `學習 学习 [xue2 xi2] /to learn/to study/
學 学 [xue2] /to learn/
習 习 [xi2] /to practice/
行 行 [xing2] /to walk/to go/
行 行 [hang2] /row/line/
好 好 [hao3] /good/
好 好 [hao4] /to be fond of/
好人 好人 [hao3 ren2] /good person/
你 你 [ni3] /you/
你好 你好 [ni3 hao3] /hello/
`

// jaFreq is a frequency pack in Jiten's shape: term, reading, rank.
const jaFreq = `為る,する,15
下,した,600
舌,した,5000
事,こと,30
琴,こと,9000
古都,こと,20000
有る,ある,20
或る,ある,1200
`

func openDB(t *testing.T) (*sql.DB, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "qinqin.db")
	sqlDB, err := db.Open(path)
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	return sqlDB, path
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

func importJMdict(t *testing.T, sqlDB *sql.DB, entries string) {
	t.Helper()
	importPack(t, sqlDB, dict.Manifest{
		ID: "jmdict-test", Name: "JMdict test", Version: "1", Type: "dictionary", Language: "ja",
		License: "CC BY-SA 4.0", Attribution: "EDRDG", Format: "jmdict",
	}, "jmdict.xml", jmdictHead+entries+"</JMdict>\n")
}

func importCedict(t *testing.T, sqlDB *sql.DB) {
	t.Helper()
	importPack(t, sqlDB, dict.Manifest{
		ID: "cedict-test", Name: "CC-CEDICT test", Version: "1", Type: "dictionary", Language: "zh",
		License: "CC BY-SA 4.0", Attribution: "CC-CEDICT", Format: "cedict",
	}, "dictionary.txt", zhLines)
}

func importJaFreq(t *testing.T, sqlDB *sql.DB) {
	t.Helper()
	importPack(t, sqlDB, dict.Manifest{
		ID: "freq-test", Name: "Freq test", Version: "1", Type: "frequency", Language: "ja",
		License: "CC BY-SA 4.0", Attribution: "test", Format: "freq-csv",
	}, "freq.csv", "term,reading,rank\n"+jaFreq)
}

func service(sqlDB *sql.DB) lookup.Service {
	return lookup.Service{Lexicon: lexicon.Store{DB: sqlDB}, Freq: freq.Store{DB: sqlDB}, DB: sqlDB}
}

// jaService seeds the Japanese words, plus the frequency pack when
// withFreq.
func jaService(t *testing.T, withFreq bool) lookup.Service {
	t.Helper()
	sqlDB, _ := openDB(t)
	importJMdict(t, sqlDB, jaWords+hanashi(false))
	if withFreq {
		importJaFreq(t, sqlDB)
	}
	return service(sqlDB)
}

func run(t *testing.T, s lookup.Service, language, text string, offset int, kinds ...string) []lookup.Result {
	t.Helper()
	got, err := s.Lookup(context.Background(), language, text, offset, kinds)
	if err != nil {
		t.Fatalf("Lookup(%s, %q, %d): %v", language, text, offset, err)
	}
	if got == nil {
		t.Fatalf("Lookup(%s, %q, %d) = nil, want a non-nil slice", language, text, offset)
	}
	return got
}

// terms lists "Term[reasons]" of each result, e.g. 為る[past].
func terms(rs []lookup.Result) []string {
	out := make([]string, len(rs))
	for i, r := range rs {
		out[i] = r.Term
		if len(r.Reasons) > 0 {
			out[i] += "[" + strings.Join(r.Reasons, " ") + "]"
		}
	}
	return out
}

func find(rs []lookup.Result, term string) *lookup.Result {
	for i := range rs {
		if rs[i].Term == term {
			return &rs[i]
		}
	}
	return nil
}

func wantPrefix(t *testing.T, rs []lookup.Result, want ...string) {
	t.Helper()
	got := terms(rs)
	if len(got) < len(want) || !slices.Equal(got[:len(want)], want) {
		t.Fatalf("results = %v, want them to start with %v", got, want)
	}
}

func TestShitaWithFrequencyRanksSuruFirst(t *testing.T) {
	rs := run(t, jaService(t, true), "ja", "宿題をした", 3)
	wantPrefix(t, rs, "為る[past]", "下", "舌")
	suru := rs[0]
	if suru.Matched != "した" || suru.Start != 3 || suru.End != 5 || suru.Reading != "する" {
		t.Errorf("為る matched %q [%d,%d) reading %q, want した [3,5) する", suru.Matched, suru.Start, suru.End, suru.Reading)
	}
	if !slices.Contains(suru.Tags, "usually kana") {
		t.Errorf("為る tags = %v, want usually kana", suru.Tags)
	}
	if len(suru.Frequencies) != 1 || suru.Frequencies[0].Rank != 15 || suru.Frequencies[0].PackName != "Freq test" {
		t.Errorf("為る frequencies = %+v, want one: Freq test rank 15", suru.Frequencies)
	}
	if len(suru.Senses) != 1 || suru.Senses[0].DictionaryName != "JMdict test" ||
		!slices.Equal(suru.Senses[0].POS, []string{"vs-i", "vt"}) || !slices.Equal(suru.Senses[0].Glosses, []string{"to do"}) {
		t.Errorf("為る senses = %+v", suru.Senses)
	}
	if shita := rs[1]; shita.Reading != "した" || len(shita.Reasons) != 0 || slices.Contains(shita.Tags, "usually kana") {
		t.Errorf("下 = %+v, want reading した, no reasons, not usually kana", shita)
	}
}

func TestShitaWithoutFrequencyRanksExactFirst(t *testing.T) {
	rs := run(t, jaService(t, false), "ja", "宿題をした", 3)
	wantPrefix(t, rs, "下", "舌", "為る[past]")
	for _, r := range rs {
		if len(r.Frequencies) != 0 {
			t.Errorf("%s frequencies = %+v, want none", r.Term, r.Frequencies)
		}
	}
}

func TestSuffixSuruFindsTheNoun(t *testing.T) {
	rs := run(t, jaService(t, false), "ja", "勉強した", 0)
	wantPrefix(t, rs, "勉強[past]")
	if r := rs[0]; r.Matched != "勉強した" || r.End != 4 || r.Reading != "べんきょう" {
		t.Errorf("勉強 matched %q end %d reading %q, want 勉強した 4 べんきょう", r.Matched, r.End, r.Reading)
	}
	if len(rs) != 1 {
		t.Errorf("results = %v, want only 勉強 (one result per entry)", terms(rs))
	}
}

func TestHanashitaOffersTheNounOnlyAsSuruVerb(t *testing.T) {
	t.Run("noun without vs", func(t *testing.T) {
		rs := run(t, jaService(t, false), "ja", "話した", 0)
		if want := []string{"話す[past]", "話"}; !slices.Equal(terms(rs), want) {
			t.Errorf("results = %v, want %v", terms(rs), want)
		}
		if r := find(rs, "話"); r == nil || r.Matched != "話" {
			t.Errorf("話 = %+v, want matched only as 話", r)
		}
	})
	t.Run("noun with vs", func(t *testing.T) {
		sqlDB, _ := openDB(t)
		importJMdict(t, sqlDB, jaWords+hanashi(true))
		rs := run(t, service(sqlDB), "ja", "話した", 0)
		r := find(rs, "話")
		if r == nil || r.Matched != "話した" || !slices.Equal(r.Reasons, []string{"past"}) {
			t.Errorf("話 = %+v, want matched 話した as past", r)
		}
		if find(rs, "話す") == nil {
			t.Errorf("results = %v, want 話す too", terms(rs))
		}
	})
}

func TestIruPrefersUsuallyKanaWord(t *testing.T) {
	rs := run(t, jaService(t, false), "ja", "いる", 0)
	wantPrefix(t, rs, "居る", "要る", "射る")
	if rs[0].Reading != "いる" || rs[0].Matched != "いる" {
		t.Errorf("居る reading %q matched %q", rs[0].Reading, rs[0].Matched)
	}
}

func TestExactMatchesCountReadingsOnce(t *testing.T) {
	// 掏る reads する and スる: one reading in two scripts, not two exact
	// matches, so the usually-kana score decides.
	rs := run(t, jaService(t, false), "ja", "する", 0)
	wantPrefix(t, rs, "為る", "掏る")
}

func TestKotoAndAruOrder(t *testing.T) {
	tests := []struct {
		text     string
		withFreq bool
		want     []string
	}{
		{"こと", false, []string{"事", "古都", "琴"}},
		{"こと", true, []string{"事", "琴", "古都"}},
		{"ある", false, []string{"或る", "有る"}},
		{"ある", true, []string{"有る", "或る"}},
	}
	for _, tt := range tests {
		t.Run(fmt.Sprintf("%s freq=%v", tt.text, tt.withFreq), func(t *testing.T) {
			rs := run(t, jaService(t, tt.withFreq), "ja", tt.text, 0)
			if !slices.Equal(terms(rs), tt.want) {
				t.Errorf("results = %v, want %v", terms(rs), tt.want)
			}
		})
	}
}

// unihanLines gives the traditional 學 a character entry of its own, as
// the real Unihan import does.
const unihanLines = "U+5B78\tkDefinition\tlearning, knowledge; school\n"

// zhService seeds CC-CEDICT, then Unihan.
func zhService(t *testing.T) lookup.Service {
	t.Helper()
	sqlDB, _ := openDB(t)
	importCedict(t, sqlDB)
	importPack(t, sqlDB, dict.Manifest{
		ID: "unihan", Name: "Unihan", Version: "1", Type: "dictionary", Language: "zh",
		License: "Unicode License v3", Attribution: "Unicode", Format: "unihan",
	}, "dictionary.txt", unihanLines)
	return service(sqlDB)
}

func TestChineseTraditionalFindsSimplified(t *testing.T) {
	rs := run(t, zhService(t), "zh", "學習", 0)
	// A traditional form is the headword in traditional script: 学习
	// matches it as a primary match, so its length decides, not the
	// single character 學 whose first form the text happens to be.
	wantPrefix(t, rs, "学习", "学", "學")
	if r := rs[0]; r.Matched != "學習" || r.End != 2 || r.Reading != "xué xí" || r.Kind != "word" {
		t.Errorf("学习 = matched %q end %d reading %q kind %s", r.Matched, r.End, r.Reading, r.Kind)
	}
	if r := rs[1]; r.Matched != "學" || r.Kind != "character" {
		t.Errorf("学 = matched %q kind %s", r.Matched, r.Kind)
	}
}

func TestChineseOneResultWithAllReadings(t *testing.T) {
	rs := run(t, zhService(t), "zh", "行", 0)
	if len(rs) != 1 {
		t.Fatalf("results = %v, want one", terms(rs))
	}
	var pinyin []string
	for _, r := range rs[0].Readings {
		if r.Type == "pinyin" {
			pinyin = append(pinyin, r.Value)
		}
	}
	if want := []string{"xíng", "háng"}; !slices.Equal(pinyin, want) {
		t.Errorf("行 pinyin = %v, want %v", pinyin, want)
	}
	if len(rs[0].Senses) != 2 || rs[0].Senses[0].DictionaryName != "CC-CEDICT test" {
		t.Errorf("行 senses = %+v, want two CC-CEDICT test senses", rs[0].Senses)
	}
}

func TestLongestMatchFirst(t *testing.T) {
	rs := run(t, zhService(t), "zh", "你好吗", 0)
	if want := []string{"你好", "你"}; !slices.Equal(terms(rs), want) {
		t.Errorf("results = %v, want %v", terms(rs), want)
	}
}

func TestKindsFilter(t *testing.T) {
	s := zhService(t)
	rs := run(t, s, "zh", "好人", 0, "character")
	if len(rs) != 1 || rs[0].Term != "好" || rs[0].Kind != "character" {
		t.Errorf("character results = %+v, want only 好", terms(rs))
	}
	if rs := run(t, s, "zh", "好人", 0, "word"); !slices.Equal(terms(rs), []string{"好人"}) {
		t.Errorf("word results = %v, want [好人]", terms(rs))
	}
	if rs := run(t, s, "zh", "好人", 0); !slices.Equal(terms(rs), []string{"好人", "好"}) {
		t.Errorf("all results = %v, want [好人 好]", terms(rs))
	}
}

func TestResultsCapped(t *testing.T) {
	sqlDB, _ := openDB(t)
	importJMdict(t, sqlDB, homophones())
	rs := run(t, service(sqlDB), "ja", "こう", 0)
	if len(rs) != lookup.MaxEntries {
		t.Errorf("results = %d, want %d", len(rs), lookup.MaxEntries)
	}
	// All tie up to the headword: the lowest code points survive the cap.
	if rs[0].Term != string(rune(0x5400)) || rs[29].Term != string(rune(0x5400+29)) {
		t.Errorf("first/last = %s/%s", rs[0].Term, rs[29].Term)
	}
}

func TestNothingToLookUp(t *testing.T) {
	ja, zh := jaService(t, true), zhService(t)
	tests := []struct {
		s              lookup.Service
		language, text string
		offset         int
	}{
		{ja, "ja", "abc した", 0},
		{ja, "ja", "123", 0},
		{ja, "ja", "。した", 0},
		{zh, "zh", "ok 好", 1},
		{zh, "zh", "，好", 0},
		{ja, "ja", "した", 2},
		{ja, "ja", "した", 99},
		{ja, "ja", "した", -1},
		{ja, "ja", "", 0},
	}
	for _, tt := range tests {
		if rs := run(t, tt.s, tt.language, tt.text, tt.offset); len(rs) != 0 {
			t.Errorf("Lookup(%s, %q, %d) = %v, want none", tt.language, tt.text, tt.offset, terms(rs))
		}
	}
}

func TestOffsetsAreCodePoints(t *testing.T) {
	// 𠀋 is astral (two UTF-16 units, four UTF-8 bytes): offsets count it once.
	rs := run(t, zhService(t), "zh", "𠀋你好", 1)
	if len(rs) == 0 || rs[0].Term != "你好" || rs[0].Start != 1 || rs[0].End != 3 {
		t.Errorf("results = %+v, want 你好 at [1,3)", rs)
	}
}

func TestShortWindowAtEndOfText(t *testing.T) {
	rs := run(t, jaService(t, false), "ja", "宿題", 1)
	if len(rs) != 0 {
		t.Errorf("results = %v, want none for 題 alone", terms(rs))
	}
	rs = run(t, jaService(t, false), "ja", "宿題", 0)
	if !slices.Equal(terms(rs), []string{"宿題"}) {
		t.Errorf("results = %v, want [宿題]", terms(rs))
	}
}
