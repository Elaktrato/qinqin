package grammar

import (
	"encoding/json"
	"os"
	"testing"
	"time"
)

// docs/contracts/grammar/runs.json: the payload a run is written with and the
// conversion of an old progress row (legacy) that a restore of an older
// backup applies. The migration's frozen copy is checked against the same
// cases (internal/db/migrate_056_test.go).
func TestRunsContract(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/grammar/runs.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		Rule      string `json:"rule"`
		Constants struct {
			MaxExercises int `json:"maxExercises"`
		} `json:"constants"`
		Build []struct {
			Name   string          `json:"name"`
			Args   []any           `json:"args"`
			Expect json.RawMessage `json:"expect"`
		} `json:"build"`
		Legacy []struct {
			Name      string          `json:"name"`
			Key       string          `json:"key"`
			Data      json.RawMessage `json:"data"`
			UpdatedAt string          `json:"updatedAt"`
			Expect    *struct {
				TS      string          `json:"ts"`
				Payload json.RawMessage `json:"payload"`
			} `json:"expect"`
		} `json:"legacy"`
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	if fx.Rule != "grammar/runs" || fx.Constants.MaxExercises != MaxExercises || len(fx.Build) == 0 || len(fx.Legacy) < 5 {
		t.Fatalf("fixture: rule %q, max %d, %d build, %d legacy", fx.Rule, fx.Constants.MaxExercises, len(fx.Build), len(fx.Legacy))
	}
	for _, c := range fx.Build {
		got := Payload(c.Args[0].(string), c.Args[1].(string), int(c.Args[2].(float64)), int(c.Args[3].(float64)))
		if !sameText(got, c.Expect) {
			t.Errorf("build %s: %s, want %s", c.Name, got, c.Expect)
		}
	}
	for _, c := range fx.Legacy {
		ts, payload, ok := LegacyEvent(c.Key, c.Data, c.UpdatedAt)
		if c.Expect == nil {
			if ok {
				t.Errorf("%s: converted to %s %s, want dropped", c.Name, ts, payload)
			}
			continue
		}
		if !ok || ts.Format(time.RFC3339) != c.Expect.TS || !sameText(payload, c.Expect.Payload) {
			t.Errorf("%s: %v %s %s, want %s %s", c.Name, ok, ts.Format(time.RFC3339), payload, c.Expect.TS, c.Expect.Payload)
		}
	}
	if _, _, ok := LegacyEvent("grammar:progress:p:l", json.RawMessage(`{"completedAt":"0001-01-01T00:00:00Z","best":1,"total":1}`), "x"); ok {
		t.Error("a time before 1970 cannot be an event id's time")
	}
}

// sameText compares JSON texts with the whitespace removed, member order kept.
func sameText(a, b json.RawMessage) bool {
	var x, y any
	ca, _ := json.Marshal(json.RawMessage(a))
	cb, _ := json.Marshal(json.RawMessage(b))
	return json.Unmarshal(a, &x) == nil && json.Unmarshal(b, &y) == nil && string(ca) == string(cb)
}
