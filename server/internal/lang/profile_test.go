package lang_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	. "qinqin/internal/lang"
)

// docs/contracts/languages/profiles.json: the Go table equals the fixture,
// and every code resolves as listed (#199). The web table reads the same file.
func TestProfilesFixture(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "docs", "contracts", "languages", "profiles.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		Profiles []Profile `json:"profiles"`
		Resolve  []struct {
			Code    string `json:"code"`
			Profile string `json:"profile"`
		} `json:"resolve"`
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(Profiles, fx.Profiles) {
		t.Errorf("Profiles = %+v\nfixture %+v", Profiles, fx.Profiles)
	}
	for _, c := range fx.Resolve {
		if got := ProfileOf(c.Code).Code; got != c.Profile {
			t.Errorf("ProfileOf(%q) = %s, want %s", c.Code, got, c.Profile)
		}
	}
	if zh, es := ProfileOf("zh-TW"), ProfileOf("es"); !zh.Tones || zh.Script != ScriptHan || es.Script != ScriptLatin || es.HasCardKind("tone") {
		t.Errorf("zh %+v, es %+v", zh, es)
	}
	if !ProfileOf("ja").Kana || ProfileOf("ja").Tones {
		t.Errorf("ja %+v", ProfileOf("ja"))
	}
	// The writing-system trainer (#204) appears for these languages only.
	for code, want := range map[string][]string{
		"ja-JP": {"hiragana", "katakana"}, "ko": {"hangul"}, "RU_ru": {"cyrillic"}, "zh": {}, "es": {}, "pt": {}, "": {},
	} {
		if got := ProfileOf(code).WritingSystems; !reflect.DeepEqual(got, want) {
			t.Errorf("WritingSystems of %q = %v, want %v", code, got, want)
		}
	}
}
