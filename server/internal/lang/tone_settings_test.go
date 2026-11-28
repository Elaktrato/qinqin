package lang_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	. "qinqin/internal/lang"
)

// docs/contracts/settings/tones.json (#300): the workspace setting `tones`
// (Show tone sandhi, Grade spoken tones) has switches exactly in the
// languages whose profile has tones, and its defaults are sandhi shown and
// citation tones graded.
func TestToneSettingsFixture(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "docs", "contracts", "settings", "tones.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		Rule      string          `json:"rule"`
		Key       string          `json:"key"`
		Members   []string        `json:"members"`
		Defaults  map[string]bool `json:"defaults"`
		Languages []struct {
			Language string `json:"language"`
			Switches bool   `json:"switches"`
		} `json:"languages"`
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	if fx.Rule != "settings/tones" || fx.Key != "tones" || !reflect.DeepEqual(fx.Members, []string{"showSandhi", "gradeSpoken"}) {
		t.Fatalf("rule %q key %q members %v", fx.Rule, fx.Key, fx.Members)
	}
	if !reflect.DeepEqual(fx.Defaults, map[string]bool{"showSandhi": true, "gradeSpoken": false}) {
		t.Errorf("defaults %v", fx.Defaults)
	}
	tonal := 0
	for _, c := range fx.Languages {
		if got := ProfileOf(c.Language).Tones; got != c.Switches {
			t.Errorf("tones of %q = %v, want %v", c.Language, got, c.Switches)
		}
		if c.Switches {
			tonal++
		}
	}
	if tonal == 0 {
		t.Error("no tonal language in the fixture")
	}
}
