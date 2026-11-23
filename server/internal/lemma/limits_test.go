package lemma_test

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"qinqin/internal/lemma"
)

// base is a small valid table every limit case mutates.
func base() map[string]any {
	return map[string]any{
		"format": 2, "language": "xq", "version": "t", "maxDepth": 2,
		"classes": map[string]any{"v": map[string]any{"tags": []any{"v"}}, "m": map[string]any{}},
		"hints":   map[string]any{},
		"rules":   []any{rule("as", "ar", "past", "v")},
	}
}

func rule(from, to, reason, out string) map[string]any {
	return map[string]any{"from": from, "to": to, "reason": reason, "out": out}
}

func encode(t *testing.T, v map[string]any) []byte {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func nest(depth int) map[string]any {
	p := map[string]any{"minRunes": 1}
	for i := 1; i < depth; i++ {
		p = map[string]any{"allOf": []any{p}}
	}
	return p
}

func manyStrings(n, runes int) []any {
	out := make([]any, n)
	for i := range out {
		s := fmt.Sprintf("w%d", i)
		out[i] = s + strings.Repeat("x", max(0, runes-len(s)))
	}
	return out
}

// Every limit of the contract (README "Limits") holds at its value and
// rejects one over it, naming what is too large.
func TestParseLimits(t *testing.T) {
	long := func(n int) string { return strings.Repeat("あ", n) }
	cases := []struct {
		name   string
		at     func(map[string]any)
		over   func(map[string]any)
		reason string
	}{
		{"rules", func(m map[string]any) { m["rules"] = rules(lemma.MaxRules) }, func(m map[string]any) { m["rules"] = rules(lemma.MaxRules + 1) }, "rules"},
		{"classes", func(m map[string]any) { m["classes"] = classes(lemma.MaxClasses) }, func(m map[string]any) { m["classes"] = classes(lemma.MaxClasses + 1) }, "classes"},
		{"class name", func(m map[string]any) {
			m["classes"].(map[string]any)[long(lemma.MaxNameRunes)] = map[string]any{}
		}, func(m map[string]any) { m["classes"].(map[string]any)[long(lemma.MaxNameRunes+1)] = map[string]any{} }, "class"},
		{"class tags", func(m map[string]any) {
			m["classes"].(map[string]any)["t"] = map[string]any{"tags": manyStrings(lemma.MaxClassTags, 3)}
		}, func(m map[string]any) {
			m["classes"].(map[string]any)["t"] = map[string]any{"tags": manyStrings(lemma.MaxClassTags-10, 3), "prefixes": manyStrings(11, 3)}
		}, "tags"},
		{"tag length", func(m map[string]any) {
			m["classes"].(map[string]any)["t"] = map[string]any{"prefixes": []any{long(lemma.MaxNameRunes)}}
		}, func(m map[string]any) {
			m["classes"].(map[string]any)["t"] = map[string]any{"prefixes": []any{long(lemma.MaxNameRunes + 1)}}
		}, "tag"},
		{"compounds", func(m map[string]any) { m["compounds"] = compounds(lemma.MaxCompounds) }, func(m map[string]any) { m["compounds"] = compounds(lemma.MaxCompounds + 1) }, "compounds"},
		{"from", func(m map[string]any) { m["rules"] = []any{rule(long(lemma.MaxAffixRunes), "", "r", "v")} }, func(m map[string]any) { m["rules"] = []any{rule(long(lemma.MaxAffixRunes+1), "", "r", "v")} }, "from"},
		{"to", func(m map[string]any) { m["rules"] = []any{rule("a", long(lemma.MaxAffixRunes), "r", "v")} }, func(m map[string]any) { m["rules"] = []any{rule("a", long(lemma.MaxAffixRunes+1), "r", "v")} }, "to"},
		{"reason", func(m map[string]any) { m["rules"] = []any{rule("a", "", long(lemma.MaxReasonRunes), "v")} }, func(m map[string]any) { m["rules"] = []any{rule("a", "", long(lemma.MaxReasonRunes+1), "v")} }, "reason"},
		{"in", func(m map[string]any) {
			r := rule("a", "", "r", "v")
			r["in"] = repeat("v", lemma.MaxIn)
			m["rules"] = []any{r}
		}, func(m map[string]any) {
			r := rule("a", "", "r", "v")
			r["in"] = repeat("v", lemma.MaxIn+1)
			m["rules"] = []any{r}
		}, "in"},
		{"compound suffix", func(m map[string]any) {
			m["compounds"] = []any{map[string]any{"suffix": long(lemma.MaxAffixRunes), "class": "v"}}
		}, func(m map[string]any) {
			m["compounds"] = []any{map[string]any{"suffix": long(lemma.MaxAffixRunes + 1), "class": "v"}}
		}, "suffix"},
		{"keepWhole", func(m map[string]any) { m["hints"] = map[string]any{"keepWhole": manyStrings(lemma.MaxKeepWhole, 6)} }, func(m map[string]any) {
			m["hints"] = map[string]any{"keepWhole": manyStrings(lemma.MaxKeepWhole+1, 6)}
		}, "keepWhole"},
		{"keepWhole entry", func(m map[string]any) { m["hints"] = map[string]any{"keepWhole": []any{long(lemma.MaxAffixRunes)}} }, func(m map[string]any) {
			m["hints"] = map[string]any{"keepWhole": []any{long(lemma.MaxAffixRunes + 1)}}
		}, "keepWhole"},
		{"expressionPos", func(m map[string]any) {
			m["hints"] = map[string]any{"expressionPos": manyStrings(lemma.MaxPOSHints, 3)}
		}, func(m map[string]any) {
			m["hints"] = map[string]any{"expressionPos": manyStrings(lemma.MaxPOSHints+1, 3)}
		}, "expressionPos"},
		{"particlePos", func(m map[string]any) { m["hints"] = map[string]any{"particlePos": manyStrings(lemma.MaxPOSHints, 3)} }, func(m map[string]any) {
			m["hints"] = map[string]any{"particlePos": manyStrings(lemma.MaxPOSHints+1, 3)}
		}, "particlePos"},
		{"predicate nesting", func(m map[string]any) {
			r := rule("a", "", "r", "v")
			r["stem"] = nest(lemma.MaxPredDepth)
			m["rules"] = []any{r}
		}, func(m map[string]any) {
			r := rule("a", "", "r", "v")
			r["stem"] = nest(lemma.MaxPredDepth + 1)
			m["rules"] = []any{r}
		}, "nest"},
		{"notSuffix", func(m map[string]any) {
			r := rule("a", "", "r", "v")
			r["stem"] = map[string]any{"notSuffix": manyStrings(lemma.MaxNotSuffix, 3)}
			m["rules"] = []any{r}
		}, func(m map[string]any) {
			r := rule("a", "", "r", "v")
			r["stem"] = map[string]any{"notSuffix": manyStrings(lemma.MaxNotSuffix+1, 3)}
			m["rules"] = []any{r}
		}, "notSuffix"},
		{"notSuffix entry", func(m map[string]any) {
			r := rule("a", "", "r", "v")
			r["stem"] = map[string]any{"notSuffix": []any{long(lemma.MaxAffixRunes)}}
			m["rules"] = []any{r}
		}, func(m map[string]any) {
			r := rule("a", "", "r", "v")
			r["stem"] = map[string]any{"notSuffix": []any{long(lemma.MaxAffixRunes + 1)}}
			m["rules"] = []any{r}
		}, "notSuffix"},
		{"minRunes", func(m map[string]any) {
			r := rule("a", "", "r", "v")
			r["stem"] = map[string]any{"minRunes": lemma.MaxMinRunes}
			m["rules"] = []any{r}
		}, func(m map[string]any) {
			r := rule("a", "", "r", "v")
			r["stem"] = map[string]any{"minRunes": lemma.MaxMinRunes + 1}
			m["rules"] = []any{r}
		}, "minRunes"},
		{"version", func(m map[string]any) { m["version"] = long(lemma.MaxReasonRunes) }, func(m map[string]any) { m["version"] = long(lemma.MaxReasonRunes + 1) }, "version"},
		{"language", func(m map[string]any) { m["language"] = "pt-br" }, func(m map[string]any) { m["language"] = "PT_BR" }, "language"},
	}
	for _, c := range cases {
		at := base()
		c.at(at)
		if _, err := lemma.Parse(encode(t, at)); err != nil {
			t.Errorf("%s at the limit: %v", c.name, err)
		}
		over := base()
		c.over(over)
		if _, err := lemma.Parse(encode(t, over)); err == nil || !strings.Contains(err.Error(), c.reason) {
			t.Errorf("%s over the limit: Parse = %v, want an error naming %q", c.name, err, c.reason)
		}
	}
	for _, bad := range []any{-1, 0.5} {
		m := base()
		r := rule("a", "", "r", "v")
		r["stem"] = map[string]any{"minRunes": bad}
		m["rules"] = []any{r}
		if _, err := lemma.Parse(encode(t, m)); err == nil {
			t.Errorf("minRunes %v accepted", bad)
		}
	}
}

func rules(n int) []any {
	out := make([]any, n)
	for i := range out {
		out[i] = rule(fmt.Sprintf("s%d", i), "", "r", "v")
	}
	return out
}

func classes(n int) map[string]any {
	out := map[string]any{"v": map[string]any{"tags": []any{"v"}}}
	for i := 1; i < n; i++ {
		out[fmt.Sprintf("c%d", i)] = map[string]any{}
	}
	return out
}

func compounds(n int) []any {
	out := make([]any, n)
	for i := range out {
		out[i] = map[string]any{"suffix": fmt.Sprintf("k%d", i), "class": "v"}
	}
	return out
}

func repeat(s string, n int) []any {
	out := make([]any, n)
	for i := range out {
		out[i] = s
	}
	return out
}

// A table whose rules keep matching what earlier rules produced would
// multiply the candidates at every depth; one Deinflect stops at
// MaxCandidates, keeping the first ones in output order.
func TestDeinflectStopsAtMaxCandidates(t *testing.T) {
	m := base()
	m["maxDepth"] = 8
	var rs []any
	for i := range 100 {
		r := rule("a", fmt.Sprintf("a%c", 'A'+rune(i%26))+strings.Repeat("a", i/26+1), "r", "v")
		r["in"] = []any{"v"}
		rs = append(rs, r)
	}
	m["rules"] = rs
	tb, err := lemma.Parse(encode(t, m))
	if err != nil {
		t.Fatal(err)
	}
	got := tb.Deinflect("xa")
	if len(got) != lemma.MaxCandidates {
		t.Fatalf("Deinflect = %d candidates, want %d", len(got), lemma.MaxCandidates)
	}
	// Depth 0 produces 100 candidates in rule order: the first 64 of them.
	for i, c := range got {
		want := "x" + rs[i].(map[string]any)["to"].(string)
		if c.Form != want || len(c.Reasons) != 1 {
			t.Fatalf("candidate %d = %+v, want %s at depth 0", i, c, want)
		}
	}
}

// The Japanese table never comes near the bound: every substring of up to
// 12 code points of the contract fixtures yields at most 16 candidates.
func TestJapaneseTableStaysUnderTheBound(t *testing.T) {
	ja := lemma.For("ja")
	script := regexp.MustCompile(`[ぁ-んァ-ヶ一-龯ー々]+`)
	most, calls := 0, 0
	for _, name := range []string{"deinflect.json", "segment.json"} {
		raw, err := os.ReadFile(filepath.Join(contractDir, name))
		if err != nil {
			t.Fatal(err)
		}
		for _, run := range script.FindAllString(string(raw), -1) {
			r := []rune(run)
			for i := range r {
				for n := 1; n <= 12 && i+n <= len(r); n++ {
					calls++
					most = max(most, len(ja.Deinflect(string(r[i:i+n]))))
				}
			}
		}
	}
	if calls < 1000 || most > 16 || most >= lemma.MaxCandidates {
		t.Errorf("%d calls, at most %d candidates (bound %d)", calls, most, lemma.MaxCandidates)
	}
}

// The installed overlay wins over registered and built-in tables;
// clearing it restores them.
func TestInstalledOverlay(t *testing.T) {
	t.Cleanup(func() { lemma.SetInstalled(nil) })
	builtin := lemma.For("ja")
	m := base()
	m["language"] = "ja"
	ja := parse(t, string(encode(t, m)))
	m["language"] = "xo"
	xo := parse(t, string(encode(t, m)))
	lemma.SetInstalled(map[string]*lemma.Table{"ja": ja, "xo": xo})
	if lemma.For("JA") != ja || lemma.For("xo") != xo {
		t.Fatal("installed tables not in effect")
	}
	langs := lemma.Languages()
	if !strings.Contains(strings.Join(langs, ","), "ja") || !strings.Contains(strings.Join(langs, ","), "xo") {
		t.Errorf("Languages() = %v", langs)
	}
	m["language"] = "xp"
	xp := parse(t, string(encode(t, m)))
	lemma.Register(xp)
	if lemma.For("xp") != xp {
		t.Error("registered table hidden by an overlay without its language")
	}
	lemma.SetInstalled(nil)
	if lemma.For("ja") != builtin || lemma.For("xo") != nil {
		t.Error("clearing the overlay did not restore the built-in tables")
	}
	if b := lemma.Builtin("ja"); b != builtin {
		t.Error("Builtin(ja) is not the embedded table")
	}
}
