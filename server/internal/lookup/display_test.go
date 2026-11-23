package lookup_test

import (
	"testing"

	"qinqin/internal/dbtest"
)

// noEntry is JMdict 1469800, the particle の: both written forms are
// search-only (sK) and no sense is uk.
const noEntry = `<entry>
<ent_seq>1469800</ent_seq>
<k_ele><keb>乃</keb><ke_inf>&sK;</ke_inf></k_ele>
<k_ele><keb>之</keb><ke_inf>&sK;</ke_inf></k_ele>
<r_ele><reb>の</reb><re_pri>spec1</re_pri></r_ele>
<sense><pos>&prt;</pos><gloss>indicates possessive</gloss></sense>
</entry>
`

// TestKanaMatchShowsTheDisplayForm: a kana match shows the entry's display
// form — the kana of a usually-kana word, the reading of a word whose
// written forms are all search-only — not its first written form.
func TestKanaMatchShowsTheDisplayForm(t *testing.T) {
	sqlDB := dbtest.Open(t)
	importJMdict(t, sqlDB, jaWords+noEntry)
	s := service(sqlDB)
	for _, tt := range []struct{ text, term, form string }{
		{"の", "の", "乃"},
		{"する", "する", "為る"},
		{"こと", "こと", "事"},
		{"しゅくだい", "宿題", "宿題"}, // not usually kana: the written form
	} {
		rs := run(t, s, "ja", tt.text, 0)
		if len(rs) == 0 || rs[0].Term != tt.term || rs[0].Forms[0].Text != tt.form {
			t.Errorf("%s: first result %+v, want term %s (form %s)", tt.text, rs, tt.term, tt.form)
		}
	}
}

// TestSearchOnlyFormMatchShowsTheDisplayForm: a text written with a
// search-only form (之) finds the word, shown as its display form.
func TestSearchOnlyFormMatchShowsTheDisplayForm(t *testing.T) {
	sqlDB := dbtest.Open(t)
	importJMdict(t, sqlDB, jaWords+noEntry)
	rs := run(t, service(sqlDB), "ja", "之", 0)
	if len(rs) == 0 || rs[0].Term != "の" || rs[0].Matched != "之" {
		t.Fatalf("之 = %+v, want term の matched 之", rs)
	}
}
