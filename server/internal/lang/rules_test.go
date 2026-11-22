package lang_test

import (
	"slices"
	"testing"

	"qinqin/internal/lang"
	"qinqin/internal/lemma"
)

// A language with a rule table but no code pack deinflects through the
// generic pack: lemmatization without Go code per language.
func TestTableOnlyLanguageDeinflects(t *testing.T) {
	tb, err := lemma.Parse([]byte(`{"format": 1, "language": "xr", "version": "t", "maxDepth": 2,
	 "classes": {"w": {"any": true}}, "hints": {},
	 "rules": [{"from": "aba", "to": "ar", "reason": "past", "out": "w"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	lemma.Register(tb)
	p := lang.For("xr")
	d, ok := p.(lang.Deinflector)
	if !ok {
		t.Fatalf("For(xr) = %T, want a Deinflector", p)
	}
	got := d.Deinflect("cantaba")
	if len(got) != 1 || got[0].Form != "cantar" || got[0].Reason != "past" || got[0].Class != "w" {
		t.Errorf("Deinflect(cantaba) = %+v", got)
	}
	if d.Rules() != tb || p.Code() != "xr" || p.NormalizeReading("latin", "Hola") != "hola" {
		t.Errorf("pack = %T code %q", p, p.Code())
	}
	if lang.Registered("xr") {
		t.Error("a table alone is not a registered code pack")
	}
	if _, ok := lang.For("yy").(lang.Deinflector); ok {
		t.Error("For(yy) deinflects without a table")
	}
}

func TestJaRunsOnTheTable(t *testing.T) {
	if (lang.Ja{}).Rules() != lemma.For("ja") {
		t.Fatal("Ja.Rules() is not the ja table")
	}
	want := lemma.For("ja").Deinflect("飲みました")
	got := (lang.Ja{}).Deinflect("飲みました")
	if len(got) != len(want) {
		t.Fatalf("Ja.Deinflect = %+v, table %+v", got, want)
	}
	for i := range got {
		if got[i].Form != want[i].Form || got[i].Class != want[i].Class || !slices.Equal(got[i].Reasons, want[i].Reasons) {
			t.Errorf("candidate %d: %+v, table %+v", i, got[i], want[i])
		}
	}
}
