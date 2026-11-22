package lemma_test

import (
	"slices"
	"strings"
	"testing"

	"qinqin/internal/lemma"
)

// toyTable is a made-up language: verbs end in -ar (class "ar") or -ir
// (class "ir"); -aba is the past, -ando the gerund, -mos the plural of a
// past or gerund (intermediate class "pl"), whole-word "fue" is the past
// of "ir", and the -a imperative needs a stem of at least three letters.
const toyTable = `{
 "format": 1, "language": "xx", "version": "test", "maxDepth": 3,
 "classes": {"ar": {"tags": ["v-ar"]}, "ir": {"prefixes": ["v-ir"]}, "pl": {}, "w": {"any": true}},
 "compounds": [{"suffix": "ar", "class": "ar"}],
 "hints": {"expressionPos": ["exp"], "particlePos": ["prt"]},
 "rules": [
  {"from": "mos", "to": "", "reason": "plural", "out": "pl"},
  {"from": "aba", "to": "ar", "reason": "past", "out": "ar", "in": ["pl"]},
  {"from": "ando", "to": "ar", "reason": "gerund", "out": "ar", "in": ["pl"]},
  {"from": "fue", "to": "ir", "reason": "past", "out": "ir", "match": "whole"},
  {"from": "ido", "to": "ir", "reason": "participle", "out": "ir", "match": "suffix-or-whole"},
  {"from": "a", "to": "ar", "reason": "imperative", "out": "ar", "stem": {"anyOf": [{"minRunes": 3}, {"notOnly": "latin"}]}},
  {"from": "o", "to": "ar", "reason": "first person", "out": "ar", "stem": {"allOf": [{"notSuffix": ["nd", "id"]}, {"minRunes": 2}]}}
 ]
}`

func parse(t *testing.T, src string) *lemma.Table {
	t.Helper()
	tb, err := lemma.Parse([]byte(src))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	return tb
}

func render(cs []lemma.Candidate) []string {
	out := make([]string, len(cs))
	for i, c := range cs {
		out[i] = c.Form + "/" + c.Class + "/" + strings.Join(c.Reasons, ",")
	}
	return out
}

func TestDeinflectChainsWithClassGating(t *testing.T) {
	tb := parse(t, toyTable)
	// hablabamos: plural (-> hablaba, pl), then past (-> hablar) only
	// because past takes pl; the imperative -a never applies to hablaba at
	// depth 1 (no "in").
	got := render(tb.Deinflect("hablabamos"))
	want := []string{"hablaba/pl/plural", "hablar/ar/plural,past"}
	if !slices.Equal(got, want) {
		t.Errorf("Deinflect(hablabamos) = %q, want %q", got, want)
	}
	// hablaba at depth 0: every rule applies (past, imperative on hablab).
	got = render(tb.Deinflect("hablaba"))
	want = []string{"hablar/ar/past", "hablabar/ar/imperative"}
	if !slices.Equal(got, want) {
		t.Errorf("Deinflect(hablaba) = %q, want %q", got, want)
	}
}

func TestDeinflectMatchModes(t *testing.T) {
	tb := parse(t, toyTable)
	if got := render(tb.Deinflect("fue")); !slices.Equal(got, []string{"ir/ir/past"}) {
		t.Errorf("whole fue = %q", got)
	}
	if got := tb.Deinflect("refue"); len(got) != 0 {
		t.Errorf("whole rule matched a suffix: %q", render(got))
	}
	if got := render(tb.Deinflect("ido")); !slices.Equal(got, []string{"ir/ir/participle"}) {
		t.Errorf("suffix-or-whole ido = %q", got)
	}
	if got := render(tb.Deinflect("salido")); !slices.Equal(got, []string{"salir/ir/participle"}) {
		t.Errorf("suffix-or-whole salido = %q", got)
	}
	// A plain suffix rule needs a stem: "a" alone is nothing.
	if got := tb.Deinflect("a"); len(got) != 0 {
		t.Errorf("Deinflect(a) = %q, want none", render(got))
	}
}

