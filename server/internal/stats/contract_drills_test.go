package stats_test

import (
	"encoding/json"
	"os"
	"slices"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/drills"
	"qinqin/internal/stats"
)

// docs/contracts/drills/counting.json, activity: the heatmap cells of the
// drills a server registered (one count rule per drill, feature practice).
// The cases name their own registry, so the rules are checked while the
// server's own registry (drills.IDs) is still empty.
func TestContractDrillActivity(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/drills/counting.json")
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		Rule     string `json:"rule"`
		Activity struct {
			Registered []string `json:"registered"`
			Rules      []struct {
				Type string          `json:"type"`
				Rule json.RawMessage `json:"rule"`
			} `json:"rules"`
			Cases []activityCase `json:"cases"`
		} `json:"activity"`
	}
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	if f.Rule != "drills/counting" || len(f.Activity.Cases) < 3 {
		t.Fatalf("rule %q, %d cases", f.Rule, len(f.Activity.Cases))
	}
	rules := stats.DrillRules(f.Activity.Registered)
	if len(rules) != len(f.Activity.Rules) {
		t.Fatalf("%d rules, fixture lists %d", len(rules), len(f.Activity.Rules))
	}
	for i, r := range rules {
		got, _ := json.Marshal(r)
		if r.Type != f.Activity.Rules[i].Type || !jsonEqual(got, f.Activity.Rules[i].Rule) {
			t.Errorf("rule %d: %s %s, fixture %s %s", i, r.Type, got, f.Activity.Rules[i].Type, f.Activity.Rules[i].Rule)
		}
	}
	for _, c := range f.Activity.Cases {
		t.Run(c.Name, func(t *testing.T) {
			if c.Note == "" {
				t.Error("case without note")
			}
			sqlDB := dbtest.Open(t)
			u := newUser(t, sqlDB, "a")
			for _, ev := range c.Events {
				ws := ev.Workspace
				if ws == 0 {
					ws = 1
				}
				add(t, sqlDB, u, ws, ev.TS, ev.Type, string(ev.Payload))
			}
			got := runIn(t, sqlDB, u, c.studyHistory(t), c.From, c.To, nil, rules)
			if len(got) != len(c.Cells) {
				t.Fatalf("got %+v, want %+v", got, c.Cells)
			}
			for i, w := range c.Cells {
				g := got[i]
				if g.Day != w.Day || g.Workspace != w.Workspace || g.Type != w.Type || g.Points != w.Points || g.Raw != w.Raw {
					t.Errorf("cell %d = %+v, want %+v", i, g, w)
				}
			}
		})
	}
}

// The built-in rules end with one rule per registered drill.
func TestBuiltinRulesCountRegisteredDrills(t *testing.T) {
	tail := stats.Rules[len(stats.Rules)-len(drills.IDs):]
	if !slices.Equal(typesOf(tail), typesOf(stats.DrillRules(drills.IDs))) {
		t.Errorf("rules end with %v, want the drills %v", typesOf(tail), drills.IDs)
	}
	for _, r := range stats.DrillRules([]string{"tone-pairs"}) {
		if r.Type != "drill.tone-pairs" || r.Feature != drills.Feature || r.Kind() != stats.KindCount {
			t.Errorf("drill rule %+v", r)
		}
	}
}

func typesOf(rules []stats.Rule) []string {
	out := []string{}
	for _, r := range rules {
		out = append(out, r.Type)
	}
	return out
}
