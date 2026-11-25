package packs_test

import (
	"context"
	"errors"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/lemma"
	"qinqin/internal/packs"
)

const xaRules = `{"format": 2, "language": "es", "version": "t", "maxDepth": 1,
 "classes": {"ar": {"tags": ["v"]}}, "hints": {},
 "rules": [{"from": "aba", "to": "ar", "reason": "past", "out": "ar"}]}`

// lemma-rules packs import, list and uninstall through packs (#176), and
// take effect at once.
func TestLemmaRulesPacks(t *testing.T) {
	sqlDB := dbtest.Open(t)
	t.Cleanup(func() { lemma.SetInstalled(nil) })
	ctx := context.Background()
	var changed []string
	p := buildPack(t, "lemma-rules", "es-rules", "Spanish rules", "CC0-1.0", "rules-json", map[string]string{"rules.json": xaRules})
	got, err := packs.Import(ctx, sqlDB, p, packs.WithOnChange(func(typ, id, lang string) { changed = append(changed, typ+"/"+id+"/"+lang) }))
	if err != nil || got != "1 rules (es)" {
		t.Fatalf("Import = %q, %v", got, err)
	}
	if len(changed) != 1 || changed[0] != "lemma-rules/es-rules/es" {
		t.Errorf("onChange = %v", changed)
	}
	if lemma.For("es") == nil {
		t.Error("table not in effect after the import")
	}
	found, err := packs.Find(ctx, sqlDB, "lemma-rules", "es-rules")
	if err != nil || found.Language != "es" || found.License != "CC0-1.0" || found.Notice != "A notice." {
		t.Errorf("Find = %+v, %v", found, err)
	}
	if err := packs.Uninstall(ctx, sqlDB, "lemma-rules", "es-rules"); err != nil {
		t.Fatal(err)
	}
	if lemma.For("es") != nil {
		t.Error("table still in effect after the uninstall")
	}
	if err := packs.Uninstall(ctx, sqlDB, "lemma-rules", "es-rules"); !errors.Is(err, packs.ErrNotFound) {
		t.Errorf("second uninstall = %v", err)
	}
}
