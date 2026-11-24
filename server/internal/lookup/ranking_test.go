package lookup_test

import (
	"context"
	"database/sql"
	"slices"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/lookup"
	"qinqin/internal/pack"
)

// altWords are words found by an alternative form or reading, and 生's
// homographs: the regressions of matching length before primary match.
const altWords = `<entry>
<ent_seq>1307770</ent_seq>
<k_ele><keb>子供</keb><ke_pri>ichi1</ke_pri></k_ele>
<k_ele><keb>子ども</keb><ke_pri>news1</ke_pri></k_ele>
<r_ele><reb>こども</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&n;</pos><gloss>child</gloss></sense>
</entry>
<entry>
<ent_seq>1307730</ent_seq>
<k_ele><keb>子</keb><ke_pri>ichi1</ke_pri><ke_pri>news1</ke_pri><ke_pri>nf01</ke_pri></k_ele>
<r_ele><reb>こ</reb><re_pri>ichi1</re_pri><re_pri>news1</re_pri><re_pri>nf01</re_pri></r_ele>
<sense><pos>&n;</pos><gloss>child</gloss></sense>
</entry>
<entry>
<ent_seq>1606560</ent_seq>
<k_ele><keb>分かる</keb><ke_pri>ichi1</ke_pri></k_ele>
<k_ele><keb>解る</keb></k_ele>
<k_ele><keb>判る</keb></k_ele>
<r_ele><reb>わかる</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&v5r;</pos><pos>&vi;</pos><gloss>to understand</gloss></sense>
</entry>
<entry>
<ent_seq>1199640</ent_seq>
<k_ele><keb>解</keb><ke_pri>news1</ke_pri><ke_pri>nf01</ke_pri></k_ele>
<r_ele><reb>かい</reb><re_pri>news1</re_pri><re_pri>nf01</re_pri></r_ele>
<sense><pos>&n;</pos><gloss>solution</gloss></sense>
</entry>
<entry>
<ent_seq>1578850</ent_seq>
<k_ele><keb>行く</keb><ke_pri>ichi1</ke_pri></k_ele>
<k_ele><keb>往く</keb></k_ele>
<r_ele><reb>いく</reb><re_pri>ichi1</re_pri></r_ele>
<r_ele><reb>ゆく</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&v5k-s;</pos><pos>&vi;</pos><gloss>to go</gloss></sense>
</entry>
<entry>
<ent_seq>1554850</ent_seq>
<k_ele><keb>湯</keb><ke_pri>ichi1</ke_pri><ke_pri>news1</ke_pri><ke_pri>nf01</ke_pri></k_ele>
<r_ele><reb>ゆ</reb><re_pri>ichi1</re_pri><re_pri>news1</re_pri><re_pri>nf01</re_pri></r_ele>
<sense><pos>&n;</pos><gloss>hot water</gloss></sense>
</entry>
<entry>
<ent_seq>1310490</ent_seq>
<k_ele><keb>刷る</keb><ke_pri>ichi1</ke_pri></k_ele>
<r_ele><reb>する</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&v5r;</pos><pos>&vt;</pos><gloss>to print</gloss></sense>
</entry>
<entry>
<ent_seq>1421850</ent_seq>
<k_ele><keb>生</keb><ke_pri>ichi1</ke_pri></k_ele>
<r_ele><reb>なま</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&n;</pos><gloss>raw</gloss></sense>
</entry>
<entry>
<ent_seq>1421860</ent_seq>
<k_ele><keb>生</keb></k_ele>
<r_ele><reb>せい</reb></r_ele>
<sense><pos>&n;</pos><gloss>life</gloss></sense>
</entry>
<entry>
<ent_seq>1421870</ent_seq>
<k_ele><keb>生</keb></k_ele>
<r_ele><reb>き</reb></r_ele>
<sense><pos>&n;</pos><gloss>pure</gloss></sense>
</entry>
`

