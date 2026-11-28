package lexicon_test

import (
	"encoding/json"
	"os"
	"reflect"
	"slices"
	"testing"

	"qinqin/internal/lexicon"
)

// senseDisplayFixture is docs/contracts/senses/display.json.
type senseDisplayFixture struct {
	Rule             string   `json:"rule"`
	ExplicitWords    []string `json:"explicitWords"`
	VulgarCharacters []string `json:"vulgarCharacters"`
	Cases            []struct {
		Name   string `json:"name"`
		Senses []struct {
			Tags    []string `json:"tags"`
			Glosses []string `json:"glosses"`
		} `json:"senses"`
		Units []struct {
			Sense   int      `json:"sense"`
			Class   string   `json:"class"`
			Mark    *string  `json:"mark"`
			Folded  bool     `json:"folded"`
			Glosses []string `json:"glosses"`
		} `json:"units"`
		Gloss string `json:"gloss"`
	} `json:"cases"`
}

func readSenseDisplayFixture(t *testing.T) senseDisplayFixture {
	t.Helper()
	raw, err := os.ReadFile("../../../docs/contracts/senses/display.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx senseDisplayFixture
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	if fx.Rule != "senses/display" || len(fx.Cases) < 15 {
		t.Fatalf("fixture %q with %d cases", fx.Rule, len(fx.Cases))
	}
	return fx
}

func TestDisplaySensesFixture(t *testing.T) {
	fx := readSenseDisplayFixture(t)
	for _, c := range fx.Cases {
		senses := make([]lexicon.Sense, len(c.Senses))
		for i, s := range c.Senses {
			senses[i] = lexicon.Sense{Tags: s.Tags, Glosses: s.Glosses}
		}
		got := lexicon.DisplaySenses(senses)
		want := make([]lexicon.SenseUnit, len(c.Units))
		for i, u := range c.Units {
			want[i] = lexicon.SenseUnit{Sense: u.Sense, Class: u.Class, Folded: u.Folded, Glosses: u.Glosses}
			if u.Mark != nil {
				want[i].Mark = *u.Mark
			}
		}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%s:\n got %+v\nwant %+v", c.Name, got, want)
		}
		if g := lexicon.DisplayGloss(senses); g != c.Gloss {
			t.Errorf("%s: DisplayGloss = %q, want %q", c.Name, g, c.Gloss)
		}
	}
}

// The fixture's lists are the implementation's lists.
func TestDisplaySensesLists(t *testing.T) {
	fx := readSenseDisplayFixture(t)
	if !slices.Equal(fx.ExplicitWords, lexicon.ExplicitWords) {
		t.Errorf("explicit words: fixture %v, code %v", fx.ExplicitWords, lexicon.ExplicitWords)
	}
	if !slices.Equal(fx.VulgarCharacters, lexicon.VulgarCharacters) {
		t.Errorf("vulgar characters: fixture %v, code %v", fx.VulgarCharacters, lexicon.VulgarCharacters)
	}
}

// The sense of a unit indexes the input, so a caller reaches its dictionary.
func TestDisplaySensesKeepDictionaries(t *testing.T) {
	senses := []lexicon.Sense{
		{DictionaryID: 1, Glosses: []string{"(slang) prostitute"}},
		{DictionaryID: 2, Glosses: []string{"chicken"}},
	}
	units := lexicon.DisplaySenses(senses)
	if len(units) != 2 || senses[units[0].Sense].DictionaryID != 2 || !units[1].Folded {
		t.Fatalf("units %+v", units)
	}
}
