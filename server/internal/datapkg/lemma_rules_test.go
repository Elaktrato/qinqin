package datapkg_test

import "testing"

// A lemma-rules package (#176) carries the pack's rules.json exactly as
// imported, one row for its language.
func TestLemmaRulesPackageCarriesTheRawTable(t *testing.T) {
	s := seedAll(t)
	p := openPackage(t, build(t, s, "lemma-rules.ja-rules", 1).Path)
	got := p.strings(t, `SELECT language || '|' || rules_json FROM lemma_rules`)
	if len(got) != 1 || got[0] != "ja|"+jaRules {
		t.Errorf("lemma_rules = %q", got)
	}
	if lic := string(p.members["LICENSES/ja-rules/LICENSE"]); lic != "CC0\n" {
		t.Errorf("licence member = %q", lic)
	}
}