// kanjidic is a KANJIDIC2 with the kanji the tests meet as characters.
var kanjidic = `<?xml version="1.0" encoding="UTF-8"?>
<kanjidic2>
<header><file_version>4</file_version><database_version>2026-111</database_version><date_of_creation>2026-11-10</date_of_creation></header>
` + kanji("子", "シ", "こ", "child") + kanji("解", "カイ", "と.く", "unravel") + kanji("下", "カ", "した", "below") + kanji("生", "セイ", "なま", "life") + `</kanjidic2>
`

func kanji(literal, on, kun, meaning string) string {
	return `<character>
<literal>` + literal + `</literal>
<codepoint><cp_value cp_type="ucs">0</cp_value></codepoint>
<radical><rad_value rad_type="classical">1</rad_value></radical>
<misc><grade>1</grade><stroke_count>3</stroke_count><freq>10</freq></misc>
<reading_meaning><rmgroup>
<reading r_type="ja_on">` + on + `</reading>
<reading r_type="ja_kun">` + kun + `</reading>
<meaning>` + meaning + `</meaning>
</rmgroup></reading_meaning>
</character>
`
}

func importKanjidic(t *testing.T, sqlDB *sql.DB) {
	t.Helper()
	importPack(t, sqlDB, pack.Manifest{
		ID: "kanjidic2-test", Name: "KANJIDIC2 test", Version: "1", Type: "dictionary", Language: "ja",
		License: "CC BY-SA 4.0", Attribution: "EDRDG", Format: "kanjidic2",
	}, "kanjidic2.xml", kanjidic)
}

func importFreqPack(t *testing.T, sqlDB *sql.DB, id, rows string) {
	t.Helper()
	importPack(t, sqlDB, pack.Manifest{
		ID: id, Name: "Freq " + id, Version: "1", Type: "frequency", Language: "ja",
		License: "CC BY-SA 4.0", Attribution: "test", Format: "freq-csv",
	}, "freq.csv", "term,reading,rank\n"+rows)
}

// altService seeds the base words, the alternative-form words and
// KANJIDIC; freqPacks are imported in order (id, rows pairs).
func altService(t *testing.T, freqPacks ...string) (lookup.Service, *sql.DB) {
	t.Helper()
	sqlDB := dbtest.Open(t)
	importJMdict(t, sqlDB, jaWords+altWords)
	importKanjidic(t, sqlDB)
	for i := 0; i+1 < len(freqPacks); i += 2 {
		importFreqPack(t, sqlDB, freqPacks[i], freqPacks[i+1])
	}
	return service(sqlDB), sqlDB
}

// headwords lists each result's first form (or Term without forms) and kind.
func headwords(rs []lookup.Result) []string {
	out := make([]string, len(rs))
	for i, r := range rs {
		h := r.Term
		if len(r.Forms) > 0 {
			h = r.Forms[0].Text
		}
		out[i] = h + "/" + r.Kind
	}
	return out
}

func TestLongerAlternativeFormBeatsPrimaryShortMatch(t *testing.T) {
	s, _ := altService(t)
	tests := []struct {
		text string
		want []string // first results by headword/kind
		term string   // Term of the first result
	}{
		{"子ども", []string{"子供/word", "子/word", "子/character"}, "子ども"},
		{"解る", []string{"分かる/word", "解/word", "解/character"}, "解る"},
		{"解った", []string{"分かる/word", "解/word", "解/character"}, "解る"},
		{"ゆく", []string{"行く/word", "湯/word"}, "行く"},
	}
	for _, tt := range tests {
		rs := run(t, s, "ja", tt.text, 0)
		if got := headwords(rs); !slices.Equal(got, tt.want) {
			t.Errorf("%s: results = %v, want %v", tt.text, got, tt.want)
			continue
		}
		if rs[0].Term != tt.term || rs[0].Matched != tt.text {
			t.Errorf("%s: first Term %q matched %q, want %q matched %q", tt.text, rs[0].Term, rs[0].Matched, tt.term, tt.text)
		}
	}
	if rs := run(t, s, "ja", "解った", 0); !slices.Equal(rs[0].Reasons, []string{"past"}) {
		t.Errorf("解った reasons = %v, want [past]", rs[0].Reasons)
	}
}

