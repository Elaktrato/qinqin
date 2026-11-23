package segment_test

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"qinqin/internal/dict"
	"qinqin/internal/lemma"
	"qinqin/internal/lookup"
)

// worstTables are the review's two worst tables within the limits: heavy
// (rules that multiply the forms, then chain-only rules whose predicates
// fail as late as the predicate limits allow) and compounds (64 compounds
// on the suffix every form ends in).
func worstTables(t *testing.T) map[string]*lemma.Table {
	t.Helper()
	gen := func(i int) map[string]any {
		return map[string]any{"from": "a", "to": "a" + strings.Repeat(string(rune('b'+i%20)), 1+i/20) + "a", "reason": "g", "out": "w"}
	}
	ns := make([]string, 16)
	for j := range ns {
		ns[j] = fmt.Sprintf("z%03d", j)
	}
	var heavy []map[string]any
	for i := range 63 {
		heavy = append(heavy, gen(i))
	}
	for i := 0; len(heavy) < lemma.MaxRules; i++ {
		r := map[string]any{"from": "a", "to": "", "reason": "h", "out": "w", "in": []string{"w"}, "chainOnly": true}
		if i < lemma.MaxTableNotSuffix/len(ns) {
			r["stem"] = map[string]any{"allOf": []any{map[string]any{"notSuffix": ns}, map[string]any{"minRunes": 64}}}
		}
		heavy = append(heavy, r)
	}
	var light, comps []map[string]any
	for i := range 64 {
		light = append(light, gen(i))
		comps = append(comps, map[string]any{"suffix": "a", "class": "w", "stem": map[string]any{"minRunes": 1}})
	}
	out := map[string]*lemma.Table{}
	for name, extra := range map[string]map[string]any{
		"heavy":     {"rules": heavy},
		"compounds": {"rules": light, "compounds": comps},
	} {
		m := map[string]any{"format": 2, "language": "xq", "version": name, "maxDepth": 8,
			"classes": map[string]any{"w": map[string]any{"any": true}}, "hints": map[string]any{}}
		for k, v := range extra {
			m[k] = v
		}
		raw, _ := json.Marshal(m)
		tb, err := lemma.Parse(raw)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		out[name] = tb
	}
	return out
}

// Segmenting 5,000 runes of "a" in a data-only language with a one-word
// dictionary stays bounded with the worst tables: the whole request spends
// at most lookup.MaxRequestWork units. The work is counted,
// not timed; the time bound is only a generous backstop.
func TestSegmentationWorkIsBounded(t *testing.T) {
	t.Cleanup(func() { lemma.SetInstalled(nil) })
	sqlDB := openDB(t)
	importPack(t, sqlDB, dict.Manifest{ID: "xq-dict", Name: "xq", Version: "1", Type: "dictionary", Language: "xq",
		License: "CC0-1.0", Attribution: "test", Format: "json"}, "dictionary.json",
		`{"entries": [{"written": "aba", "kind": "word", "readings": [{"type": "latin", "value": "aba"}], "glosses": ["x"]}]}`)
	svc := service(sqlDB)
	text := strings.Repeat("a", 5000)
	for name, tb := range worstTables(t) {
		lemma.SetInstalled(map[string]*lemma.Table{"xq": tb})
		before, start := lemma.WorkDone(), time.Now()
		if _, err := svc.Segment(context.Background(), "xq", text); err != nil {
			t.Fatal(err)
		}
		work, took := lemma.WorkDone()-before, time.Since(start)
		// The whole request shares lookup.MaxRequestWork.
		limit := int64(lookup.MaxRequestWork)
		t.Logf("%s: %d work units (limit %d) in %v", name, work, limit, took)
		if work > limit {
			t.Errorf("%s: %d work units, over %d", name, work, limit)
		}
		if took > 2*time.Minute {
			t.Errorf("%s: %v for 5,000 runes", name, took)
		}
	}
}

// notOnlyTable is the second review's table: one rule that grows every
// form by 31 é (chaining to depth 7), 1,023 chain-only rules whose stem
// predicate scans the whole growing stem, and 64 compounds that scan it
// twice more.
func notOnlyTable(t *testing.T) *lemma.Table {
	t.Helper()
	rules := []map[string]any{{"from": "a", "to": strings.Repeat("é", 31) + "a", "reason": "g", "out": "w", "in": []string{"w"}}}
	for len(rules) < lemma.MaxRules {
		rules = append(rules, map[string]any{"from": "a", "to": "", "reason": "h", "out": "w", "in": []string{"w"}, "chainOnly": true,
			"stem": map[string]any{"notOnly": "latin"}})
	}
	var comps []map[string]any
	for range 64 {
		comps = append(comps, map[string]any{"suffix": "a", "class": "w",
			"stem": map[string]any{"allOf": []any{map[string]any{"notOnly": "kana"}, map[string]any{"notOnly": "han"}}}})
	}
	raw, _ := json.Marshal(map[string]any{"format": 2, "language": "xq", "version": "notonly", "maxDepth": 8,
		"classes": map[string]any{"w": map[string]any{"any": true}}, "hints": map[string]any{}, "rules": rules, "compounds": comps})
	tb, err := lemma.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	return tb
}

// requestWorkLimit is the per-request budget the test holds segmentation to.
const requestWorkLimit = lookup.MaxRequestWork

// The second review's worst case: 5,000 runes with the notOnly+compounds
// table stay within one request's work budget (counted, not timed; the time
// bound is only a backstop).
func TestSegmentationRequestWorkIsBounded(t *testing.T) {
	t.Cleanup(func() { lemma.SetInstalled(nil) })
	svc := service(openDB(t)) // no dictionary: a window at every rune
	lemma.SetInstalled(map[string]*lemma.Table{"xq": notOnlyTable(t)})
	before, start := lemma.WorkDone(), time.Now()
	if _, err := svc.Segment(context.Background(), "xq", strings.Repeat("a", 5000)); err != nil {
		t.Fatal(err)
	}
	work, took := lemma.WorkDone()-before, time.Since(start)
	t.Logf("notOnly table: %d work units in %v", work, took)
	if work > requestWorkLimit {
		t.Errorf("%d work units, over the request budget %d", work, requestWorkLimit)
	}
	if took > 2*time.Minute {
		t.Errorf("%v for 5,000 runes", took)
	}
}

// The Japanese table needs a tenth of the request budget at most on
// 5,000 runes of real Japanese (the grammar pack's examples) with no
// dictionary match at all, the worst case: a window at every rune.
func TestJapaneseRequestStaysFarUnderTheBudget(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "plugins", "data", "ja-grammar", "lessons.json"))
	if err != nil {
		t.Fatal(err)
	}
	var text []rune
	for _, m := range regexp.MustCompile(`"text":\s*"([^"]+)"`).FindAllStringSubmatch(string(raw), -1) {
		text = append(text, []rune(m[1])...)
		if len(text) >= 5000 {
			break
		}
	}
	text = text[:5000]
	svc := service(openDB(t))
	before := lemma.WorkDone()
	if _, err := svc.Segment(context.Background(), "ja", string(text)); err != nil {
		t.Fatal(err)
	}
	work := lemma.WorkDone() - before
	t.Logf("Japanese, 5,000 runes, no dictionary: %d Deinflect units (request budget %d)", work, lookup.MaxRequestWork)
	if work*10 > lookup.MaxRequestWork {
		t.Errorf("Japanese needs %d units, more than a tenth of %d", work, lookup.MaxRequestWork)
	}
}
