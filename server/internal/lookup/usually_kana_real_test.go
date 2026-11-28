package lookup_test

import (
	"slices"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/realdict"
)

// #346 on the shipped JMdict: "usually kana" follows the first sense, as the
// display form does. 目 and 山 carry uk only on a side sense (a suffix, police
// jargon), so they are not usually kana; する's first sense is.
func TestUsuallyKanaFollowsTheFirstSense(t *testing.T) {
	sqlDB := dbtest.Open(t)
	realdict.Import(t, sqlDB, "ja", "目", "山", "する")
	s := service(sqlDB)
	for _, c := range []struct {
		text, form  string
		usuallyKana bool
	}{
		{"目", "目", false},
		{"山", "山", false},
		{"する", "為る", true},
	} {
		rs := run(t, s, "ja", c.text, 0)
		r := find(rs, c.form)
		if r == nil {
			t.Fatalf("%s: no result %s in %v", c.text, c.form, terms(rs))
		}
		if got := slices.Contains(r.Tags, "usually kana"); got != c.usuallyKana {
			t.Errorf("%s: usually kana = %v, want %v (tags %v)", c.form, got, c.usuallyKana, r.Tags)
		}
	}
}