func TestJapaneseCharactersTakeNoFrequency(t *testing.T) {
	// KANJIDIC 下 has the kun reading した, which the word row matches.
	s, _ := altService(t, "a", "下,した,600\n下,,700\n")
	rs := run(t, s, "ja", "下", 0)
	if got := headwords(rs); !slices.Equal(got, []string{"下/word", "下/character"}) {
		t.Fatalf("results = %v, want the word, then the character", got)
	}
	if f := rs[0].Frequencies; len(f) != 1 || f[0].Rank != 600 {
		t.Errorf("下 word frequencies = %+v, want rank 600", f)
	}
	if f := rs[1].Frequencies; len(f) != 0 {
		t.Errorf("下 character frequencies = %+v, want none", f)
	}
}

func TestUsuallyKanaWordsUseTheirKanaAsFrequencyTerm(t *testing.T) {
	s, _ := altService(t, "a", "する,する,15\n")
	rs := run(t, s, "ja", "する", 0)
	byKey := map[string]lookup.Result{}
	for _, r := range rs {
		byKey[r.Forms[0].Text] = r
	}
	if f := byKey["為る"].Frequencies; len(f) != 1 || f[0].Rank != 15 {
		t.Errorf("為る (uk) frequencies = %+v, want rank 15 via the kana term", f)
	}
	if f := byKey["刷る"].Frequencies; len(f) != 0 {
		t.Errorf("刷る (not uk) frequencies = %+v, want none", f)
	}
	if rs[0].Forms[0].Text != "為る" {
		t.Errorf("first = %s, want 為る ranked by its frequency", rs[0].Forms[0].Text)
	}
}

// In Jiten's keying a kana spelling has its own row (する, no reading)
// besides the rows of each word's kanji form, so one kana row is shared
// by every usually-kana homophone. A word's own kanji-form row wins: the
// kana row applies only when the pack has nothing for its forms.
func TestKanaTermOnlyWhenTheFormsHaveNoHit(t *testing.T) {
	s, _ := altService(t, "a", "する,,10\n為る,する,10\n刷る,する,33725\n掏る,する,104634\n",
		"b", "する,,7\n為る,する,900\n")
	rs := run(t, s, "ja", "する", 0)
	want := map[string][]int{"為る": {10, 900}, "刷る": {33725}, "掏る": {104634, 7}}
	for _, r := range rs {
		var ranks []int
		for _, f := range r.Frequencies {
			ranks = append(ranks, f.Rank)
		}
		if w, ok := want[r.Forms[0].Text]; ok && !slices.Equal(ranks, w) {
			t.Errorf("%s frequencies = %v, want %v", r.Forms[0].Text, ranks, w)
		}
	}
	if got := headwords(rs); !slices.Equal(got[:3], []string{"為る/word", "刷る/word", "掏る/word"}) {
		t.Errorf("results = %v, want 為る, 刷る, 掏る by their own forms' ranks", got)
	}
}

func TestFirstPackWithAnyDataRanks(t *testing.T) {
	// Pack a has data for 舌 only; pack b for all three. Pack a ranks:
	// 舌 first, the rest fall through to kana fit (為る, usually kana,
	// before 下, a kanji word matched by its reading; issue #165).
	s, _ := altService(t, "a", "舌,した,100\n", "b", "為る,する,15\n下,した,600\n舌,した,5000\n")
	rs := run(t, s, "ja", "宿題をした", 3)
	wantPrefix(t, rs, "舌", "為る[past]", "下")
	want := map[string][]int{"舌": {100, 5000}, "下": {600}, "為る": {15}}
	for _, r := range rs[:3] {
		var ranks []int
		for _, f := range r.Frequencies {
			ranks = append(ranks, f.Rank)
		}
		if !slices.Equal(ranks, want[label(r)]) {
			t.Errorf("%s frequencies = %v, want %v", label(r), ranks, want[label(r)])
		}
	}
}

