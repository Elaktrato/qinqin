package drills

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"unicode"
	"unicode/utf8"

	"qinqin/internal/pinyin"
)

// The look-alike drill (#228, docs/contracts/lookalikes/). The server stores
// its answers like any drill's and never reads the sets (they are bundled in
// the web app); this pins the set keys for a second client and checks the
// committed sets: every key a valid drill item, no set twice, and every
// bopomofo reading the server's own conversion of its pinyin.

const lookAlikesDrill = "look-alikes"

// validSetKey: 2 to 5 distinct members, each a Han character or a kana letter
// (the prolonged sound mark and iteration marks are not letters).
func validSetKey(key string) bool {
	if !utf8.ValidString(key) {
		return false
	}
	members := []rune(key)
	if len(members) < 2 || len(members) > 5 {
		return false
	}
	seen := map[rune]bool{}
	for _, r := range members {
		kana := (r >= 0x3041 && r <= 0x3096) || (r >= 0x30A1 && r <= 0x30FA)
		if seen[r] || !(unicode.Is(unicode.Han, r) || kana) {
			return false
		}
		seen[r] = true
	}
	return true
}

func TestLookAlikeKeys(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/lookalikes/sets.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		Rule string `json:"rule"`
		Keys []struct {
			Name  string `json:"name"`
			Key   any    `json:"key"`
			Valid bool   `json:"valid"`
		} `json:"keys"`
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	if fx.Rule != "lookalikes/sets" || len(fx.Keys) == 0 {
		t.Fatalf("rule %q, %d keys", fx.Rule, len(fx.Keys))
	}
	for _, c := range fx.Keys {
		key, isString := c.Key.(string)
		got := isString && validSetKey(key)
		if got != c.Valid {
			t.Errorf("%s: %q valid %v, want %v", c.Name, c.Key, got, c.Valid)
		}
		if got && !ValidItem(key) {
			t.Errorf("%s: %q is a set key but no drill item", c.Name, key)
		}
	}
	if !ValidID(lookAlikesDrill) {
		t.Errorf("%q is no drill id", lookAlikesDrill)
	}
}

func TestLookAlikeCommittedSets(t *testing.T) {
	dir := filepath.Join("..", "..", "..", "apps", "web", "src", "lib", "features", "practice", "lookAlikes", "data")
	for _, name := range []string{"look-alikes-zh.json", "look-alikes-ja.json"} {
		raw, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			t.Fatal(err)
		}
		var file struct {
			License    string `json:"license"`
			Language   string `json:"language"`
			Characters map[string]struct {
				Pinyin   []string `json:"pinyin"`
				Bopomofo []string `json:"bopomofo"`
				Example  struct {
					Pinyin   string `json:"pinyin"`
					Bopomofo string `json:"bopomofo"`
				} `json:"example"`
			} `json:"characters"`
			Sets []struct {
				Members []string `json:"members"`
			} `json:"sets"`
		}
		if err := json.Unmarshal(raw, &file); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if file.License != "CC-BY-4.0" || len(file.Sets) == 0 {
			t.Fatalf("%s: licence %q, %d sets", name, file.License, len(file.Sets))
		}
		seen := map[string]bool{}
		for _, s := range file.Sets {
			key := strings.Join(s.Members, "")
			sorted := slices.Clone(s.Members)
			slices.Sort(sorted)
			if !validSetKey(key) || !ValidItem(key) || seen[strings.Join(sorted, "")] {
				t.Errorf("%s: set %q is not a valid, new set key", name, key)
			}
			seen[strings.Join(sorted, "")] = true
		}
		if file.Language != "zh" {
			continue
		}
		bopomofo := func(ch, py, want string) {
			got, err := pinyin.ToBopomofo(py)
			if err != nil || got != want {
				t.Errorf("%s %s: bopomofo of %q is %q (%v), the file has %q", name, ch, py, got, err, want)
			}
		}
		for ch, c := range file.Characters {
			if len(c.Pinyin) == 0 || len(c.Pinyin) != len(c.Bopomofo) {
				t.Errorf("%s %s: %d pinyin, %d bopomofo", name, ch, len(c.Pinyin), len(c.Bopomofo))
				continue
			}
			for i := range c.Pinyin {
				bopomofo(ch, c.Pinyin[i], c.Bopomofo[i])
			}
			bopomofo(ch, c.Example.Pinyin, c.Example.Bopomofo)
		}
	}
}
