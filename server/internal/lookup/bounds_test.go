package lookup_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"qinqin/internal/lemma"
	"qinqin/internal/lookup"
)

// compoundsTable is the review's compound-heavy table: 64 cheap rules that
// multiply the forms and 64 compounds on the same suffix.
func compoundsTable(t *testing.T) *lemma.Table {
	t.Helper()
	var rules, comps []map[string]any
	for i := range 64 {
		rules = append(rules, map[string]any{"from": "a", "to": "a" + strings.Repeat(string(rune('b'+i%20)), 1+i/20) + "a", "reason": "g", "out": "w"})
		comps = append(comps, map[string]any{"suffix": "a", "class": "w", "stem": map[string]any{"minRunes": 1}})
	}
	raw, _ := json.Marshal(map[string]any{"format": 2, "language": "xq", "version": "t", "maxDepth": 8,
		"classes": map[string]any{"w": map[string]any{"any": true}}, "hints": map[string]any{}, "rules": rules, "compounds": comps})
	tb, err := lemma.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	return tb
}

// One lookup window has bounded probes: at most MaxProbes, at most one
// compound probe per (stem, class), and its Deinflect calls share
// MaxWindowWork.
func TestProbesAreBounded(t *testing.T) {
	tb := compoundsTable(t)
	n, compounds, dup, work := lookup.ProbeStats(tb, strings.Repeat("a", lookup.MaxWindowRunes))
	if n > lookup.MaxProbes || dup || work > lookup.MaxWindowWork || compounds == 0 {
		t.Errorf("probes %d (max %d), compound probes %d, duplicate %v, work %d (max %d)",
			n, lookup.MaxProbes, compounds, dup, work, lookup.MaxWindowWork)
	}
}

// The Japanese table stays well inside the window bounds on every window
// of the contract fixtures, so the bounds never change a Japanese lookup.
func TestJapaneseWindowsStayInsideTheBounds(t *testing.T) {
	ja := lemma.For("ja")
	script := regexp.MustCompile(`[ぁ-んァ-ヶ一-龯ー々]+`)
	mostProbes, mostWork := 0, 0
	for _, name := range []string{"deinflect.json", "segment.json"} {
		raw, err := os.ReadFile(filepath.Join("..", "..", "..", "docs", "contracts", "lemma", name))
		if err != nil {
			t.Fatal(err)
		}
		for _, run := range script.FindAllString(string(raw), -1) {
			r := []rune(run)
			for i := range r {
				n, _, _, work := lookup.ProbeStats(ja, string(r[i:min(i+lookup.MaxWindowRunes, len(r))]))
				mostProbes, mostWork = max(mostProbes, n), max(mostWork, work)
			}
		}
	}
	t.Logf("Japanese windows: at most %d probes, %d work units", mostProbes, mostWork)
	if mostProbes*2 > lookup.MaxProbes || mostWork*2 > lookup.MaxWindowWork {
		t.Errorf("Japanese windows need %d probes / %d work, bounds %d / %d", mostProbes, mostWork, lookup.MaxProbes, lookup.MaxWindowWork)
	}
}
