package levels_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/pack"
)

// samplePacks holds the hand-written sample packs (hsk-mini, jlpt-mini).
const samplePacks = "../../../plugins/samples"

// docs/contracts/settings/mastery-map.json (#163): the default gradings name
// level packs this repository bundles, in the language they are the default
// for, and each default pack carries its language's prefix; the packs that
// are never a grading are the bundled Jōyō grades (the built-in Grade) and the
// samples. The server stores the key as any other workspace setting (the
// merge cases of workspace-settings.json).
func TestMasteryMapFixture(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "docs", "contracts", "settings", "mastery-map.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		Rule              string              `json:"rule"`
		Key               string              `json:"key"`
		BuiltIn           map[string][]string `json:"builtIn"`
		DefaultPacks      map[string][]string `json:"defaultPacks"`
		DefaultPackPrefix map[string]string   `json:"defaultPackPrefix"`
		NeverGradings     []string            `json:"neverGradings"`
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	if fx.Rule != "settings/mastery-map" || fx.Key != "masteryMap" {
		t.Fatalf("rule %q key %q", fx.Rule, fx.Key)
	}
	for _, lang := range []string{"ja", "zh"} {
		if len(fx.BuiltIn[lang]) == 0 || len(fx.DefaultPacks[lang]) == 0 {
			t.Errorf("%s: built-ins %v, default packs %v", lang, fx.BuiltIn[lang], fx.DefaultPacks[lang])
		}
	}
	for lang, ids := range fx.DefaultPacks {
		for _, id := range ids {
			p, err := pack.LoadPack(filepath.Join(bundledPacks, id))
			if err != nil {
				t.Errorf("default pack %s: %v", id, err)
				continue
			}
			if p.Manifest.Type != pack.TypeLevels || p.Manifest.Language != lang {
				t.Errorf("default pack %s: type %s language %s, want levels %s", id, p.Manifest.Type, p.Manifest.Language, lang)
			}
			if !strings.HasPrefix(id, fx.DefaultPackPrefix[lang]) {
				t.Errorf("default pack %s lacks the prefix %q", id, fx.DefaultPackPrefix[lang])
			}
		}
	}
	never := map[string]string{"joyo-grades": bundledPacks, "hsk-mini": samplePacks, "jlpt-mini": samplePacks}
	for _, id := range fx.NeverGradings {
		root, ok := never[id]
		if !ok {
			t.Errorf("never-grading %s is no bundled or sample pack", id)
			continue
		}
		if _, err := pack.LoadPack(filepath.Join(root, id)); err != nil {
			t.Errorf("never-grading %s: %v", id, err)
		}
	}
}
