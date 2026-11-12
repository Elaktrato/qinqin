package lang_test

import (
	"slices"
	"testing"

	"qinqin/internal/lang"
)

func TestJaDeinflect(t *testing.T) {
	cases := []struct{ surface, form, reason string }{
		{"食べた", "食べる", "past"},
		{"食べない", "食べる", "negative"},
		{"食べて", "食べる", "te-form"},
		{"飲みました", "飲む", "polite past"},
		{"書かなかった", "書く", "negative past"},
		{"行ける", "行く", "potential"},
		{"読まれる", "読む", "passive"},
		{"高かった", "高い", "past"},
		{"高くない", "高い", "negative"},
		{"行こう", "行く", "volitional"},
		{"食べれば", "食べる", "conditional"},
		{"食べさせられなかった", "食べる", "causative passive negative past"},
		{"買って", "買う", "te-form"},
		{"泳いだ", "泳ぐ", "past"},
	}
	var d lang.Deinflector = lang.Ja{}
	for _, c := range cases {
		got := d.Deinflect(c.surface)
		if !slices.Contains(got, lang.Deinflection{Form: c.form, Reason: c.reason}) {
			t.Errorf("Deinflect(%q) = %v, want to contain %s (%s)", c.surface, got, c.form, c.reason)
		}
	}
}

func TestJaDeinflectNone(t *testing.T) {
	if got := (lang.Ja{}).Deinflect("猫"); len(got) != 0 {
		t.Errorf("Deinflect(猫) = %v, want none", got)
	}
}

func TestJaDeinflectExcludesSurfaceAndDuplicates(t *testing.T) {
	got := lang.Ja{}.Deinflect("食べられなかった")
	seen := map[string]bool{}
	for _, c := range got {
		if c.Form == "食べられなかった" || seen[c.Form] {
			t.Errorf("bad candidate %v in %v", c, got)
		}
		seen[c.Form] = true
	}
}
