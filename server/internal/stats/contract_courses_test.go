package stats_test

import (
	"encoding/json"
	"os"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/stats"
)

// docs/contracts/courses/counting.json, activity: the heatmap cells of course
// steps (#225): one point per finished lesson (not a grammar lesson), unit
// test or section exam, once per step per learner day.
func TestContractCourseActivity(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/courses/counting.json")
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		Rule     string `json:"rule"`
		Activity struct {
			Rules []struct {
				Type string          `json:"type"`
				Rule json.RawMessage `json:"rule"`
			} `json:"rules"`
			Cases []activityCase `json:"cases"`
		} `json:"activity"`
	}
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	if f.Rule != "courses/counting" || len(f.Activity.Cases) < 5 || len(f.Activity.Rules) != 1 {
		t.Fatalf("rule %q, %d cases, %d rules", f.Rule, len(f.Activity.Cases), len(f.Activity.Rules))
	}
	var rule *stats.Rule
	for i := range stats.Rules {
		if stats.Rules[i].Type == f.Activity.Rules[0].Type {
			rule = &stats.Rules[i]
		}
	}
	if rule == nil {
		t.Fatalf("no built-in rule of type %q", f.Activity.Rules[0].Type)
	}
	got, _ := json.Marshal(rule)
	if !jsonEqual(got, f.Activity.Rules[0].Rule) || rule.Kind() != stats.KindDistinct {
		t.Fatalf("rule %s (%s), fixture %s", got, rule.Kind(), f.Activity.Rules[0].Rule)
	}
	rules := []stats.Rule{*rule}
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
			cells := runIn(t, sqlDB, u, c.studyHistory(t), c.From, c.To, nil, rules)
			if len(cells) != len(c.Cells) {
				t.Fatalf("got %+v, want %+v", cells, c.Cells)
			}
			for i, w := range c.Cells {
				g := cells[i]
				if g.Day != w.Day || g.Workspace != w.Workspace || g.Type != w.Type || g.Points != w.Points || g.Raw != w.Raw {
					t.Errorf("cell %d = %+v, want %+v", i, g, w)
				}
			}
		})
	}
}
