package lexicon_test

import (
	"context"
	"slices"
	"strings"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/lexicon"
	"qinqin/internal/realdict"
)

// The issue's words (#345) on the shipped CC-CEDICT and JMdict, imported
// with the real importer: the first unit is an everyday meaning, and every
// slang, vulgar or derogatory line is folded behind it.
func TestDisplaySensesOnTheShippedDictionaries(t *testing.T) {
	sqlDB := dbtest.Open(t)
	realdict.Import(t, sqlDB, "zh", "鸡", "鸭子", "黄色", "草", "鸟", "干")
	realdict.Import(t, sqlDB, "ja", "犬", "猫", "山")
	store := lexicon.Store{DB: sqlDB}
	ctx := context.Background()
	for _, c := range []struct {
		language, kind, form string
		first                string   // the first gloss shown
		folded               []string // each is a gloss of a folded unit
	}{
		{"zh", "character", "鸡", "fowl", []string{"(slang) prostitute"}},
		{"zh", "word", "鸭子", "duck (CL:隻|只[zhi1])", []string{"(slang) male prostitute"}},
		{"zh", "word", "黄色", "yellow", []string{"vulgar; lewd; pornographic"}},
		{"zh", "character", "草", "", []string{"variant of 肏[cao4]"}},
		{"zh", "character", "鸟", "", []string{"penis"}},
		{"zh", "character", "干", "", []string{"to fuck (vulgar)", "to kill (slang)"}},
		{"ja", "word", "犬", "dog (Canis (lupus) familiaris)", []string{"squealer", "asshole"}},
		{"ja", "word", "猫", "cat (esp. the domestic cat, Felis catus)", []string{"bottom (submissive partner of a homosexual relationship)"}},
		{"ja", "word", "山", "mountain", []string{"(criminal) case"}},
	} {
		e, err := store.Best(ctx, c.language, c.kind, c.form)
		if err != nil {
			t.Fatalf("%s: %v", c.form, err)
		}
		units := lexicon.DisplaySenses(e.Senses, "")
		if len(units) == 0 || units[0].Folded || units[0].Class != lexicon.ClassEveryday {
			t.Fatalf("%s: units %+v", c.form, units)
		}
		if c.first != "" && units[0].Glosses[0] != c.first {
			t.Errorf("%s: first gloss %q, want %q", c.form, units[0].Glosses[0], c.first)
		}
		var shown, folded []string
		for _, u := range units {
			if u.Folded {
				folded = append(folded, u.Glosses...)
			} else {
				shown = append(shown, u.Glosses...)
			}
		}
		for _, g := range c.folded {
			if !slices.Contains(folded, g) {
				t.Errorf("%s: %q is not folded (shown %q)", c.form, g, shown)
			}
		}
		for _, g := range shown {
			if strings.Contains(strings.ToLower(g), "slang") || strings.Contains(g, "vulgar") || strings.Contains(g, "prostitute") || strings.Contains(g, "肏") {
				t.Errorf("%s: %q is shown unfolded", c.form, g)
			}
		}
		if g := lexicon.DisplayGloss(e.Senses, ""); g != units[0].Glosses[0] {
			t.Errorf("%s: DisplayGloss %q", c.form, g)
		}
	}
}
