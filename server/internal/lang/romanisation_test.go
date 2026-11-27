package lang_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"testing"

	. "qinqin/internal/lang"
)

// docs/contracts/settings/romanisation.json (#284): the reading types a
// client may hide are exactly the profiles' romanisations, each language
// lists the ones of its profile, and they are reading types the server
// sends (the server keeps deriving them; only the clients hide them).
func TestRomanisationFixture(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "docs", "contracts", "settings", "romanisation.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		Rule      string            `json:"rule"`
		Key       string            `json:"key"`
		Types     []string          `json:"types"`
		Modes     []string          `json:"modes"`
		Defaults  map[string]string `json:"defaults"`
		Languages []struct {
			Language string   `json:"language"`
			Types    []string `json:"types"`
		} `json:"languages"`
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	if fx.Rule != "settings/romanisation" || fx.Key != "romanisation" || !reflect.DeepEqual(fx.Modes, []string{"always", "never"}) {
		t.Fatalf("rule %q key %q modes %v", fx.Rule, fx.Key, fx.Modes)
	}
	var union []string
	for _, p := range Profiles {
		for _, r := range p.Romanisations {
			if !slices.Contains(union, r) {
				union = append(union, r)
			}
		}
	}
	if !reflect.DeepEqual(union, fx.Types) {
		t.Errorf("profiles' romanisations %v, fixture types %v", union, fx.Types)
	}
	for _, typ := range fx.Types {
		if fx.Defaults[typ] != "always" {
			t.Errorf("default of %s = %q, want always", typ, fx.Defaults[typ])
		}
	}
	for _, c := range fx.Languages {
		if got := ProfileOf(c.Language).Romanisations; !reflect.DeepEqual(got, c.Types) {
			t.Errorf("romanisations of %q = %v, want %v", c.Language, got, c.Types)
		}
	}
}
