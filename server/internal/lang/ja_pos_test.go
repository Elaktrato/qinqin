package lang_test

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"qinqin/internal/lang"
)

func TestClassMatches(t *testing.T) {
	cases := []struct {
		class string
		pos   []string
		want  bool
	}{
		{lang.ClassV1, []string{"v1", "vt"}, true},
		{lang.ClassV1, []string{"v1-s"}, true},
		{lang.ClassV1, []string{"v5r"}, false},
		{lang.ClassV5, []string{"v5r"}, true},
		{lang.ClassV5, []string{"v5k-s"}, true},
		{lang.ClassV5, []string{"v5aru"}, true},
		{lang.ClassV5, []string{"v5r-i"}, true},
		{lang.ClassV5, []string{"v5u-s"}, true},
		{lang.ClassV5, []string{"v5uru"}, true},
		{lang.ClassV5, []string{"v4r", "v1"}, false},
		{lang.ClassVs, []string{"n", "vs-i"}, true},
		{lang.ClassVs, []string{"n"}, false},
		{lang.ClassVs, []string{"vs"}, true},
		{lang.ClassVs, []string{"vs-s"}, true},
		{lang.ClassVs, []string{"vs-c"}, true},
		{lang.ClassVs, []string{"vz"}, false},
		{lang.ClassVk, []string{"vk"}, true},
		{lang.ClassVk, []string{"v1"}, false},
		{lang.ClassAdjI, []string{"adj-i"}, true},
		{lang.ClassAdjI, []string{"adj-ix"}, true},
		{lang.ClassAdjI, []string{"adj-na", "adj-no"}, false},
		{lang.ClassV1, nil, false},
		{"", []string{"v1"}, false},
		{"masu", []string{"v1", "v5r", "vs", "vk", "adj-i"}, false},
	}
	for _, c := range cases {
		if got := lang.ClassMatches(c.class, c.pos); got != c.want {
			t.Errorf("ClassMatches(%q, %q) = %v, want %v", c.class, c.pos, got, c.want)
		}
	}
}

// reversedJoin is the legacy Reason: Reasons innermost first.
func reversedJoin(reasons []string) string {
	r := slices.Clone(reasons)
	slices.Reverse(r)
	return strings.Join(r, " ")
}

func TestJaDeinflectClasses(t *testing.T) {
	cases := []struct {
		surface, form, class string
		reasons              []string // application order, outermost (surface) rule first
	}{
		{"食べた", "食べる", lang.ClassV1, []string{"past"}},
		{"飲んだ", "飲む", lang.ClassV5, []string{"past"}},
		{"勉強した", "勉強する", lang.ClassVs, []string{"past"}},
		{"来た", "来る", lang.ClassVk, []string{"past"}},
		{"高かった", "高い", lang.ClassAdjI, []string{"past"}},
		{"話した", "話する", lang.ClassVs, []string{"past"}},
		{"話した", "話す", lang.ClassV5, []string{"past"}},
		// chains: every intermediate form has the class the next rule takes
		{"食べさせられなかった", "食べる", lang.ClassV1, []string{"negative past", "passive", "causative"}},
		{"飲みました", "飲む", lang.ClassV5, []string{"past", "polite"}},
		{"書かせられた", "書く", lang.ClassV5, []string{"past", "passive", "causative"}},
		{"書けなかった", "書く", lang.ClassV5, []string{"negative past", "potential"}},
		{"勉強させられる", "勉強する", lang.ClassVs, []string{"passive", "causative"}},
		{"食べなければ", "食べる", lang.ClassV1, []string{"conditional", "negative"}},
		{"高くない", "高い", lang.ClassAdjI, []string{"negative"}},
		// irregular rows
		{"し", "する", lang.ClassVs, []string{"stem"}},
		{"した", "する", lang.ClassVs, []string{"past"}},
		{"して", "する", lang.ClassVs, []string{"te-form"}},
		{"しない", "する", lang.ClassVs, []string{"negative"}},
		{"しなかった", "する", lang.ClassVs, []string{"negative past"}},
		{"します", "する", lang.ClassVs, []string{"polite"}},
		{"しよう", "する", lang.ClassVs, []string{"volitional"}},
		{"すれば", "する", lang.ClassVs, []string{"conditional"}},
		{"される", "する", lang.ClassVs, []string{"passive"}},
		{"させる", "する", lang.ClassVs, []string{"causative"}},
		{"しました", "する", lang.ClassVs, []string{"past", "polite"}},
		{"きた", "くる", lang.ClassVk, []string{"past"}},
		{"きて", "くる", lang.ClassVk, []string{"te-form"}},
		{"こない", "くる", lang.ClassVk, []string{"negative"}},
		{"きます", "くる", lang.ClassVk, []string{"polite"}},
		{"来て", "来る", lang.ClassVk, []string{"te-form"}},
		{"来ない", "来る", lang.ClassVk, []string{"negative"}},
		{"来ました", "来る", lang.ClassVk, []string{"past", "polite"}},
		{"来られる", "来る", lang.ClassVk, []string{"passive"}},
		{"やって来た", "やって来る", lang.ClassVk, []string{"past"}},
		{"行った", "行く", lang.ClassV5, []string{"past"}},
		{"行って", "行く", lang.ClassV5, []string{"te-form"}},
	}
	for _, c := range cases {
		got := lang.Ja{}.Deinflect(c.surface)
		i := slices.IndexFunc(got, func(d lang.Deinflection) bool {
			return d.Form == c.form && d.Class == c.class && slices.Equal(d.Reasons, c.reasons)
		})
		if i < 0 {
			t.Errorf("Deinflect(%q) = %+v, want %s [%s] %q", c.surface, got, c.form, c.class, c.reasons)
			continue
		}
		if want := reversedJoin(c.reasons); got[i].Reason != want {
			t.Errorf("Deinflect(%q) %s Reason = %q, want %q", c.surface, c.form, got[i].Reason, want)
		}
	}
}

