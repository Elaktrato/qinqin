package lookup_test

import (
	"context"
	"database/sql"
	"slices"
	"testing"

	"qinqin/internal/dict"
	"qinqin/internal/lookup"
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
	importPack(t, sqlDB, dict.Manifest{
		ID: "kanjidic2-test", Name: "KANJIDIC2 test", Version: "1", Type: "dictionary", Language: "ja",
		License: "CC BY-SA 4.0", Attribution: "EDRDG", Format: "kanjidic2",
	}, "kanjidic2.xml", kanjidic)
}

func importFreqPack(t *testing.T, sqlDB *sql.DB, id, rows string) {
	t.Helper()
	importPack(t, sqlDB, dict.Manifest{
		ID: id, Name: "Freq " + id, Version: "1", Type: "frequency", Language: "ja",
		License: "CC BY-SA 4.0", Attribution: "test", Format: "freq-csv",
	}, "freq.csv", "term,reading,rank\n"+rows)
}

// altService seeds the base words, the alternative-form words and
// KANJIDIC; freqPacks are imported in order (id, rows pairs).
func altService(t *testing.T, freqPacks ...string) (lookup.Service, *sql.DB) {
	t.Helper()
	sqlDB, _ := openDB(t)
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

func TestFirstPackWithAnyDataRanks(t *testing.T) {
	// Pack a has data for 舌 only; pack b for all three. Pack a ranks:
	// 舌 first, the rest fall through to the chain (exact 下 before 為る).
	s, _ := altService(t, "a", "舌,した,100\n", "b", "為る,する,15\n下,した,600\n舌,した,5000\n")
	rs := run(t, s, "ja", "宿題をした", 3)
	wantPrefix(t, rs, "舌", "下", "為る[past]")
	want := map[string][]int{"舌": {100, 5000}, "下": {600}, "為る": {15}}
	for _, r := range rs[:3] {
		var ranks []int
		for _, f := range r.Frequencies {
			ranks = append(ranks, f.Rank)
		}
		if !slices.Equal(ranks, want[r.Term]) {
			t.Errorf("%s frequencies = %v, want %v", r.Term, ranks, want[r.Term])
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
	wantPrefix(t, rs, "下", "舌", "為る[past]")
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
			sqlDB, _ := openDB(t)
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
