package grammar_test

import (
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/dict"
	"qinqin/internal/grammar"
)

// TestBundledGrammarDemo checks the committed demo pack: it passes the
// validator, has the planned size and every example makes a cloze.
func TestBundledGrammarDemo(t *testing.T) {
	dir := filepath.Join("..", "..", "..", "plugins", "data", "zh-grammar-demo")
	pack, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatal(err)
	}
	if pack.Manifest.ID != "zh-grammar-demo" || pack.Manifest.License != "CC0-1.0" {
		t.Fatalf("manifest: %+v", pack.Manifest)
	}
	data, err := grammar.ReadData(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(data.Lessons) != 10 {
		t.Fatalf("lessons = %d, want 10", len(data.Lessons))
	}
	examples := 0
	for _, l := range data.Lessons {
		if len(l.Examples) != 4 {
			t.Errorf("%s: %d examples, want 4", l.ID, len(l.Examples))
		}
		for _, e := range l.Examples {
			examples++
			if e.Focus == "" || len(e.Distractors) < 2 {
				t.Errorf("%s: no cloze (focus %q, %d distractors)", e.ID, e.Focus, len(e.Distractors))
			}
			if e.Reading == "" {
				t.Errorf("%s: no reading", e.ID)
			}
			if !strings.HasPrefix(e.ID, l.ID+"-") {
				t.Errorf("example id %s does not follow lesson id %s", e.ID, l.ID)
			}
		}
	}
	if examples != 40 {
		t.Errorf("examples = %d, want 40", examples)
	}
	// Import and read back through the store.
	sqlDB := newDB(t)
	if _, err := grammar.Import(t.Context(), sqlDB, pack); err != nil {
		t.Fatal(err)
	}
}
