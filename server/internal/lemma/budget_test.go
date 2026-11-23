package lemma_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"qinqin/internal/lemma"
)

// docs/contracts/lemma/budget.json: the work one Deinflect call spends and
// where the budget stops it, unit for unit.
func TestContractBudget(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join(contractDir, "budget.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		Version int    `json:"version"`
		Rule    string `json:"rule"`
		Doc     string `json:"_doc"`
		MaxWork int    `json:"maxWork"`
		Cases   []struct {
			Name    string          `json:"name"`
			Surface string          `json:"surface"`
			Budget  int             `json:"budget"`
			Table   json.RawMessage `json:"table"`
			Work    int             `json:"work"`
			Forms   []string        `json:"forms"`
		} `json:"cases"`
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&fx); err != nil {
		t.Fatal(err)
	}
	if fx.Version != 1 || fx.Rule != "lemma/budget" || fx.MaxWork != lemma.MaxWork || len(fx.Cases) < 5 {
		t.Fatalf("header %d %q maxWork %d (engine %d), %d cases", fx.Version, fx.Rule, fx.MaxWork, lemma.MaxWork, len(fx.Cases))
	}
	for _, c := range fx.Cases {
		tb, err := lemma.Parse(c.Table)
		if err != nil {
			t.Fatalf("%s: %v", c.Name, err)
		}
		budget := c.Budget
		if budget == 0 {
			budget = lemma.MaxWork
		}
		got, work := tb.DeinflectBudget(c.Surface, budget)
		forms := []string{}
		for _, g := range got {
			forms = append(forms, g.Form)
		}
		if work != c.Work || !slices.Equal(forms, c.Forms) {
			t.Errorf("%s: work %d forms %v, want %d %v", c.Name, work, forms, c.Work, c.Forms)
		}
	}
}

// heavyTable is the review's worst case within the limits: cheap rules that
// multiply the forms, then chain-only rules whose expensive predicates fail.
func heavyTable(t *testing.T) *lemma.Table {
	t.Helper()
	var rules []any
	for i := range 63 {
		rules = append(rules, rule("a", "a"+strings.Repeat(string(rune('b'+i%20)), 1+i/20)+"a", "g", "w"))
	}
	ns := make([]any, 16)
	for j := range ns {
		ns[j] = fmt.Sprintf("z%03d", j)
	}
	// As many failing predicates as the table-wide predicate limits allow,
	// then plain chain-only rules up to MaxRules.
	allOf := []any{map[string]any{"notSuffix": ns}, map[string]any{"minRunes": 64}}
	for i := 0; len(rules) < lemma.MaxRules; i++ {
		r := rule("a", "", "h", "w")
		r["in"], r["chainOnly"] = []any{"w"}, true
		if i < lemma.MaxTableNotSuffix/len(ns) {
			r["stem"] = map[string]any{"allOf": allOf}
		}
		rules = append(rules, r)
	}
	m := map[string]any{"format": 2, "language": "xq", "version": "t", "maxDepth": 8,
		"classes": map[string]any{"w": map[string]any{"any": true}}, "hints": map[string]any{}, "rules": rules}
	tb, err := lemma.Parse(encode(t, m))
	if err != nil {
		t.Fatal(err)
	}
	return tb
}

// No call spends more than MaxWork, however heavy the table.
func TestDeinflectStaysWithinTheWorkBudget(t *testing.T) {
	tb := heavyTable(t)
	for _, s := range []string{"a", "aaaa", strings.Repeat("a", 12)} {
		_, work := tb.DeinflectBudget(s, lemma.MaxWork)
		if work > lemma.MaxWork {
			t.Errorf("%q: work %d over %d", s, work, lemma.MaxWork)
		}
	}
	before := lemma.WorkDone()
	tb.Deinflect("aaa")
	if spent := lemma.WorkDone() - before; spent == 0 || spent > lemma.MaxWork {
		t.Errorf("WorkDone grew by %d", spent)
	}
}

// The Japanese table spends at most a third of the budget on any
// substring of the contract fixtures: the budget never changes its output.
func TestJapaneseTableStaysUnderTheWorkBudget(t *testing.T) {
	most := 0
	forEachFixtureSubstring(t, func(s string) {
		_, work := lemma.For("ja").DeinflectBudget(s, lemma.MaxWork)
		most = max(most, work)
	})
	if most == 0 || most*3 > lemma.MaxWork {
		t.Errorf("Japanese spends up to %d work units, budget %d", most, lemma.MaxWork)
	}
	t.Logf("Japanese: at most %d work units per call", most)
}

// Predicates are capped in size per table: children of allOf/anyOf, all
// notSuffix entries, all predicate nodes.
func TestPredicateSizeLimits(t *testing.T) {
	with := func(stems ...map[string]any) map[string]any {
		m := base()
		var rs []any
		for i, s := range stems {
			r := rule(fmt.Sprintf("s%d", i), "", "r", "v")
			r["stem"] = s
			rs = append(rs, r)
		}
		m["rules"] = rs
		return m
	}
	children := func(n int) []any {
		out := make([]any, n)
		for i := range out {
			out[i] = map[string]any{"minRunes": 1}
		}
		return out
	}
	notSuffix := func(n int) map[string]any { return map[string]any{"notSuffix": manyStrings(n, 3)} }
	many := func(n int, p map[string]any) []map[string]any {
		out := make([]map[string]any, n)
		for i := range out {
			out[i] = p
		}
		return out
	}
	for _, c := range []struct {
		name     string
		at, over map[string]any
		reason   string
	}{
		{"allOf children", with(map[string]any{"allOf": children(lemma.MaxPredChildren)}), with(map[string]any{"allOf": children(lemma.MaxPredChildren + 1)}), "children"},
		{"anyOf children", with(map[string]any{"anyOf": children(lemma.MaxPredChildren)}), with(map[string]any{"anyOf": children(lemma.MaxPredChildren + 1)}), "children"},
		{"notSuffix per table", with(many(lemma.MaxTableNotSuffix/256, notSuffix(256))...), with(append(many(lemma.MaxTableNotSuffix/256, notSuffix(256)), notSuffix(1))...), "notSuffix"},
		{"predicate nodes per table", with(many(lemma.MaxTablePredNodes/16, map[string]any{"allOf": children(15)})...),
			with(append(many(lemma.MaxTablePredNodes/16, map[string]any{"allOf": children(15)}), map[string]any{"minRunes": 1})...), "predicate nodes"},
	} {
		if _, err := lemma.Parse(encode(t, c.at)); err != nil {
			t.Errorf("%s at the limit: %v", c.name, err)
		}
		if _, err := lemma.Parse(encode(t, c.over)); err == nil || !strings.Contains(err.Error(), c.reason) {
			t.Errorf("%s over the limit: %v, want an error naming %q", c.name, err, c.reason)
		}
	}
}
