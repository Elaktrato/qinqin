package lexicon_test

import (
	"encoding/json"
	"os"
	"testing"

	"qinqin/internal/lexicon"
)

// displayFixture is docs/contracts/frequency/display-form.json.
type displayFixture struct {
	Rule  string `json:"rule"`
	Cases []struct {
		Name  string `json:"name"`
		Forms []struct {
			Text  string   `json:"text"`
			Flags []string `json:"flags"`
		} `json:"forms"`
		Readings []struct {
			Type  string   `json:"type"`
			Value string   `json:"value"`
			Flags []string `json:"flags"`
		} `json:"readings"`
		Senses []struct {
			Tags []string `json:"tags"`
		} `json:"senses"`
		ListForm string `json:"listForm"`
		Expected string `json:"expected"`
	} `json:"cases"`
}

func TestDisplayFormFixture(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/frequency/display-form.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx displayFixture
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	if fx.Rule != "frequency/display-form" || len(fx.Cases) < 20 {
		t.Fatalf("fixture %q with %d cases", fx.Rule, len(fx.Cases))
	}
	for _, c := range fx.Cases {
		var e lexicon.Entry
		for _, f := range c.Forms {
			e.Forms = append(e.Forms, lexicon.Form{Text: f.Text, Flags: f.Flags})
		}
		for _, r := range c.Readings {
			e.Readings = append(e.Readings, lexicon.Reading{Type: r.Type, Value: r.Value, Flags: r.Flags})
		}
		for _, s := range c.Senses {
			e.Senses = append(e.Senses, lexicon.Sense{Tags: s.Tags})
		}
		if got := e.DisplayForm(c.ListForm); got != c.Expected {
			t.Errorf("%s: DisplayForm(%q) = %q, want %q", c.Name, c.ListForm, got, c.Expected)
		}
		if c.ListForm == "" {
			if got := e.Headword(); got != c.Expected {
				t.Errorf("%s: Headword() = %q, want %q", c.Name, got, c.Expected)
			}
		}
	}
}
