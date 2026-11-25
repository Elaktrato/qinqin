package pack_test

import (
	"strings"
	"testing"

	"qinqin/internal/pack"
)

// A lemma-rules pack (#176) states one language and has the format
// rules-json, which no other type may use.
func TestManifestAcceptsLemmaRulesPacks(t *testing.T) {
	m := fixtureManifest
	m.ID, m.Type, m.Format = "ja-lemma", pack.TypeLemmaRules, pack.FormatRulesJSON
	if err := m.Validate(); err != nil {
		t.Fatalf("lemma-rules/rules-json: Validate = %v", err)
	}
	for name, mutate := range map[string]func(*pack.Manifest){
		"no language":  func(m *pack.Manifest) { m.Language = "" },
		"languages":    func(m *pack.Manifest) { m.Languages = []string{"ja"} },
		"other format": func(m *pack.Manifest) { m.Format = pack.FormatJSON },
	} {
		bad := m
		mutate(&bad)
		if err := bad.Validate(); err == nil {
			t.Errorf("%s: Validate = nil", name)
		}
	}
	other := fixtureManifest
	other.Format = pack.FormatRulesJSON
	if err := other.Validate(); err == nil || !strings.Contains(err.Error(), "rules-json") {
		t.Errorf("dictionary with rules-json: Validate = %v", err)
	}
	other = fixtureManifest
	other.Type = "nope"
	if err := other.Validate(); err == nil || !strings.Contains(err.Error(), "lemma-rules") {
		t.Errorf("unknown type error = %v, want it to list lemma-rules", err)
	}
	other = fixtureManifest
	other.Format = "nope"
	if err := other.Validate(); err == nil || !strings.Contains(err.Error(), "rules-json") {
		t.Errorf("unknown format error = %v, want it to list rules-json", err)
	}
}
