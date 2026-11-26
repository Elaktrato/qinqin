package strokes_test

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/strokes"
)

// TestLookupContract runs the fixture docs/contracts/strokes/lookup.json: which installed pack serves a
// character for a reader of a language.
func TestLookupContract(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/strokes/lookup.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		Packs []struct {
			ID        string            `json:"id"`
			Languages []string          `json:"languages"`
			Chars     map[string]string `json:"chars"`
		} `json:"packs"`
		Cases []struct {
			Char string  `json:"char"`
			Lang *string `json:"lang"`
			Want *string `json:"want"`
			Why  string  `json:"why"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	if len(fx.Packs) < 3 || len(fx.Cases) < 8 {
		t.Fatalf("the fixture shrank: %d packs, %d cases", len(fx.Packs), len(fx.Cases))
	}
	ctx := context.Background()
	sqlDB := dbtest.Open(t)
	for _, p := range fx.Packs { // in order of registration
		var body strings.Builder
		for _, char := range sortedKeys(p.Chars) {
			body.WriteString(line(char, `{"label":"`+p.Chars[char]+`"}`))
		}
		if _, err := strokes.Import(ctx, sqlDB, writePack(t, p.ID, "1", p.Languages, body.String())); err != nil {
			t.Fatalf("import %s: %v", p.ID, err)
		}
	}
	for _, c := range fx.Cases {
		lang := ""
		if c.Lang != nil {
			lang = *c.Lang
		}
		got, ok, err := strokes.LookupFor(ctx, sqlDB, c.Char, lang)
		if err != nil {
			t.Fatalf("%s/%q: %v", c.Char, lang, err)
		}
		if c.Want == nil {
			if ok {
				t.Errorf("%s/%q: found %s, want none (%s)", c.Char, lang, got, c.Why)
			}
			continue
		}
		if want := `{"label":"` + *c.Want + `"}`; !ok || string(got) != want {
			t.Errorf("%s/%q: got %s (%v), want %s (%s)", c.Char, lang, got, ok, want, c.Why)
		}
	}
}

func sortedKeys(m map[string]string) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	// a stable order keeps the import deterministic
	for i := 1; i < len(keys); i++ {
		for j := i; j > 0 && keys[j] < keys[j-1]; j-- {
			keys[j], keys[j-1] = keys[j-1], keys[j]
		}
	}
	return keys
}
