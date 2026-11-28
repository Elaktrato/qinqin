package pinyin

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode"

	"qinqin/internal/drills"
)

// docs/contracts/tones/pairs.json (#180): the tone-pair drill's items are
// the 20 citation-tone pairs, each a drill item key; a word practises the
// pair of its two-syllable readings' citation tones. Each case's CC-CEDICT
// numbered pinyin is sent as its marked reading (ToMarked), and the pair
// worked out from those readings (ToNumbered) is the case's. The server
// grades nothing; this pins the rule for a second client.
func TestTonePairsFixture(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "docs", "contracts", "tones", "pairs.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		Rule  string   `json:"rule"`
		Pairs []string `json:"pairs"`
		Words []struct {
			Name     string   `json:"name"`
			Written  string   `json:"written"`
			Numbered []string `json:"numbered"`
			Readings []string `json:"readings"`
			Expect   *string  `json:"expect"`
		} `json:"words"`
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	if fx.Rule != "tones/pairs" || len(fx.Words) == 0 {
		t.Fatalf("rule %q, %d words", fx.Rule, len(fx.Words))
	}
	var want []string
	for first := 1; first <= 4; first++ {
		for second := 1; second <= 5; second++ {
			want = append(want, fmt.Sprintf("%d-%d", first, second))
		}
	}
	if fmt.Sprint(fx.Pairs) != fmt.Sprint(want) {
		t.Errorf("pairs %v, want %v", fx.Pairs, want)
	}
	for _, key := range fx.Pairs {
		if !drills.ValidItem(key) {
			t.Errorf("pair %q is no drill item key", key)
		}
	}
	for _, c := range fx.Words {
		// What the server sends (dict/cedict.go markedPinyin): the marked
		// reading, or the numbered pinyin as written when it does not convert.
		if len(c.Numbered) > 0 && len(c.Numbered) != len(c.Readings) {
			t.Errorf("%s: %d numbered for %d readings", c.Name, len(c.Numbered), len(c.Readings))
			continue
		}
		for i, n := range c.Numbered {
			sent, err := ToMarked(n)
			if err != nil {
				sent = n
			}
			if sent != c.Readings[i] {
				t.Errorf("%s: the server sends %q for %q; fixture %q", c.Name, sent, n, c.Readings[i])
			}
		}
		got := pairOf(t, c.Written, c.Readings)
		if (got == nil) != (c.Expect == nil) || (got != nil && *got != *c.Expect) {
			t.Errorf("%s: pair %v, want %v", c.Name, deref(got), deref(c.Expect))
		}
	}
}

// pairOf is the fixture's rule: two Han characters, the clean (letters
// only) two-syllable readings agree on their citation tones, the first is
// not neutral. A lone r folds into the syllable before it.
func pairOf(t *testing.T, written string, readings []string) *string {
	chars := []rune(written)
	if len(chars) != 2 || !unicode.Is(unicode.Han, chars[0]) || !unicode.Is(unicode.Han, chars[1]) {
		return nil
	}
	keys := map[string]bool{}
	for _, r := range readings {
		if strings.ContainsFunc(r, unicode.IsDigit) {
			continue // not converted: no clean reading
		}
		var tones []byte
		for _, tok := range strings.Fields(r) {
			if tok == "r" && len(tones) > 0 {
				continue
			}
			syls, err := ToNumbered(tok)
			if err != nil || len(syls) != 1 {
				t.Errorf("ToNumbered(%q) = %v, %v", tok, syls, err)
				return nil
			}
			tones = append(tones, syls[0][len(syls[0])-1])
		}
		if len(tones) == 2 {
			keys[string(tones[0])+"-"+string(tones[1])] = true
		}
	}
	if len(keys) != 1 {
		return nil
	}
	for k := range keys {
		if k[0] == '5' {
			return nil
		}
		return &k
	}
	return nil
}

func deref(s *string) string {
	if s == nil {
		return "null"
	}
	return *s
}
