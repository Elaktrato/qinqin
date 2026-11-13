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
		{"し", "する", "stem"},
		{"した", "する", "past"},
		{"して", "する", "te-form"},
		{"しない", "する", "negative"},
		{"します", "する", "polite"},
		{"される", "する", "passive"},
		{"させる", "する", "causative"},
		{"勉強した", "勉強する", "past"},
		{"来た", "来る", "past"},
		{"来て", "来る", "te-form"},
		{"来ない", "来る", "negative"},
		{"来ます", "来る", "polite"},
		{"きた", "くる", "past"},
		{"きて", "くる", "te-form"},
		{"こない", "くる", "negative"},
		{"きます", "くる", "polite"},
		{"行った", "行く", "past"},
		{"行って", "行く", "te-form"},
		{"している", "する", "te-form progressive"},
		{"食べている", "食べる", "te-form progressive"},
		{"飲んでいる", "飲む", "te-form progressive"},
		{"行っていた", "行く", "te-form progressive past"},
		{"しています", "する", "te-form progressive polite"},
		{"勉強しています", "勉強する", "te-form progressive polite"},
		{"食べたい", "食べる", "desire"},
		{"行きたかった", "行く", "desire past"},
		{"見ろ", "見る", "imperative"},
		{"いった", "いく", "past"},
	}
	var d lang.Deinflector = lang.Ja{}
	for _, c := range cases {
		got := d.Deinflect(c.surface)
		if !slices.ContainsFunc(got, func(d lang.Deinflection) bool { return d.Form == c.form && d.Reason == c.reason }) {
			t.Errorf("Deinflect(%q) = %v, want to contain %s (%s)", c.surface, got, c.form, c.reason)
		}
	}
}

func TestJaDeinflectDesireIsNotPast(t *testing.T) {
	for _, d := range (lang.Ja{}).Deinflect("食べたい") {
		if d.Form == "食べる" && d.Reason != "desire" {
			t.Errorf("Deinflect(食べたい) 食べる %+v, want only desire", d)
		}
	}
}

// The ichidan ろ imperative and たい rules skip a kana-only stem of one
// code point (いろ, いたい, みたい stay 色, 痛い, みたい). The よ
// imperative needs a stem with a non-kana character and never follows a
// te-form (これよ, だれよ, 見てよ are a word plus the particle よ).
// Godan imperatives are not deinflected at all: 行け, 届け, 構え, 切れ
// would otherwise shadow the nouns 届け, 構え, 切れ.
func TestJaDeinflectShortKanaStemsAreNotImperativeOrDesire(t *testing.T) {
	blocked := map[string]string{
		"いえ": "いう", "いろ": "いる", "あれ": "ある", "なれ": "なる",
		"いたい": "いる", "みたい": "みる", "見てよ": "見てる", "してよ": "してる",
		"これよ": "これる", "それよ": "それる", "だれよ": "だれる", "たべよ": "たべる",
		"行け": "行く", "届け": "届く", "構え": "構う", "切れ": "切る", "向け": "向く",
		"建て": "建つ", "しまえ": "しまう", "待て": "待つ",
	}
	for surface, form := range blocked {
		for _, d := range (lang.Ja{}).Deinflect(surface) {
			if d.Form == form {
				t.Errorf("Deinflect(%q) = %+v, want no %s", surface, d, form)
			}
		}
	}
	allowed := []struct{ surface, form, reason string }{
		{"たべろ", "たべる", "imperative"},
		{"やめろ", "やめる", "imperative"},
		{"たべたい", "たべる", "desire"},
		{"いきたい", "いく", "desire"},
		{"見ろ", "見る", "imperative"},
		{"見よ", "見る", "imperative"},
		{"考えよ", "考える", "imperative"},
		{"起きよ", "起きる", "imperative"},
		{"捨てろ", "捨てる", "imperative"},
		{"しろ", "する", "imperative"},
		{"こい", "くる", "imperative"},
		{"したい", "する", "desire"},
	}
	for _, c := range allowed {
		got := (lang.Ja{}).Deinflect(c.surface)
		if !slices.ContainsFunc(got, func(d lang.Deinflection) bool { return d.Form == c.form && d.Reason == c.reason }) {
			t.Errorf("Deinflect(%q) = %v, want %s (%s)", c.surface, got, c.form, c.reason)
		}
	}
}

func TestJaDeinflectDepthAtMostFour(t *testing.T) {
	for _, s := range []string{"していませんでした", "食べさせられていなかった", "行きたくなかった"} {
		for _, d := range (lang.Ja{}).Deinflect(s) {
			if len(d.Reasons) > 4 {
				t.Errorf("Deinflect(%q): %+v chains more than 4 rules", s, d)
			}
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
	seen := map[[2]string]bool{}
	for _, c := range got {
		key := [2]string{c.Form, c.Class}
		if c.Form == "食べられなかった" || seen[key] {
			t.Errorf("bad candidate %v in %v", c, got)
		}
		seen[key] = true
	}
}
