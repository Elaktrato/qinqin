package stats_test

import (
	"encoding/json"
	"os"
	"testing"
)

// docs/contracts/events/activity.json: the heatmap cells of the built-in
// activity rules (count, measure, distinct) over a case's events, bucketed
// by the learner day of its zone history. Pinned as built.

type activityCase struct {
	dayFixtureCase
	Note   string `json:"note"`
	Events []struct {
		ID        string          `json:"id"`
		TS        string          `json:"ts"`
		Type      string          `json:"type"`
		Workspace int64           `json:"workspace"`
		Payload   json.RawMessage `json:"payload"`
	} `json:"events"`
}

func TestContractActivity(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/events/activity.json")
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		Rule  string `json:"rule"`
		Rules []struct {
			Type string          `json:"type"`
			Rule json.RawMessage `json:"rule"`
		} `json:"rules"`
		Cases []activityCase `json:"cases"`
	}
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	if f.Rule != "events/activity" || len(f.Cases) < 10 {
		t.Fatalf("rule %q, %d cases", f.Rule, len(f.Cases))
	}
	// The fixture lists the built-in rules it was derived from.
	rules := builtinRules(t, newDB(t))
	if len(rules) != len(f.Rules) {
		t.Fatalf("%d built-in rules, fixture lists %d", len(rules), len(f.Rules))
	}
	for i, r := range rules {
		got, _ := json.Marshal(r.Rule)
		if r.Type != f.Rules[i].Type || !jsonEqual(got, f.Rules[i].Rule) {
			t.Errorf("rule %d: %s %s, fixture %s %s", i, r.Type, got, f.Rules[i].Type, f.Rules[i].Rule)
		}
	}
	for _, c := range f.Cases {
		t.Run(c.Name, func(t *testing.T) {
			if c.Note == "" {
				t.Error("case without note")
			}
			sqlDB := newDB(t)
			rules := builtinRules(t, sqlDB)
			u := newUser(t, sqlDB, "a")
			for _, ev := range c.Events {
				ws := ev.Workspace
				if ws == 0 {
					ws = 1
				}
				payload := string(ev.Payload)
				if payload == "null" {
					payload = ""
				}
				if ev.ID != "" {
					addID(t, sqlDB, u, ws, ev.ID, ev.TS, ev.Type, payload)
					continue
				}
				add(t, sqlDB, u, ws, ev.TS, ev.Type, payload)
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

func jsonEqual(a, b []byte) bool {
	var x, y any
	if json.Unmarshal(a, &x) != nil || json.Unmarshal(b, &y) != nil {
		return false
	}
	xa, _ := json.Marshal(x)
	ya, _ := json.Marshal(y)
	return string(xa) == string(ya)
}