func TestFrequencyFailureDegrades(t *testing.T) {
	s, sqlDB := altService(t, "a", "為る,する,15\n")
	if _, err := sqlDB.Exec(`DROP TABLE frequency`); err != nil {
		t.Fatal(err)
	}
	rs, err := s.Lookup(context.Background(), "ja", "宿題をした", 3, nil)
	if err != nil {
		t.Fatalf("Lookup with a broken frequency table: %v", err)
	}
	wantPrefix(t, rs, "為る[past]", "下", "舌") // the no-frequency order (kana fit)
	for _, r := range rs {
		if len(r.Frequencies) != 0 {
			t.Errorf("%s frequencies = %+v, want none", r.Term, r.Frequencies)
		}
	}
}

// yukuWord is 征く, whose FIRST reading is ゆく; 行く has ゆく second.
const yukuWord = `<entry>
<ent_seq>1578860</ent_seq>
<k_ele><keb>征く</keb></k_ele>
<r_ele><reb>ゆく</reb></r_ele>
<sense><pos>&v5k-s;</pos><pos>&vi;</pos><gloss>to go (to war)</gloss></sense>
</entry>
`

func TestFrequencyOutranksPrimaryReadingMatch(t *testing.T) {
	tests := []struct {
		name string
		freq string // rows of one pack; "" = no frequency data
		want []string
	}{
		// No frequency data: primary match decides (征く reads ゆく first).
		{"no frequency", "", []string{"征く/word", "行く/word", "湯/word"}},
		// 行く is the more frequent word: frequency beats primary match.
		{"frequency", "行く,ゆく,50\n征く,ゆく,30000\n", []string{"行く/word", "征く/word", "湯/word"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			sqlDB := dbtest.Open(t)
			importJMdict(t, sqlDB, jaWords+altWords+yukuWord)
			importKanjidic(t, sqlDB)
			if tt.freq != "" {
				importFreqPack(t, sqlDB, "a", tt.freq)
			}
			rs := run(t, service(sqlDB), "ja", "ゆく", 0)
			if got := headwords(rs); !slices.Equal(got, tt.want) {
				t.Errorf("results = %v, want %v", got, tt.want)
			}
		})
	}
}

// verbWords are the words of the progressive, desiderative and imperative
// tests, with 指定 and 姉弟, which read してい: the three code points
// that beat the te-form して before the progressive rules.
const verbWords = `<entry>
<ent_seq>1310890</ent_seq>
<k_ele><keb>指定</keb><ke_pri>ichi1</ke_pri><ke_pri>news1</ke_pri><ke_pri>nf04</ke_pri></k_ele>
<r_ele><reb>してい</reb><re_pri>ichi1</re_pri><re_pri>news1</re_pri><re_pri>nf04</re_pri></r_ele>
<sense><pos>&n;</pos><pos>&vs;</pos><gloss>designation</gloss></sense>
</entry>
<entry>
<ent_seq>1310130</ent_seq>
<k_ele><keb>姉弟</keb><ke_pri>news2</ke_pri></k_ele>
<r_ele><reb>してい</reb></r_ele>
<sense><pos>&n;</pos><gloss>elder sister and younger brother</gloss></sense>
</entry>
<entry>
<ent_seq>1358280</ent_seq>
<k_ele><keb>食べる</keb><ke_pri>ichi1</ke_pri></k_ele>
<r_ele><reb>たべる</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&v1;</pos><pos>&vt;</pos><gloss>to eat</gloss></sense>
</entry>
<entry>
<ent_seq>1169870</ent_seq>
<k_ele><keb>飲む</keb><ke_pri>ichi1</ke_pri></k_ele>
<r_ele><reb>のむ</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&v5m;</pos><pos>&vt;</pos><gloss>to drink</gloss></sense>
</entry>
<entry>
<ent_seq>1259290</ent_seq>
<k_ele><keb>見る</keb><ke_pri>ichi1</ke_pri></k_ele>
<r_ele><reb>みる</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&v1;</pos><pos>&vt;</pos><gloss>to see</gloss></sense>
</entry>
<entry>
<ent_seq>2083120</ent_seq>
<k_ele><keb>見</keb></k_ele>
<r_ele><reb>み</reb></r_ele>
<sense><pos>&n-suf;</pos><gloss>viewing</gloss></sense>
</entry>
<entry>
<ent_seq>1587040</ent_seq>
<k_ele><keb>言う</keb><ke_pri>ichi1</ke_pri></k_ele>
<r_ele><reb>いう</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&v5u;</pos><pos>&vt;</pos><gloss>to say</gloss></sense>
</entry>
<entry>
<ent_seq>1219960</ent_seq>
<k_ele><keb>行き</keb><ke_pri>ichi1</ke_pri></k_ele>
<r_ele><reb>いき</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&n;</pos><gloss>going</gloss></sense>
</entry>
`

