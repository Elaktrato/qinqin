package lexicon_test

import (
	"context"
	"testing"
)

// readingJMdict: 風 is a written form of two words. 振り (usually kana,
// with a priority) also lists 風 and reads ふり; 風 itself reads かぜ.
// Ranked by form alone, the usually-kana ふり wins.
const readingJMdict = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE JMdict [
<!ENTITY uk "word usually written using kana alone">
<!ENTITY n "noun (common) (futsuumeishi)">
]>
<JMdict>
<entry>
<ent_seq>1012000</ent_seq>
<k_ele><keb>振り</keb></k_ele>
<k_ele><keb>風</keb></k_ele>
<r_ele><reb>ふり</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&n;</pos><misc>&uk;</misc><gloss>appearance</gloss></sense>
</entry>
<entry>
<ent_seq>1500620</ent_seq>
<k_ele><keb>風</keb></k_ele>
<r_ele><reb>かぜ</reb></r_ele>
<sense><pos>&n;</pos><gloss>wind</gloss></sense>
</entry>
</JMdict>
`

// TestBestWordReading: a written form with a reading resolves to the entry
// that has both, whatever the form-only ranking says; katakana and
// hiragana readings compare equal; without a reading, or with one no entry
// of that form has, it is BestWord.
func TestBestWordReading(t *testing.T) {
	st := newStore(t)
	importJMdict(t, st, readingJMdict)
	ctx := context.Background()
	for _, tc := range []struct{ form, reading, wantKey string }{
		{"風", "かぜ", "j:1500620"},
		{"風", "カゼ", "j:1500620"},
		{"風", "ふり", "j:1012000"},
		{"風", "", "j:1012000"},
		{"風", "ほげ", "j:1012000"},
		{"ふり", "ふり", "j:1012000"},
	} {
		e, err := st.BestWordReading(ctx, "ja", tc.form, tc.reading)
		if err != nil || e.Key != tc.wantKey {
			t.Errorf("BestWordReading(%s, %s) = %v, %v; want %s", tc.form, tc.reading, e, err, tc.wantKey)
		}
	}
}
