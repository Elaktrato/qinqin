package sentences

import (
	"os"
	"path/filepath"
	"testing"

	"qinqin/internal/pack"
)

// TestBundledTatoebaPacksParse: once server/tools/tatoeba has generated the
// bundled example sentence packs into plugins/data, they load as sentence
// packs, carry a valid notice and pass the importer's checks of
// sentences.json. Until then there is nothing to check.
func TestBundledTatoebaPacksParse(t *testing.T) {
	for _, id := range []string{"zh-sentences-tatoeba", "ja-sentences-tatoeba"} {
		dir := filepath.Join("..", "..", "..", "plugins", "data", id)
		if _, err := os.Stat(dir); os.IsNotExist(err) {
			t.Logf("%s not generated yet (go run ./tools/tatoeba build)", id)
			continue
		}
		p, err := pack.LoadPack(dir)
		if err != nil {
			t.Fatalf("%s: %v", id, err)
		}
		if p.ID != id || p.Type != pack.TypeSentences || p.Format != pack.FormatJSON || p.Notice == "" {
			t.Errorf("%s: manifest %+v", id, p.Manifest)
		}
		if err := pack.ValidateNotice(p.Notice); err != nil {
			t.Errorf("%s: %v", id, err)
		}
		groups, err := readPack(dir)
		if err != nil {
			t.Fatalf("%s: %v", id, err)
		}
		for _, f := range []string{"LICENSE", "ATTRIBUTION.md", "credits.tsv"} {
			if _, err := os.Stat(filepath.Join(dir, f)); err != nil {
				t.Errorf("%s: %v", id, err)
			}
		}
		t.Logf("%s: %d word groups", id, len(groups))
	}
}