// verbService seeds the base, alternative-form and verb words; freq is
// one frequency pack's rows, "" for none.
func verbService(t *testing.T, freq string) lookup.Service {
	t.Helper()
	sqlDB := dbtest.Open(t)
	importJMdict(t, sqlDB, jaWords+altWords+verbWords)
	if freq != "" {
		importFreqPack(t, sqlDB, "a", freq)
	}
	return service(sqlDB)
}

func TestProgressiveDesireImperative(t *testing.T) {
	s := verbService(t, "")
	for _, c := range []struct{ text, first string }{
		{"している", "為る[progressive te-form]"},
		{"してる", "為る[progressive te-form]"},
		{"していた", "為る[past progressive te-form]"},
		{"しています", "為る[polite progressive te-form]"},
		{"食べている", "食べる[progressive te-form]"},
		{"飲んでいる", "飲む[progressive te-form]"},
		{"行っていた", "行く[past progressive te-form]"},
		{"勉強しています", "勉強[polite progressive te-form]"},
		{"食べたい", "食べる[desire]"},
		{"食べたくない", "食べる[negative desire]"},
		{"行きたい", "行く[desire]"},
		{"行きたかった", "行く[past desire]"},
		{"見ろ", "見る[imperative]"},
	} {
		rs := run(t, s, "ja", c.text, 0)
		if len(rs) == 0 || terms(rs)[0] != c.first || rs[0].Matched != c.text {
			t.Errorf("%s: results = %v, want %s matching all of %s first", c.text, terms(rs), c.first, c.text)
		}
	}
	// 食べたい is the desiderative, never 食べた (past) plus a stray い.
	for _, r := range run(t, s, "ja", "食べたい", 0) {
		if r.Term == "食べる" && slices.Contains(r.Reasons, "past") {
			t.Errorf("食べたい: %s %v labelled past", r.Term, r.Reasons)
		}
	}
}

func TestKanaIttaFindsIku(t *testing.T) {
	s := verbService(t, "")
	for _, text := range []string{"いった", "いって"} {
		r := find(run(t, s, "ja", text, 0), "行く")
		if r == nil || r.Matched != text || len(r.Reasons) != 1 {
			t.Errorf("%s: 行く = %+v, want it matched as past or te-form", text, r)
		}
	}
}

// している: with frequency data 為る is far more frequent than 指定; with
// none, 為る is still first because it is the only entry matching all
// four code points (length leads), and 指定/姉弟 (してい, three) follow.
func TestShiteiruRanksSuruFirst(t *testing.T) {
	for _, freq := range []string{"", "為る,する,10\n指定,してい,800\n姉弟,してい,30000\n"} {
		rs := run(t, verbService(t, freq), "ja", "している", 0)
		wantPrefix(t, rs, "為る[progressive te-form]", "指定", "姉弟")
		if rs[0].Lemma != "する" || rs[0].Reading != "する" {
			t.Errorf("freq %q: 為る lemma %q reading %q, want する する", freq, rs[0].Lemma, rs[0].Reading)
		}
	}
}