func TestDeinflectStemPredicates(t *testing.T) {
	tb := parse(t, toyTable)
	// imperative: anyOf(minRunes 3, notOnly latin)
	for surface, want := range map[string]bool{"canta": true, "va": false, "жa": true, "жжa": true} {
		got := slices.ContainsFunc(tb.Deinflect(surface), func(c lemma.Candidate) bool { return slices.Equal(c.Reasons, []string{"imperative"}) })
		if got != want {
			t.Errorf("imperative of %q = %v, want %v", surface, got, want)
		}
	}
	// first person: allOf(notSuffix nd, minRunes 2)
	for surface, want := range map[string]bool{"canto": true, "ando": false, "co": false, "mando": false} {
		got := slices.ContainsFunc(tb.Deinflect(surface), func(c lemma.Candidate) bool { return slices.Equal(c.Reasons, []string{"first person"}) })
		if got != want {
			t.Errorf("first person of %q = %v, want %v", surface, got, want)
		}
	}
}

func TestDeinflectDepthSurfaceAndDuplicates(t *testing.T) {
	tb := parse(t, toyTable)
	for _, c := range tb.Deinflect("cantandomosmos") {
		if len(c.Reasons) > 3 {
			t.Errorf("%+v chains more than maxDepth", c)
		}
	}
	// "ar" + imperative rule: cantara -> cantarar; the surface itself is never a candidate.
	seen := map[[2]string]bool{}
	for _, c := range tb.Deinflect("cantaba") {
		k := [2]string{c.Form, c.Class}
		if c.Form == "cantaba" || seen[k] {
			t.Errorf("bad candidate %+v", c)
		}
		seen[k] = true
	}
	if got := tb.Deinflect("xyz"); len(got) != 0 {
		t.Errorf("Deinflect(xyz) = %q", render(got))
	}
}

func TestClassMatches(t *testing.T) {
	tb := parse(t, toyTable)
	for _, c := range []struct {
		class string
		pos   []string
		want  bool
	}{
		{"ar", []string{"n", "v-ar"}, true},
		{"ar", []string{"v-arx"}, false},
		{"ir", []string{"v-ir-irr"}, true},
		{"ir", []string{"v-ar"}, false},
		{"pl", []string{"pl", "v-ar"}, false},
		{"", []string{"v-ar"}, false},
		{"zz", []string{"v-ar"}, false},
		{"ar", nil, false},
		{"w", nil, true},
		{"w", []string{"n"}, true},
	} {
		if got := tb.ClassMatches(c.class, c.pos); got != c.want {
			t.Errorf("ClassMatches(%q, %q) = %v, want %v", c.class, c.pos, got, c.want)
		}
	}
}

func TestTableMetadata(t *testing.T) {
	tb := parse(t, toyTable)
	if tb.Language != "xx" || tb.MaxDepth != 3 || len(tb.Rules) != 7 {
		t.Errorf("table = %+v", tb)
	}
	if !slices.Equal(tb.Hints.ExpressionPOS, []string{"exp"}) || !slices.Equal(tb.Hints.ParticlePOS, []string{"prt"}) {
		t.Errorf("hints = %+v", tb.Hints)
	}
	if len(tb.Compounds) != 1 || tb.Compounds[0].Suffix != "ar" || tb.Compounds[0].Class != "ar" || tb.Compounds[0].Stem != nil {
		t.Errorf("compounds = %+v", tb.Compounds)
	}
}

