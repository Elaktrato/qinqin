package lookup_test

import (
	"testing"

	"qinqin/internal/dbtest"
)

// lemmaWords are the real JMdict shapes of the issue #165 ranking cases:
// a rare noun read しま (揣摩, a する noun without priority), a common
// noun read しよう written in kanji (使用), the expressions すれば and
// できれば (no written form), ください (usually kana), しかし (a
// conjunction) and 出来る.
const lemmaWords = `<entry>
<ent_seq>1630300</ent_seq>
<k_ele><keb>揣摩</keb></k_ele>
<r_ele><reb>しま</reb></r_ele>
<sense><pos>&n;</pos><pos>&vs;</pos><gloss>conjecture</gloss></sense>
</entry>
<entry>
<ent_seq>1322990</ent_seq>
<k_ele><keb>使用</keb><ke_pri>ichi1</ke_pri><ke_pri>news1</ke_pri><ke_pri>nf02</ke_pri></k_ele>
<r_ele><reb>しよう</reb><re_pri>ichi1</re_pri><re_pri>news1</re_pri><re_pri>nf02</re_pri></r_ele>
<sense><pos>&n;</pos><pos>&vs;</pos><gloss>use</gloss></sense>
</entry>
<entry>
<ent_seq>2136640</ent_seq>
<r_ele><reb>すれば</reb><re_pri>spec1</re_pri></r_ele>
<sense><pos>&exp;</pos><gloss>if so</gloss></sense>
</entry>
<entry>
<ent_seq>2136650</ent_seq>
<r_ele><reb>できれば</reb><re_pri>nf01</re_pri></r_ele>
<sense><pos>&exp;</pos><gloss>if possible (test: a higher priority than the verb)</gloss></sense>
</entry>
<entry>
<ent_seq>1340450</ent_seq>
<k_ele><keb>出来る</keb><ke_pri>ichi1</ke_pri></k_ele>
<r_ele><reb>できる</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&v1;</pos><pos>&vi;</pos><misc>&uk;</misc><gloss>to be able</gloss></sense>
</entry>
<entry>
<ent_seq>1184270</ent_seq>
<k_ele><keb>下さい</keb><ke_pri>ichi1</ke_pri></k_ele>
<r_ele><reb>ください</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&exp;</pos><misc>&uk;</misc><gloss>please</gloss></sense>
</entry>
<entry>
<ent_seq>1008630</ent_seq>
<k_ele><keb>然し</keb><ke_pri>ichi1</ke_pri></k_ele>
<r_ele><reb>しかし</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&conj;</pos><misc>&uk;</misc><gloss>however</gloss></sense>
</entry>
<entry>
<ent_seq>1008340</ent_seq>
<r_ele><reb>として</reb><re_pri>spec1</re_pri></r_ele>
<sense><pos>&exp;</pos><gloss>as (i.e. in the role of)</gloss></sense>
</entry>
<entry>
<ent_seq>2136890</ent_seq>
<r_ele><reb>とする</reb><re_pri>spec1</re_pri></r_ele>
<sense><pos>&exp;</pos><pos>&vs-i;</pos><gloss>to try to</gloss></sense>
</entry>
<entry>
<ent_seq>1288770</ent_seq>
<k_ele><keb>寿司</keb><ke_pri>ichi1</ke_pri></k_ele>
<r_ele><reb>すし</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&n;</pos><gloss>sushi</gloss></sense>
</entry>
<entry>
<ent_seq>2269880</ent_seq>
<k_ele><keb>為</keb></k_ele>
<r_ele><reb>す</reb></r_ele>
<sense><pos>&vs-c;</pos><misc>&uk;</misc><gloss>to do (archaic)</gloss></sense>
</entry>
`

// Without a frequency pack (the issue's measurement), a common verb the
// surface deinflects to beats a kanji word matched only by its kana
// reading (kana fit) and an unwritten expression of no higher priority
// that is the verb's own inflection (expression yields).
func TestLemmaRankingWithoutFrequency(t *testing.T) {
	sqlDB := dbtest.Open(t)
	importJMdict(t, sqlDB, jaWords+lemmaWords)
	s := service(sqlDB)
	for _, c := range []struct {
		text string
		want []string
	}{
		{"しました", []string{"為る[past polite]", "揣摩[past]"}},
		{"しよう", []string{"為る[volitional]", "使用"}},
		{"すれば", []string{"為る[conditional]", "掏る[conditional]", "すれば"}},
		{"できれば", []string{"できれば", "出来る[conditional]"}}, // the expression has the higher priority
		{"ください", []string{"下さい"}},
		{"しかし", []string{"然し"}},
		{"した", []string{"為る[past]", "下", "舌"}},
		{"する", []string{"為る", "掏る"}},
		{"いる", []string{"居る", "要る", "射る"}},
		{"として", []string{"として"}}, // とする is itself an expression: として does not yield to it
		{"すし", []string{"寿司"}},   // a one-kana stem is no する compound (為 read す)
	} {
		wantPrefix(t, run(t, s, "ja", c.text, 0), c.want...)
	}
}

