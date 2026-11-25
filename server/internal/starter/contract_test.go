package starter_test

import (
	"encoding/json"
	"os"
	"testing"

	"qinqin/internal/starter"
)

// TestSetFormatContract runs docs/contracts/starter/set.json: which set files Parse accepts.
func TestSetFormatContract(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/starter/set.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Rule  string `json:"rule"`
		Cases []struct {
			Name  string          `json:"name"`
			Valid bool            `json:"valid"`
			Set   json.RawMessage `json:"set"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	if fixture.Rule != "starter/set" || len(fixture.Cases) == 0 {
		t.Fatalf("fixture rule %q with %d cases", fixture.Rule, len(fixture.Cases))
	}
	for _, c := range fixture.Cases {
		_, err := starter.Parse(c.Set)
		if c.Valid && err != nil {
			t.Errorf("%s: refused: %v", c.Name, err)
		}
		if !c.Valid && err == nil {
			t.Errorf("%s: accepted, want a refusal", c.Name)
		}
	}
}