func TestParseRejects(t *testing.T) {
	base := `"format": 1, "language": "xx", "version": "t", "maxDepth": 2, "classes": {"a": {"tags": ["a"]}}`
	for name, src := range map[string]string{
		"not json":          `{`,
		"unknown key":       `{` + base + `, "rules": [], "extra": 1}`,
		"format 3":          strings.Replace(`{`+base+`, "rules": []}`, `"format": 1`, `"format": 3`, 1),
		"format 0":          strings.Replace(`{`+base+`, "rules": []}`, `"format": 1`, `"format": 0`, 1),
		"depth 0":           strings.Replace(`{`+base+`, "rules": []}`, `"maxDepth": 2`, `"maxDepth": 0`, 1),
		"depth 9":           strings.Replace(`{`+base+`, "rules": []}`, `"maxDepth": 2`, `"maxDepth": 9`, 1),
		"no language":       strings.Replace(`{`+base+`, "rules": []}`, `"language": "xx"`, `"language": ""`, 1),
		"empty from":        `{` + base + `, "rules": [{"from": "", "to": "a", "reason": "r", "out": "a"}]}`,
		"empty reason":      `{` + base + `, "rules": [{"from": "x", "to": "a", "reason": "", "out": "a"}]}`,
		"unknown out":       `{` + base + `, "rules": [{"from": "x", "to": "a", "reason": "r", "out": "b"}]}`,
		"unknown in":        `{` + base + `, "rules": [{"from": "x", "to": "a", "reason": "r", "out": "a", "in": ["b"]}]}`,
		"bad match":         `{` + base + `, "rules": [{"from": "x", "to": "a", "reason": "r", "out": "a", "match": "prefix"}]}`,
		"unknown predicate": `{` + base + `, "rules": [{"from": "x", "to": "a", "reason": "r", "out": "a", "stem": {"named": "f"}}]}`,
		"unknown script":    `{` + base + `, "rules": [{"from": "x", "to": "a", "reason": "r", "out": "a", "stem": {"notOnly": "runic"}}]}`,
		"empty predicate":   `{` + base + `, "rules": [{"from": "x", "to": "a", "reason": "r", "out": "a", "stem": {}}]}`,
		"any with tags":     `{"format": 1, "language": "xx", "version": "t", "maxDepth": 2, "classes": {"a": {"any": true, "tags": ["a"]}}, "rules": []}`,
		"nested empty":      `{` + base + `, "rules": [{"from": "x", "to": "a", "reason": "r", "out": "a", "stem": {"anyOf": [{}]}}]}`,
		"compound class":    `{` + base + `, "rules": [], "compounds": [{"suffix": "s", "class": "b"}]}`,
		"compound suffix":   `{` + base + `, "rules": [], "compounds": [{"suffix": "", "class": "a"}]}`,
	} {
		if _, err := lemma.Parse([]byte(src)); err == nil {
			t.Errorf("%s: Parse succeeded, want an error", name)
		}
	}
}

func TestCompoundStemPredicate(t *testing.T) {
	tb := parse(t, `{"format": 1, "language": "xc", "version": "t", "maxDepth": 1,
	 "classes": {"vs": {"tags": ["vs"]}}, "hints": {},
	 "compounds": [{"suffix": "する", "class": "vs", "stem": {"anyOf": [{"minRunes": 2}, {"notOnly": "kana"}]}}],
	 "rules": []}`)
	c := tb.Compounds[0]
	for stem, want := range map[string]bool{"勉強": true, "す": false, "ちゃんと": true, "愛": true} {
		if got := c.StemOK(stem); got != want {
			t.Errorf("StemOK(%q) = %v, want %v", stem, got, want)
		}
	}
	if !(lemma.Compound{Suffix: "する", Class: "vs"}).StemOK("す") {
		t.Error("a compound without a predicate refuses a stem")
	}
	if _, err := lemma.Parse([]byte(`{"format": 1, "language": "xc", "version": "t", "maxDepth": 1,
	 "classes": {"vs": {}}, "hints": {}, "compounds": [{"suffix": "する", "class": "vs", "stem": {}}], "rules": []}`)); err == nil {
		t.Error("an empty compound stem predicate parsed")
	}
}

