package i18n_test

import (
	"encoding/json"
	"os"
	"regexp"
	"testing"

	"qinqin/internal/i18n"
)

const contractDir = "../../../docs/contracts/i18n/"

func readContract(t *testing.T, name string, v any) {
	t.Helper()
	raw, err := os.ReadFile(contractDir + name)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, v); err != nil {
		t.Fatalf("%s: %v", name, err)
	}
}

func TestLanguageTagsFixture(t *testing.T) {
	var f struct {
		Pattern string `json:"pattern"`
		Cases   []struct {
			Name  string `json:"name"`
			Value string `json:"value"`
			Valid bool   `json:"valid"`
		} `json:"cases"`
	}
	readContract(t, "language-tags.json", &f)
	if len(f.Cases) < 10 {
		t.Fatalf("only %d cases", len(f.Cases))
	}
	if f.Pattern != i18n.LanguageTagPattern {
		t.Errorf("pattern %q, fixture says %q", i18n.LanguageTagPattern, f.Pattern)
	}
	re := regexp.MustCompile(f.Pattern)
	for _, c := range f.Cases {
		if got := i18n.IsLanguageSetting(c.Value); got != c.Valid {
			t.Errorf("%s: IsLanguageSetting(%q) = %v, want %v", c.Name, c.Value, got, c.Valid)
		}
		if c.Value != "" && re.MatchString(c.Value) != c.Valid {
			t.Errorf("%s: the fixture's pattern disagrees with its own case", c.Name)
		}
	}
}
