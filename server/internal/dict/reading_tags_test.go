package dict_test

import (
	"reflect"
	"testing"

	"qinqin/internal/dbtest"
)

// #346: each CC-CEDICT sense carries its line's reading as a sense tag
// (docs/contracts/senses, "reading:<value>"), so a pinned reading can pick
// its lines: 行's xíng and háng senses.
func TestCedictSensesCarryTheirLinesReading(t *testing.T) {
	sqlDB := dbtest.Open(t)
	importLexiconPack(t, sqlDB, cedictLexPack(t, lexCedict))
	xing := lexByKey(t, sqlDB, "zh", "character", "行")
	var tags [][]string
	for _, s := range xing.Senses {
		tags = append(tags, s.Tags)
	}
	if want := [][]string{{"reading:xíng"}, {"reading:háng"}}; !reflect.DeepEqual(tags, want) {
		t.Errorf("行 sense tags = %v, want %v", tags, want)
	}
	ni := lexByKey(t, sqlDB, "zh", "word", "你好")
	if want := []string{"reading:nǐ hǎo"}; len(ni.Senses) != 1 || !reflect.DeepEqual(ni.Senses[0].Tags, want) {
		t.Errorf("你好 sense tags = %v, want %v", ni.Senses, want)
	}
}

// #346: a JMdict <stagr> restriction becomes a reading tag after the misc tags.
func TestJMdictStagrBecomesAReadingTag(t *testing.T) {
	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE JMdict [
<!ENTITY n "noun">
<!ENTITY adv "adverb">
<!ENTITY col "colloquial">
]>
<JMdict>
<entry>
<ent_seq>1579110</ent_seq>
<k_ele><keb>今日</keb><ke_pri>ichi1</ke_pri></k_ele>
<r_ele><reb>きょう</reb><re_pri>ichi1</re_pri></r_ele>
<r_ele><reb>こんにち</reb><re_pri>ichi1</re_pri></r_ele>
<r_ele><reb>こんち</reb></r_ele>
<sense><pos>&n;</pos><pos>&adv;</pos><gloss>today</gloss><gloss>this day</gloss></sense>
<sense><stagr>こんにち</stagr><stagr>こんち</stagr><pos>&n;</pos><misc>&col;</misc><gloss>these days</gloss><gloss>nowadays</gloss></sense>
</entry>
</JMdict>
`
	sqlDB := dbtest.Open(t)
	importLexicon(t, sqlDB, xml)
	e := lexiconEntry(t, sqlDB, "1579110")
	var tags [][]string
	for _, s := range e.Senses {
		tags = append(tags, s.Tags)
	}
	if want := [][]string{{}, {"col", "reading:こんにち", "reading:こんち"}}; !reflect.DeepEqual(tags, want) {
		t.Errorf("今日 sense tags = %v, want %v", tags, want)
	}
}