// shadowWords are nouns in the shape of a godan e-row imperative (届け,
// 構え, 揺れ, 切れ, 向け, 付け, 建て) with their verbs, and pronouns
// followed by the particle よ (これよ) with the ichidan verbs よ would
// make of them.
const shadowWords = `<entry><ent_seq>1441500</ent_seq><k_ele><keb>届け</keb></k_ele><r_ele><reb>とどけ</reb></r_ele><sense><pos>&n;</pos><gloss>report</gloss></sense></entry>
<entry><ent_seq>1441490</ent_seq><k_ele><keb>届く</keb></k_ele><r_ele><reb>とどく</reb></r_ele><sense><pos>&v5k;</pos><gloss>to reach</gloss></sense></entry>
<entry><ent_seq>1279150</ent_seq><k_ele><keb>構え</keb></k_ele><r_ele><reb>かまえ</reb></r_ele><sense><pos>&n;</pos><gloss>posture</gloss></sense></entry>
<entry><ent_seq>1279130</ent_seq><k_ele><keb>構う</keb></k_ele><r_ele><reb>かまう</reb></r_ele><sense><pos>&v5u;</pos><gloss>to mind</gloss></sense></entry>
<entry><ent_seq>1546010</ent_seq><k_ele><keb>揺れ</keb></k_ele><r_ele><reb>ゆれ</reb></r_ele><sense><pos>&n;</pos><gloss>shaking</gloss></sense></entry>
<entry><ent_seq>1546000</ent_seq><k_ele><keb>揺る</keb></k_ele><r_ele><reb>ゆる</reb></r_ele><sense><pos>&v5r;</pos><gloss>to shake</gloss></sense></entry>
<entry><ent_seq>1385780</ent_seq><k_ele><keb>切れ</keb></k_ele><r_ele><reb>きれ</reb></r_ele><sense><pos>&n;</pos><gloss>piece; expiry</gloss></sense></entry>
<entry><ent_seq>1385770</ent_seq><k_ele><keb>切る</keb></k_ele><r_ele><reb>きる</reb></r_ele><sense><pos>&v5r;</pos><gloss>to cut</gloss></sense></entry>
<entry><ent_seq>1525890</ent_seq><k_ele><keb>向け</keb></k_ele><r_ele><reb>むけ</reb></r_ele><sense><pos>&suf;</pos><gloss>intended for</gloss></sense></entry>
<entry><ent_seq>1525880</ent_seq><k_ele><keb>向く</keb></k_ele><r_ele><reb>むく</reb></r_ele><sense><pos>&v5k;</pos><gloss>to face</gloss></sense></entry>
<entry><ent_seq>1495770</ent_seq><k_ele><keb>付け</keb></k_ele><r_ele><reb>つけ</reb></r_ele><sense><pos>&n;</pos><gloss>bill</gloss></sense></entry>
<entry><ent_seq>1495740</ent_seq><k_ele><keb>付く</keb></k_ele><r_ele><reb>つく</reb></r_ele><sense><pos>&v5k;</pos><gloss>to be attached</gloss></sense></entry>
<entry><ent_seq>1257220</ent_seq><k_ele><keb>建て</keb></k_ele><r_ele><reb>だて</reb></r_ele><sense><pos>&suf;</pos><gloss>-storied</gloss></sense></entry>
<entry><ent_seq>1257200</ent_seq><k_ele><keb>建つ</keb></k_ele><r_ele><reb>たつ</reb></r_ele><sense><pos>&v5t;</pos><gloss>to be built</gloss></sense></entry>
<entry><ent_seq>1288810</ent_seq><r_ele><reb>これ</reb></r_ele><sense><pos>&pn;</pos><gloss>this</gloss></sense></entry>
<entry><ent_seq>1006970</ent_seq><r_ele><reb>それ</reb></r_ele><sense><pos>&pn;</pos><gloss>that</gloss></sense></entry>
<entry><ent_seq>1483185</ent_seq><k_ele><keb>彼</keb></k_ele><r_ele><reb>あれ</reb></r_ele><sense><pos>&pn;</pos><misc>&uk;</misc><gloss>that over there</gloss></sense></entry>
<entry><ent_seq>1483070</ent_seq><k_ele><keb>彼</keb></k_ele><r_ele><reb>かれ</reb></r_ele><sense><pos>&pn;</pos><gloss>he</gloss></sense></entry>
<entry><ent_seq>1420710</ent_seq><k_ele><keb>誰</keb></k_ele><r_ele><reb>だれ</reb></r_ele><sense><pos>&pn;</pos><gloss>who</gloss></sense></entry>
<entry><ent_seq>1251160</ent_seq><k_ele><keb>凝る</keb></k_ele><r_ele><reb>こる</reb></r_ele><sense><pos>&v5r;</pos><gloss>to be absorbed in</gloss></sense></entry>
<entry><ent_seq>1590590</ent_seq><k_ele><keb>逸れる</keb></k_ele><r_ele><reb>それる</reb></r_ele><sense><pos>&v1;</pos><gloss>to stray</gloss></sense></entry>
<entry><ent_seq>1224250</ent_seq><k_ele><keb>枯れる</keb></k_ele><r_ele><reb>かれる</reb></r_ele><sense><pos>&v1;</pos><gloss>to wither</gloss></sense></entry>
<entry><ent_seq>1009410</ent_seq><k_ele><keb>弛れる</keb></k_ele><r_ele><reb>だれる</reb></r_ele><sense><pos>&v1;</pos><gloss>to slacken</gloss></sense></entry>
<entry><ent_seq>1259410</ent_seq><k_ele><keb>考える</keb></k_ele><r_ele><reb>かんがえる</reb></r_ele><sense><pos>&v1;</pos><gloss>to think</gloss></sense></entry>
`

