package segment_test

import (
	"context"
	"encoding/json"
	"fmt"
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
// dictionary stays bounded with the worst tables: every lookup window
// spends at most lookup.MaxWindowWork Deinflect units. The work is counted,
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
		// At most one window per rune, plus one per match for the boundary rule.
		limit := int64(2*len(text)) * lookup.MaxWindowWork
		t.Logf("%s: %d work units (limit %d) in %v", name, work, limit, took)
		if work > limit {
			t.Errorf("%s: %d work units, over %d", name, work, limit)
		}
		if took > 2*time.Minute {
			t.Errorf("%s: %v for 5,000 runes", name, took)
		}
	}
}
