package graded_test

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"qinqin/internal/library/sources/graded"
)

const contractDir = "../../../../../docs/contracts/graded"

func decodeFixture(t *testing.T, name string, v any) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(contractDir, name))
	if err != nil {
		t.Fatal(err)
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		t.Fatalf("%s: %v", name, err)
	}
}

// TestFormatContract: the text file format (format.json): the valid files parse, every other one is refused with
// its reason.
func TestFormatContract(t *testing.T) {
	var fx struct {
		Version int    `json:"version"`
		Rule    string `json:"rule"`
		Doc     string `json:"doc"`
		Cases   []struct {
			Name  string          `json:"name"`
			File  json.RawMessage `json:"file"`
			Error string          `json:"error"`
		} `json:"cases"`
	}
	decodeFixture(t, "format.json", &fx)
	if fx.Rule != "graded/format" || len(fx.Cases) == 0 {
		t.Fatalf("rule %q, %d cases", fx.Rule, len(fx.Cases))
	}
	for _, c := range fx.Cases {
		t.Run(c.Name, func(t *testing.T) {
			f, err := graded.Parse(c.File)
			if c.Error == "" {
				if err != nil {
					t.Fatalf("Parse: %v", err)
				}
				if len(f.Texts) == 0 {
					t.Fatal("no texts")
				}
				return
			}
			if err == nil {
				t.Fatalf("Parse accepted it, want an error with %q", c.Error)
			}
			if !strings.Contains(err.Error(), c.Error) {
				t.Fatalf("Parse: %v, want %q in it", err, c.Error)
			}
		})
	}
}

type ruleCase struct {
	Name     string         `json:"name"`
	Text     string         `json:"text"`
	Names    []string       `json:"names"`
	Levels   int            `json:"levels"`
	Declared int            `json:"declared"`
	Glosses  []string       `json:"glosses"`
	Tokens   []graded.Token `json:"tokens"`
	Want     ruleWant       `json:"want"`
}

type ruleWant struct {
	Counted       int      `json:"counted"`
	Within        int      `json:"within"`
	Above         []string `json:"above"`
	ComputedLevel *int     `json:"computedLevel"`
	Unglossed     []string `json:"unglossed"`
	OK            bool     `json:"ok"`
}

// TestLevelRuleContract: the level rule (level-rule.json) — what is counted, the coverage and above-level words at
// the declared level, the computed level and the glosses check.
func TestLevelRuleContract(t *testing.T) {
	var fx struct {
		Version            int        `json:"version"`
		Rule               string     `json:"rule"`
		Doc                string     `json:"doc"`
		MinCoveragePercent int        `json:"minCoveragePercent"`
		MaxAbove           int        `json:"maxAbove"`
		Cases              []ruleCase `json:"cases"`
	}
	decodeFixture(t, "level-rule.json", &fx)
	if fx.Rule != "graded/level-rule" || len(fx.Cases) == 0 {
		t.Fatalf("rule %q, %d cases", fx.Rule, len(fx.Cases))
	}
	if fx.MinCoveragePercent != graded.MinCoveragePercent || fx.MaxAbove != graded.MaxAbove {
		t.Fatalf("fixture %d %% / %d, code %d %% / %d", fx.MinCoveragePercent, fx.MaxAbove, graded.MinCoveragePercent, graded.MaxAbove)
	}
	for _, c := range fx.Cases {
		t.Run(c.Name, func(t *testing.T) {
			r := graded.Check(c.Text, c.Names, c.Tokens, c.Levels, c.Declared, c.Glosses)
			got := ruleWant{Counted: r.Counted, Within: r.Within, Above: r.Above, ComputedLevel: r.ComputedLevel, Unglossed: r.Unglossed, OK: r.OK}
			if got.Above == nil {
				got.Above = []string{}
			}
			if got.Unglossed == nil {
				got.Unglossed = []string{}
			}
			if got.Counted != c.Want.Counted || got.Within != c.Want.Within || !slices.Equal(got.Above, c.Want.Above) ||
				!slices.Equal(got.Unglossed, c.Want.Unglossed) || got.OK != c.Want.OK || !sameLevel(got.ComputedLevel, c.Want.ComputedLevel) {
				gj, _ := json.Marshal(got)
				wj, _ := json.Marshal(c.Want)
				t.Fatalf("got  %s\nwant %s", gj, wj)
			}
		})
	}
}

func sameLevel(a, b *int) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}
