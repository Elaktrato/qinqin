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

// #346 on the shipped dictionaries: one-character words lead with their
// everyday line, surname, abbreviation, variant and classical lines after
// it; a pinned reading keeps only its own lines; JMdict keeps its own order
// (電話's abbr sense is not demoted; 肉 and シャツ have no tag that says
// which sense is the everyday one).
func TestSenseOrderOnTheShippedDictionaries(t *testing.T) {
	sqlDB := dbtest.Open(t)
	realdict.Import(t, sqlDB, "zh", "书", "水", "三", "马", "云", "猫", "喝", "草")
	realdict.Import(t, sqlDB, "ja", "電話", "肉", "シャツ", "今日")
	store := lexicon.Store{DB: sqlDB}
	ctx := context.Background()
	for _, c := range []struct {
		language, kind, form, pinned string
		first                        []string // the first glosses shown, in order
		absent, last                 string   // a gloss left out; the last gloss shown ("" = unchecked)
	}{
		{"zh", "character", "书", "", []string{"book"}, "", "abbr. for 書經|书经[Shu1 jing1]"},
		{"zh", "character", "水", "", []string{"water"}, "", "Shui ethnic group"},
		{"zh", "character", "三", "", []string{"three", "3", "surname San"}, "", "surname San"},
		{"zh", "character", "马", "", []string{"horse"}, "", "abbr. for Malaysia 馬來西亞|马来西亚[Ma3 lai2 xi1 ya4]"},
		{"zh", "character", "云", "", []string{"cloud"}, "", ""},
		{"zh", "character", "猫", "māo", []string{"cat (CL:隻|只[zhi1])"}, "used in 貓腰|猫腰[mao2 yao1]", ""},
		{"zh", "character", "喝", "hē", []string{"to drink"}, "to shout", ""},
		{"zh", "character", "草", "cǎo", []string{"grass"}, "variant of 肏[cao4]", "variant of 草[cao3]"},
		{"ja", "word", "電話", "", []string{"telephone call", "phone call", "telephone (device)"}, "", ""},
		{"ja", "word", "肉", "", []string{"flesh", "meat"}, "", ""},
		{"ja", "word", "シャツ", "", []string{"shirt (undergarment)"}, "", ""},
		{"ja", "word", "今日", "きょう", []string{"today", "this day"}, "these days", ""},
	} {
		e, err := store.BestWord(ctx, c.language, c.form)
		if c.kind == "character" {
			e, err = store.Best(ctx, c.language, c.kind, c.form)
		}
		if err != nil {
			t.Fatalf("%s: %v", c.form, err)
		}
		var shown []string
		for _, u := range lexicon.DisplaySenses(e.Senses, c.pinned) {
			if !u.Folded {
				shown = append(shown, u.Glosses...)
			}
		}
		if len(shown) < len(c.first) || !slices.Equal(shown[:len(c.first)], c.first) {
			t.Errorf("%s (%s): shown %q, want it to start with %q", c.form, c.pinned, shown, c.first)
		}
		if c.absent != "" && slices.Contains(shown, c.absent) {
			t.Errorf("%s (%s): %q is shown", c.form, c.pinned, c.absent)
		}
		if c.last != "" && shown[len(shown)-1] != c.last {
			t.Errorf("%s (%s): last shown %q, want %q", c.form, c.pinned, shown[len(shown)-1], c.last)
		}
	}
}