func TestJaDeinflectReasonIsReversedChain(t *testing.T) {
	for _, s := range []string{"食べさせられなかった", "飲みました", "高くなかった", "来ました"} {
		for _, d := range (lang.Ja{}).Deinflect(s) {
			if len(d.Reasons) == 0 || d.Reason != reversedJoin(d.Reasons) {
				t.Errorf("Deinflect(%q): %+v: Reason does not match Reasons", s, d)
			}
		}
	}
}

func TestJaDeinflectDropsChainsWithMismatchedClasses(t *testing.T) {
	// まよった -> まよう (godan past, a v5 dictionary form) -> まる would
	// read the v5 form まよう as an ichidan volitional; volitional only
	// applies to the surface, so the chain is not produced.
	for _, d := range (lang.Ja{}).Deinflect("まよった") {
		if d.Form == "まる" {
			t.Errorf("Deinflect(まよった) produced %+v from a mismatched chain", d)
		}
	}
}

func TestJaDeinflectKeepsSameFormWithDifferentClasses(t *testing.T) {
	// いれば: 居る (ichidan れば, v1) and 要る (godan る-row れ+ば, v5).
	var got []string
	for _, d := range (lang.Ja{}).Deinflect("いれば") {
		if d.Form == "いる" {
			got = append(got, d.Class+":"+d.Reason)
		}
	}
	want := []string{"v1:conditional", "v5:conditional"}
	if !slices.Equal(got, want) {
		t.Errorf("Deinflect(いれば) いる = %q, want %q", got, want)
	}
}

func TestJaDeinflectClassGating(t *testing.T) {
	// The caller gates candidates by the senses' POS: 話する is produced
	// (class vs) but 話 is only a noun, so it is rejected; 話す (v5s) passes.
	pos := map[string][]string{"話する": {"n"}, "話す": {"v5s", "vt"}}
	var accepted []string
	for _, d := range (lang.Ja{}).Deinflect("話した") {
		if p, ok := pos[d.Form]; ok && lang.ClassMatches(d.Class, p) {
			accepted = append(accepted, d.Form)
		}
	}
	if !slices.Equal(accepted, []string{"話す"}) {
		t.Errorf("accepted = %q, want [話す]", accepted)
	}
}

// TestJaDeinflectLegacyReasons pins the first candidate per form, as the
// segment tokenizer sees them, to the output before word classes existed.
func TestJaDeinflectLegacyReasons(t *testing.T) {
	cases := map[string]string{
		"食べた":        "食べる(past) 食ぶ(potential past)",
		"飲みました":      "飲みまする(past) 飲みます(past) 飲みましる(past) 飲みる(polite past) 飲む(polite past)",
		"食べさせられなかった": "食べさせられる(negative past) 食べさせられなかっる(past) 食べさせられない(past) 食べさせられなかう(past) 食べさせられなかつ(past) 食べさせられなかる(past) 食べさせる(passive negative past) 食べさせらる(potential negative past) 食べする(causative passive negative past) 食べる(causative passive negative past) 食べさす(potential passive negative past) 食べす(causative passive negative past)",
		"勉強した":       "勉強する(past) 勉強しる(past) 勉強す(past)",
		"来ました":       "来まする(past) 来ます(past) 来ましる(past) 来る(polite past)",
		"行って":        "行く(te-form) 行っる(te-form) 行う(te-form) 行つ(te-form) 行る(te-form)",
		"いれば":        "いる(conditional)",
		"高くなかった":     "高くる(negative past) 高くなかっる(past) 高い(negative past) 高くない(past) 高くなかう(past) 高くなかつ(past) 高くなかる(past)",
		"話した":        "話する(past) 話しる(past) 話す(past)",
	}
	for surface, want := range cases {
		seen := map[string]bool{}
		var got []string
		for _, d := range (lang.Ja{}).Deinflect(surface) {
			if !seen[d.Form] {
				seen[d.Form] = true
				got = append(got, fmt.Sprintf("%s(%s)", d.Form, d.Reason))
			}
		}
		if g := strings.Join(got, " "); g != want {
			t.Errorf("Deinflect(%q) first per form =\n  %s\nwant\n  %s", surface, g, want)
		}
	}
}
