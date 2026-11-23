package main

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/dict"
)

// grammarFixture is the shared grammar pack fixture.
const grammarFixture = "../../internal/grammar/testdata/zh-mini"

// TestSeedImportsGrammarAfterSentences seeds dictionaries, a sentences pack
// fixture and returns the database, root and seed output.
func TestSeedImportsGrammarAfterSentences(t *testing.T) {
	sqlDB, _ := openTestDB(t)
	root := smallPacks(t)
	copyTree(t, grammarFixture, filepath.Join(root, "zh-grammar-mini"))
	// A sentences pack, so the order against it is observable.
	copyTree(t, "../../internal/sentences/testdata/zh-mini", filepath.Join(root, "sent-mini"))

	var out strings.Builder
	if err := seed(context.Background(), sqlDB, t.TempDir(), []string{root}, &out); err != nil {
		t.Fatalf("seed: %v\n%s", err, out.String())
	}
	var n int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM grammar_lessons WHERE deleted_at IS NULL`).Scan(&n); err != nil || n != 3 {
		t.Errorf("grammar lessons = %d, %v; want 3", n, err)
	}
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM entries`).Scan(&n); err != nil || n == 0 {
		t.Errorf("dictionary entries = %d, %v; want the dictionaries imported too", n, err)
	}
	lines := strings.Split(strings.TrimSpace(out.String()), "\n")
	last := lines[len(lines)-1]
	if !strings.HasPrefix(last, "zh-grammar-mini") || !strings.Contains(last, "grammar") || !strings.Contains(last, "3 lessons") {
		t.Errorf("last seed line = %q, want the grammar pack with its lesson count", last)
	}
	if importRank(dict.TypeGrammar) != 4 || importRank(dict.TypeGrammar) <= importRank(dict.TypeSentences) {
		t.Errorf("importRank(grammar) = %d, want 4, after sentences %d", importRank(dict.TypeGrammar), importRank(dict.TypeSentences))
	}
	// Seeding again is safe.
	if err := seed(context.Background(), sqlDB, t.TempDir(), []string{root}, &strings.Builder{}); err != nil {
		t.Fatalf("second seed: %v", err)
	}
}

func TestStalePackTermsWarnsOnGrammarNotice(t *testing.T) {
	sqlDB, _ := openTestDB(t)
	root := t.TempDir()
	copyTree(t, grammarFixture, filepath.Join(root, "zh-grammar-mini"))
	if err := seed(context.Background(), sqlDB, t.TempDir(), []string{root}, &strings.Builder{}); err != nil {
		t.Fatal(err)
	}
	var rec logRecorder
	warnStalePackTerms(context.Background(), sqlDB, []string{root}, rec.logf)
	if len(rec.lines) != 0 {
		t.Fatalf("fresh seed: got %q, want no lines", rec.lines)
	}
	editManifest(t, filepath.Join(root, "zh-grammar-mini"), "notice", "A changed notice.")
	warnStalePackTerms(context.Background(), sqlDB, []string{root}, rec.logf)
	if len(rec.lines) != 1 || !strings.HasPrefix(rec.lines[0], "pack zh-grammar-mini: stored license/attribution/notice differs from ") {
		t.Errorf("got %q, want one warning for zh-grammar-mini", rec.lines)
	}
}
