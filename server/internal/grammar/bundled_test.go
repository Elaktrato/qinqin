package grammar_test

import (
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/grammar"
	"qinqin/internal/pack"
)

// TestBundledGrammarPack checks the committed zh-grammar pack: it passes the
// validator, has the seven levels and the planned size, every example makes a
// cloze, and the pack imports and reads back through the store.
func TestBundledGrammarPack(t *testing.T) {
	dir := filepath.Join("..", "..", "..", "plugins", "data", "zh-grammar")
	pk, err := pack.LoadPack(dir)
	if err != nil {
		t.Fatal(err)
	}
	if pk.Manifest.ID != "zh-grammar" || !strings.HasPrefix(pk.Manifest.License, "CC0-1.0") {
		t.Fatalf("manifest: %+v", pk.Manifest)
	}
	data, err := grammar.ReadData(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(data.Levels) != 7 {
		t.Fatalf("levels = %d, want 7", len(data.Levels))
	}
	if len(data.Lessons) < 300 || len(data.Lessons) > 500 {
		t.Fatalf("lessons = %d, want 300..500", len(data.Lessons))
	}
	perLevel := map[string]int{}
	for _, l := range data.Lessons {
		perLevel[l.Level]++
	}
	for _, id := range []string{"hsk-1", "hsk-2", "hsk-3", "hsk-4", "hsk-5", "hsk-6", "hsk-7-9"} {
		if perLevel[id] == 0 {
			t.Errorf("level %s has no lessons", id)
		}
	}
	for _, l := range data.Lessons {
		if n := len(l.Examples); n < 4 || n > 8 {
			t.Errorf("%s: %d examples, want 4..8", l.ID, n)
		}
		for _, e := range l.Examples {
			if e.Reading == "" || e.Translation == "" || e.Focus == "" || len(e.Distractors) < 2 {
				t.Errorf("%s: incomplete example", e.ID)
			}
			if n := strings.Count(e.Text, e.Focus); n != 1 {
				t.Errorf("%s: focus %q occurs %d times, want 1", e.ID, e.Focus, n)
			}
			seen := map[string]bool{}
			for _, d := range e.Distractors {
				if d == e.Focus || seen[d] {
					t.Errorf("%s: bad distractor %q", e.ID, d)
				}
				seen[d] = true
			}
		}
	}
	// The tutor-reviewed examples with a second legal order skip the
	// word-order exercise; every other example keeps it.
	noOrder := map[string]bool{}
	for _, l := range data.Lessons {
		for _, e := range l.Examples {
			noOrder[e.ID] = e.NoOrder
		}
	}
	flagged := []string{
		"hsk1-negation-1", "hsk1-negation-2", "hsk1-negation-5",
		"hsk1-separable-verbs-1", "hsk1-zai-preposition-4", "hsk1-adverbial-2",
		"hsk1-zai-again-2", "hsk1-time-expressions-3", "hsk1-time-expressions-4",
		"hsk1-he-conjunction-1", "hsk1-he-conjunction-2", "hsk1-he-conjunction-3",
		"hsk1-he-conjunction-4", "hsk1-he-dui-1", "hsk1-he-dui-3", "hsk1-he-dui-5",
		"hsk1-phrase-types-1", "hsk1-serial-verbs-5", "hsk1-coordinate-clauses-5",
		"hsk1-dou-3",
	}
	for _, id := range flagged {
		if !noOrder[id] {
			t.Errorf("%s: want NoOrder true", id)
		}
	}
	sample := []string{"hsk1-negation-3", "hsk1-negation-4", "hsk1-he-dui-2", "hsk1-he-dui-4", "hsk1-adverbial-1"}
	for _, id := range sample {
		if noOrder[id] {
			t.Errorf("%s: want NoOrder false", id)
		}
	}
	sqlDB := dbtest.Open(t)
	ctx := t.Context()
	if _, err := grammar.Import(ctx, sqlDB, pk); err != nil {
		t.Fatal(err)
	}
	packs, err := grammar.ListPacks(ctx, sqlDB, "zh")
	if err != nil || len(packs) != 1 || packs[0].PackID != "zh-grammar" {
		t.Fatalf("ListPacks = %+v, %v", packs, err)
	}
	if len(packs[0].Lessons) != len(data.Lessons) {
		t.Fatalf("imported %d lessons, want %d", len(packs[0].Lessons), len(data.Lessons))
	}
	for _, summary := range packs[0].Lessons {
		if _, err := grammar.LessonByID(ctx, sqlDB, "zh-grammar", summary.ID); err != nil {
			t.Errorf("LessonByID(%s): %v", summary.ID, err)
		}
	}
}

// TestBundledJapaneseGrammarPack checks the committed ja-grammar pack: the
// manifest, the five levels, 250–500 lessons with every level populated,
// every example's reading and cloze, and the import.
func TestBundledJapaneseGrammarPack(t *testing.T) {
	dir := filepath.Join("..", "..", "..", "plugins", "data", "ja-grammar")
	pk, err := pack.LoadPack(dir)
	if err != nil {
		t.Fatal(err)
	}
	if pk.Manifest.ID != "ja-grammar" || pk.Manifest.Language != "ja" || pk.Manifest.License != "CC0-1.0" {
		t.Fatalf("manifest: %+v", pk.Manifest)
	}
	data, err := grammar.ReadData(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(data.Levels) != 5 {
		t.Fatalf("levels = %d, want 5", len(data.Levels))
	}
	if len(data.Lessons) < 250 || len(data.Lessons) > 500 {
		t.Fatalf("lessons = %d, want 250..500", len(data.Lessons))
	}
	perLevel := map[string]int{}
	for _, l := range data.Lessons {
		perLevel[l.Level]++
		if n := len(l.Examples); n < 4 || n > 8 {
			t.Errorf("%s: %d examples, want 4..8", l.ID, n)
		}
		for _, e := range l.Examples {
			if e.Reading == "" || e.Translation == "" || e.Focus == "" || len(e.Distractors) < 2 {
				t.Errorf("%s: incomplete example", e.ID)
			}
			if n := strings.Count(e.Text, e.Focus); n != 1 {
				t.Errorf("%s: focus %q occurs %d times, want 1", e.ID, e.Focus, n)
			}
		}
	}
	for _, id := range []string{"n5", "n4", "n3", "n2", "n1"} {
		if perLevel[id] == 0 {
			t.Errorf("level %s has no lessons", id)
		}
	}
	sqlDB := dbtest.Open(t)
	ctx := t.Context()
	if _, err := grammar.Import(ctx, sqlDB, pk); err != nil {
		t.Fatal(err)
	}
	packs, err := grammar.ListPacks(ctx, sqlDB, "ja")
	if err != nil || len(packs) != 1 || packs[0].PackID != "ja-grammar" {
		t.Fatalf("ListPacks = %+v, %v", packs, err)
	}
	if len(packs[0].Lessons) != len(data.Lessons) {
		t.Fatalf("imported %d lessons, want %d", len(packs[0].Lessons), len(data.Lessons))
	}
}
