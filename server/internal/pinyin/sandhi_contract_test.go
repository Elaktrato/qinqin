package pinyin

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

// docs/contracts/tones/sandhi.json (#300): the clients work out spoken tones
// from the readings the server sends. Each case's CC-CEDICT numbered pinyin
// is sent as its marked `pinyin` (ToMarked), with its `citation` tones
// (ToNumbered), and a written form has one character per syllable. The
// server itself applies no sandhi: it grades nothing.
func TestSandhiFixtureReadings(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "docs", "contracts", "tones", "sandhi.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		Rule  string `json:"rule"`
		Cases []struct {
			Name     string `json:"name"`
			Written  string `json:"written"`
			Numbered string `json:"numbered"`
			Pinyin   string `json:"pinyin"`
			Citation []int  `json:"citation"`
			Words    []int  `json:"words"`
			Spoken   []int  `json:"spoken"`
		} `json:"cases"`
		Grading []struct {
			Name     string   `json:"name"`
			Readings []string `json:"readings"`
			Chosen   []int    `json:"chosen"`
		} `json:"grading"`
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	if fx.Rule != "tones/sandhi" || len(fx.Cases) == 0 || len(fx.Grading) == 0 {
		t.Fatalf("rule %q, %d cases, %d grading", fx.Rule, len(fx.Cases), len(fx.Grading))
	}
	for _, c := range fx.Cases {
		marked, err := ToMarked(c.Numbered)
		if err != nil || marked != c.Pinyin {
			t.Errorf("%s: ToMarked(%q) = %q, %v; want %q", c.Name, c.Numbered, marked, err, c.Pinyin)
		}
		syls, err := ToNumbered(c.Pinyin)
		if err != nil {
			t.Errorf("%s: ToNumbered(%q): %v", c.Name, c.Pinyin, err)
			continue
		}
		tones := make([]int, len(syls))
		for i, s := range syls {
			tones[i] = int(s[len(s)-1] - '0')
		}
		if !reflect.DeepEqual(tones, c.Citation) {
			t.Errorf("%s: citation tones %v, fixture %v", c.Name, tones, c.Citation)
		}
		if len(c.Spoken) != len(c.Citation) {
			t.Errorf("%s: %d spoken tones for %d syllables", c.Name, len(c.Spoken), len(c.Citation))
		}
		if n := len([]rune(c.Written)); n != 0 && n != len(syls) {
			t.Errorf("%s: %d characters for %d syllables", c.Name, n, len(syls))
		}
	}
	for _, g := range fx.Grading {
		for _, r := range g.Readings {
			if _, err := ToNumbered(r); err != nil {
				t.Errorf("%s: reading %q: %v", g.Name, r, err)
			}
		}
	}
}
