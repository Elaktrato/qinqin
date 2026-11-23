package step032

import (
	"encoding/json"
	"os"
	"testing"
)

// The frozen key is what migration 032 computed when it shipped
// (testdata/username-keys-032.json, written once from the live function
// on 2026-11-23; never regenerate it). A failure means an upgrade of a
// v0.2.x database would now store different keys: keep the old behaviour.
func TestFrozenUsernameKeyMatchesThe032Fixture(t *testing.T) {
	raw, err := os.ReadFile("testdata/username-keys-032.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		Cases []struct {
			Name string `json:"name"`
			Note string `json:"note"`
			Key  string `json:"key"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	if len(fx.Cases) < 10 {
		t.Fatalf("fixture has %d cases", len(fx.Cases))
	}
	for _, c := range fx.Cases {
		if got := UsernameKey(c.Name); got != c.Key {
			t.Errorf("%s: UsernameKey(%q) = %q, want %q", c.Note, c.Name, got, c.Key)
		}
	}
}