// A one-kana stem never makes a する compound: すし is not す (為) + し.
func TestCompoundStemNeedsMoreThanOneKana(t *testing.T) {
	sqlDB := dbtest.Open(t)
	importJMdict(t, sqlDB, jaWords+lemmaWords)
	for _, r := range run(t, service(sqlDB), "ja", "すし", 0) {
		if label(r) == "為" && r.Matched == "すし" {
			t.Errorf("すし found %+v, want no す compound", r)
		}
	}
}

// An expression never yields to an inflected word without priority: かれば
// (an unwritten expression, priority 0) stays before 狩る (priority 0) in
// the conditional.
func TestExpressionKeepsItsPlaceAgainstAnUnprioritisedVerb(t *testing.T) {
	sqlDB := dbtest.Open(t)
	importJMdict(t, sqlDB, jaWords+`<entry>
<ent_seq>2900100</ent_seq>
<r_ele><reb>かれば</reb></r_ele>
<sense><pos>&exp;</pos><gloss>test expression</gloss></sense>
</entry>
<entry>
<ent_seq>2900101</ent_seq>
<k_ele><keb>狩る</keb></k_ele>
<r_ele><reb>かる</reb></r_ele>
<sense><pos>&v5r;</pos><pos>&vt;</pos><misc>&uk;</misc><gloss>to hunt</gloss></sense>
</entry>
`)
	wantPrefix(t, run(t, service(sqlDB), "ja", "かれば", 0), "かれば", "狩る[conditional]")
}

// A compound stem needs two code points or a non-kana one: けが (怪我
// written in kana) + している is 怪我 in the progressive, メモ and 愛
// compound too; a one-kana stem never does (すし).
func TestCompoundStemLengthByScript(t *testing.T) {
	sqlDB := dbtest.Open(t)
	importJMdict(t, sqlDB, jaWords+`<entry>
<ent_seq>2900200</ent_seq>
<k_ele><keb>怪我</keb><ke_pri>ichi1</ke_pri></k_ele>
<r_ele><reb>けが</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&n;</pos><pos>&vs;</pos><gloss>injury</gloss></sense>
</entry>
<entry>
<ent_seq>2900201</ent_seq>
<r_ele><reb>メモ</reb><re_pri>gai1</re_pri></r_ele>
<sense><pos>&n;</pos><pos>&vs;</pos><gloss>memo</gloss></sense>
</entry>
<entry>
<ent_seq>2900202</ent_seq>
<k_ele><keb>愛</keb><ke_pri>ichi1</ke_pri></k_ele>
<r_ele><reb>あい</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&n;</pos><pos>&vs;</pos><gloss>love</gloss></sense>
</entry>
`)
	s := service(sqlDB)
	wantPrefix(t, run(t, s, "ja", "けがしている", 0), "怪我[progressive te-form]")
	wantPrefix(t, run(t, s, "ja", "メモした", 0), "メモ[past]")
	wantPrefix(t, run(t, s, "ja", "愛した", 0), "愛[past]")
}

// Kana fit's usually-kana is the entry flag (uk on any sense; #177 review:
// the first-sense test broke みる, くる, ところ and め). So without a
// frequency pack bare して stays 仕手 (uk on its second sense, priority 92)
// — recorded; the Jiten pack puts する first.
func TestBareShiteWithoutFrequencyIsTheNoun(t *testing.T) {
	sqlDB := dbtest.Open(t)
	importJMdict(t, sqlDB, jaWords+`<entry>
<ent_seq>1305990</ent_seq>
<k_ele><keb>仕手</keb><ke_pri>ichi1</ke_pri><ke_pri>nf08</ke_pri></k_ele>
<r_ele><reb>して</reb><re_pri>ichi1</re_pri><re_pri>nf08</re_pri></r_ele>
<sense><pos>&n;</pos><gloss>doer</gloss></sense>
<sense><pos>&n;</pos><misc>&uk;</misc><gloss>protagonist (noh)</gloss></sense>
</entry>
`)
	s := service(sqlDB)
	wantPrefix(t, run(t, s, "ja", "して", 0), "仕手", "為る[te-form]")
	wantPrefix(t, run(t, s, "ja", "こと", 0), "事")
	wantPrefix(t, run(t, s, "ja", "いる", 0), "居る")
}

// An expression with a written form never yields: しかねない (仕兼ねない)
// stays before する's possibility form of the same text.
func TestWrittenExpressionDoesNotYield(t *testing.T) {
	sqlDB := dbtest.Open(t)
	importJMdict(t, sqlDB, jaWords+`<entry>
<ent_seq>1305000</ent_seq>
<k_ele><keb>仕兼ねない</keb></k_ele>
<r_ele><reb>しかねない</reb></r_ele>
<sense><pos>&exp;</pos><misc>&uk;</misc><gloss>might do</gloss></sense>
</entry>
`)
	wantPrefix(t, run(t, service(sqlDB), "ja", "しかねない", 0), "仕兼ねない", "為る[possibility]")
}