func TestReadingHintsAndInScript(t *testing.T) {
	tb := parse(t, `{"format": 1, "language": "xh", "version": "t", "maxDepth": 1, "classes": {},
	 "hints": {"readingScript": "kana", "readingType": "kana"}, "rules": []}`)
	if tb.Hints.ReadingScript != "kana" || tb.Hints.ReadingType != "kana" {
		t.Errorf("hints = %+v", tb.Hints)
	}
	for s, want := range map[string]bool{"あめ": true, "アメー": true, "雨": false, "": false, "aめ": false} {
		if got := lemma.InScript("kana", s); got != want {
			t.Errorf("InScript(kana, %q) = %v, want %v", s, got, want)
		}
	}
	if _, err := lemma.Parse([]byte(`{"format": 1, "language": "xh", "version": "t", "maxDepth": 1, "classes": {},
	 "hints": {"readingScript": "runic", "readingType": "x"}, "rules": []}`)); err == nil {
		t.Error("an unknown reading script parsed")
	}
	if _, err := lemma.Parse([]byte(`{"format": 1, "language": "xh", "version": "t", "maxDepth": 1, "classes": {},
	 "hints": {"readingScript": "kana"}, "rules": []}`)); err == nil {
		t.Error("a reading script without a reading type parsed")
	}
}

func TestFormat2Hints(t *testing.T) {
	tb := parse(t, `{"format": 2, "language": "xf", "version": "t", "maxDepth": 1, "classes": {},
	 "hints": {"keepWhole": ["にもとづいて", "を通して"]}, "rules": []}`)
	if len(tb.Hints.KeepWhole) != 2 {
		t.Errorf("hints = %+v", tb.Hints)
	}
	if !tb.Hints.KeepsWhole("に基づいて", "にもとづいて") || !tb.Hints.KeepsWhole("を通して") || tb.Hints.KeepsWhole("をして", "") {
		t.Error("KeepsWhole")
	}
	// format 1 tables stay valid; a format newer than the engine's is refused
	parse(t, `{"format": 1, "language": "xf", "version": "t", "maxDepth": 1, "classes": {}, "hints": {}, "rules": []}`)
	if _, err := lemma.Parse([]byte(`{"format": 3, "language": "xf", "version": "t", "maxDepth": 1, "classes": {}, "hints": {}, "rules": []}`)); err == nil {
		t.Error("format 3 parsed")
	}
	if _, err := lemma.Parse([]byte(`{"format": 2, "language": "xf", "version": "t", "maxDepth": 1, "classes": {}, "hints": {"keepWhole": [""]}, "rules": []}`)); err == nil {
		t.Error("an empty keepWhole entry parsed")
	}
}

// A chainOnly rule (format 2) never rewrites the surface itself, only a
// form an earlier rule produced.
func TestChainOnlyRule(t *testing.T) {
	tb := parse(t, `{"format": 2, "language": "xo", "version": "t", "maxDepth": 2,
	 "classes": {"t": {}, "w": {"any": true}}, "hints": {},
	 "rules": [{"from": "xreq", "to": "x", "reason": "request", "out": "t"},
	           {"from": "nax", "to": "na", "reason": "te-form", "in": ["t"], "out": "w", "chainOnly": true}]}`)
	if got := render(tb.Deinflect("tabenaxreq")); !slices.Equal(got, []string{"tabenax/t/request", "tabena/w/request,te-form"}) {
		t.Errorf("chained: %q", got)
	}
	if got := tb.Deinflect("tabenax"); len(got) != 0 {
		t.Errorf("surface: %q, want none", render(got))
	}
}

// A format-1 table may not use format-2 fields.
func TestFormat1RejectsFormat2Fields(t *testing.T) {
	for name, src := range map[string]string{
		"keepWhole": `{"format": 1, "language": "xg", "version": "t", "maxDepth": 1, "classes": {}, "hints": {"keepWhole": ["a"]}, "rules": []}`,
		"chainOnly": `{"format": 1, "language": "xg", "version": "t", "maxDepth": 1, "classes": {"a": {}}, "hints": {},
		 "rules": [{"from": "x", "to": "a", "reason": "r", "out": "a", "chainOnly": true}]}`,
	} {
		if _, err := lemma.Parse([]byte(src)); err == nil {
			t.Errorf("%s in a format-1 table parsed", name)
		}
		if _, err := lemma.Parse([]byte(strings.Replace(src, `"format": 1`, `"format": 2`, 1))); err != nil {
			t.Errorf("%s in a format-2 table: %v", name, err)
		}
	}
}