// shadowFreq makes every verb FAR more frequent than its noun or
// pronoun, so only the rules, not frequency, can keep the nouns first.
const shadowFreq = `届く,とどく,1
構う,かまう,2
揺る,ゆる,3
切る,きる,4
向く,むく,5
付く,つく,6
建つ,たつ,7
凝る,こる,8
逸れる,それる,9
枯れる,かれる,10
弛れる,だれる,11
有る,ある,12
届け,とどけ,50000
構え,かまえ,50001
揺れ,ゆれ,50002
切れ,きれ,50003
向け,むけ,50004
付け,つけ,50005
建て,だて,50006
これ,,50007
それ,,50008
彼,あれ,50009
彼,かれ,50010
誰,だれ,50011
`

// TestImperativesDoNotShadowNouns: a noun shaped like a godan e-row
// imperative (届け, 切れ in 期限切れ, 向け in 子供向け) and a pronoun
// followed by the particle よ (これよ) rank first even when the verb is
// far more frequent: godan imperatives are not deinflected, and the よ
// imperative needs a stem with a non-kana character (見よ, 考えよ).
func TestImperativesDoNotShadowNouns(t *testing.T) {
	for _, freq := range []string{"", shadowFreq} {
		s := verbService2(t, freq)
		for _, c := range []struct {
			text   string
			offset int
			first  string
		}{
			{"届けを出す", 0, "届け"},
			{"構え", 0, "構え"},
			{"揺れが続く", 0, "揺れ"},
			{"期限切れ", 2, "切れ"},
			{"子供向けの本", 2, "向け"},
			{"付け", 0, "付け"},
			{"二階建て", 2, "建て"},
			{"これよ", 0, "これ"},
			{"それよ", 0, "それ"},
			{"あれよ", 0, "彼"},
			{"かれよ", 0, "彼"},
			{"だれよ", 0, "誰"},
			{"見ろ", 0, "見る[imperative]"},
			{"見よ", 0, "見る[imperative]"},
			{"考えよ", 0, "考える[imperative]"},
			{"勉強しろ", 0, "勉強[imperative]"},
		} {
			rs := run(t, s, "ja", c.text, c.offset)
			if len(rs) == 0 || terms(rs)[0] != c.first {
				t.Errorf("freq=%v %s@%d: results = %v, want %s first", freq != "", c.text, c.offset, terms(rs), c.first)
			}
		}
		// Godan imperatives are deliberately not deinflected (yet).
		if r := find(run(t, s, "ja", "行け", 0), "行く"); r != nil {
			t.Errorf("freq=%v 行け: 行く = %+v, want godan imperatives not deinflected", freq != "", r)
		}
	}
}

// verbService2 is verbService plus the shadow words.
func verbService2(t *testing.T, freq string) lookup.Service {
	t.Helper()
	sqlDB := dbtest.Open(t)
	importJMdict(t, sqlDB, jaWords+altWords+verbWords+shadowWords)
	if freq != "" {
		importFreqPack(t, sqlDB, "a", freq)
	}
	return service(sqlDB)
}
