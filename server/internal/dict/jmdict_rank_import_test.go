package dict_test

import (
	"maps"
	"strings"
	"testing"

	"qinqin/internal/dict"
)

// rankingJMdict is a tiny JMdict in the real file's shape: a DOCTYPE
// declaring (some of) the entities, priority tags on kanji and kana
// elements, rarity flags as entity references, and misc tags per sense.
const rankingJMdict = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE JMdict [
<!ENTITY rK "rarely used kanji form">
<!ENTITY uk "word usually written using kana alone">
<!ENTITY v1 "Ichidan verb">
]>
<JMdict>
<entry>
<ent_seq>1577980</ent_seq>
<k_ele><keb>居る</keb><ke_inf>&rK;</ke_inf></k_ele>
<r_ele><reb>いる</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&v1;</pos><misc>&uk;</misc><gloss>to be</gloss></sense>
<sense><misc>&uk;</misc><gloss>to stay</gloss></sense>
</entry>
<entry>
<ent_seq>1577985</ent_seq>
<k_ele><keb>居る</keb><ke_pri>ichi1</ke_pri><ke_pri>news1</ke_pri><ke_pri>nf19</ke_pri></k_ele>
<r_ele><reb>おる</reb><re_pri>ichi1</re_pri><re_pri>news1</re_pri><re_pri>nf19</re_pri></r_ele>
<sense><misc>&uk;</misc><misc>&hum;</misc><gloss>to be (humble)</gloss></sense>
</entry>
<entry>
<ent_seq>1412300</ent_seq>
<k_ele><keb>学校</keb><ke_pri>news1</ke_pri><ke_pri>ichi1</ke_pri><ke_pri>nf02</ke_pri></k_ele>
<k_ele><keb>學校</keb><ke_inf>&oK;</ke_inf></k_ele>
<r_ele><reb>がっこう</reb><re_pri>news1</re_pri><re_pri>ichi1</re_pri><re_pri>nf02</re_pri></r_ele>
<sense><gloss>school</gloss></sense>
</entry>
<entry>
<ent_seq>1528300</ent_seq>
<r_ele><reb>これ</reb><re_pri>ichi1</re_pri></r_ele>
<r_ele><reb>コレ</reb><re_inf>&ik;</re_inf></r_ele>
<sense><gloss>this</gloss></sense>
</entry>
<entry>
<ent_seq>1000010</ent_seq>
<k_ele><keb>擦る</keb></k_ele>
<r_ele><reb>する</reb></r_ele>
<sense><gloss>to rub</gloss></sense>
<sense><misc>&uk;</misc><gloss>to lose (money)</gloss></sense>
</entry>
<entry>
<ent_seq>1000020</ent_seq>
<k_ele><keb>擦る</keb><ke_pri>spec2</ke_pri></k_ele>
<r_ele><reb>こする</reb></r_ele>
<sense><gloss>to scrub</gloss></sense>
</entry>
<entry>
<ent_seq>1000030</ent_seq>
<k_ele><keb>鋳る</keb></k_ele>
<r_ele><reb>いる</reb></r_ele>
<sense><gloss>to cast</gloss></sense>
</entry>
</JMdict>
`

// importJMdictXML imports xml as a jmdict pack into sqlDB.
func TestJmdictParseKeepsRankingData(t *testing.T) {
	es, err := dict.ParseJMdict(strings.NewReader(rankingJMdict))
	if err != nil {
		t.Fatalf("ParseJMdict: %v", err)
	}
	want := []map[string]map[string]string{
		// 居る/いる: uk, so its kana's ichi1 counts — unpenalized: a uk
		// word is read in kana, so its kanji being rare (rK) says nothing
		// about how common the word is. (Real data: 為る/する is rK too.)
		{"居る": {"jmdict.pri": "60", "jmdict.uk": "1"}},
		// 居る/おる: nf19 is the best tag.
		{"居る": {"jmdict.pri": "82", "jmdict.uk": "1"}},
		// 学校 nf02; 學校 an outdated form without tags of its own.
		{"学校": {"jmdict.pri": "99"}, "學校": {}},
		// A kana-only word scores by its readings (コレ is irregular).
		{"これ": {"jmdict.pri": "60"}},
		// uk on any sense makes the word uk.
		{"擦る": {"jmdict.uk": "1"}},
		{"擦る": {"jmdict.pri": "30"}},
		{"鋳る": {}},
	}
	if len(es) != len(want) {
		t.Fatalf("parsed %d entries, want %d", len(es), len(want))
	}
	for i, e := range es {
		if !maps.EqualFunc(e.FormAttrs, want[i], func(a, b map[string]string) bool { return maps.Equal(a, b) }) {
			t.Errorf("entry %d (%s) form attrs = %v, want %v", i, e.Written, e.FormAttrs, want[i])
		}
	}
}

const ukLiftJMdict = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE JMdict [
<!ENTITY rK "rarely used kanji form">
<!ENTITY uk "word usually written using kana alone">
]>
<JMdict>
<entry><ent_seq>1157170</ent_seq>
<k_ele><keb>為る</keb><ke_inf>&rK;</ke_inf></k_ele>
<r_ele><reb>する</reb><re_pri>ichi1</re_pri></r_ele>
<sense><misc>&uk;</misc><gloss>to do</gloss></sense></entry>
<entry><ent_seq>1340450</ent_seq>
<k_ele><keb>出来る</keb><ke_pri>ichi1</ke_pri><ke_pri>news1</ke_pri><ke_pri>nf15</ke_pri></k_ele>
<k_ele><keb>出きる</keb><ke_inf>&iK;</ke_inf></k_ele>
<k_ele><keb>出來る</keb><ke_inf>&oK;</ke_inf></k_ele>
<k_ele><keb>出け来る</keb><ke_inf>&sK;</ke_inf></k_ele>
<r_ele><reb>できる</reb><re_pri>ichi1</re_pri><re_pri>news1</re_pri><re_pri>nf15</re_pri></r_ele>
<sense><misc>&uk;</misc><gloss>to be able</gloss></sense></entry>
</JMdict>
`

// A uk word lends its kana score to its kanji forms, and only a rarely
// used form (rK) is exempt from the rarity penalty: 為る/する is rK and
// keeps the lifted score. Search-only (sK), irregular (iK) and outdated
// (oK) forms stay penalized, so they score below the common form even on
// a uk word.
func TestJmdictUkLiftExemptsOnlyRareKanji(t *testing.T) {
	sqlDB := newDB(t)
	importLexicon(t, sqlDB, ukLiftJMdict)
	forms := map[string]int{}
	for _, seq := range []string{"1157170", "1340450"} {
		e := lexiconEntry(t, sqlDB, seq)
		if !e.UK {
			t.Errorf("entry %s not uk", seq)
		}
		for _, f := range e.Forms {
			forms[f.Text] = f.Pri
		}
	}
	for form, want := range map[string]int{
		"為る":   60, // rK: lifted, unpenalized
		"出来る":  86,
		"出きる":  46, // iK: 86 − 40
		"出來る":  46, // oK
		"出け来る": 46, // sK
	} {
		if got, ok := forms[form]; !ok || got != want {
			t.Errorf("pri of %s = %d (present %v), want %d", form, got, ok, want)
		}
	}
}
