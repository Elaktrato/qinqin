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
	// Import and read everything back through the store, as the API does.
	sqlDB := newDB(t)
	ctx := t.Context()
	if _, err := grammar.Import(ctx, sqlDB, pack); err != nil {
		t.Fatal(err)
	}
	packs, err := grammar.ListPacks(ctx, sqlDB, "zh")
	if err != nil || len(packs) != 1 || packs[0].PackID != "zh-grammar-demo" {
		t.Fatalf("ListPacks = %+v, %v", packs, err)
	}
	if got := len(packs[0].Lessons); got != 10 {
		t.Fatalf("stored lessons = %d, want 10", got)
	}
	stored := 0
	for _, summary := range packs[0].Lessons {
		view, err := grammar.LessonByID(ctx, sqlDB, "zh-grammar-demo", summary.ID)
		if err != nil {
			t.Fatalf("LessonByID(%s): %v", summary.ID, err)
		}
		for _, e := range view.Lesson.Examples {
			stored++
			if n := strings.Count(e.Text, e.Focus); n != 1 {
				t.Errorf("%s: focus %q occurs %d times in %q, want exactly once (the gap and the answer check rely on it)", e.ID, e.Focus, n, e.Text)
			}
		}
	}
	if stored != 40 {
		t.Errorf("stored examples = %d, want 40", stored)
	}
}
