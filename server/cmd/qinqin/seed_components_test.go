package main

import (
	"bytes"
	"context"
	"path/filepath"
	"regexp"
	"slices"
	"testing"

	"qinqin/internal/components"
)

// TestSeedImportsBundledKanjiVGComponents seeds the committed
// kanjivg-components pack (small: no dictionary needed, components are
// keyed by glyph) and checks a known character and the credits.
func TestSeedImportsBundledKanjiVGComponents(t *testing.T) {
	ctx := context.Background()
	sqlDB, _ := openTestDB(t)
	dest := t.TempDir()
	copyTree(t, filepath.Join(committedPacks, "kanjivg-components"), filepath.Join(dest, "kanjivg-components"))
	var out bytes.Buffer
	if err := seed(ctx, sqlDB, t.TempDir(), []string{dest}, &out); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if !regexp.MustCompile(`(?m)^kanjivg-components\s+components\s+\d{4} characters, \d+ parts$`).MatchString(out.String()) {
		t.Errorf("seed output:\n%s", out.String())
	}
	idx, err := components.Index(ctx, sqlDB, "ja")
	if err != nil {
		t.Fatal(err)
	}
	if parts := idx.Chars["語"]; !slices.Contains(parts, "言") || !slices.Contains(parts, "口") {
		t.Errorf("語 parts = %v, want 言 and 口 among them", parts)
	}
	if parts := idx.Chars["海"]; !slices.Contains(parts, "氵") {
		t.Errorf("海 parts = %v, want 氵", parts)
	}
	list, err := components.List(ctx, sqlDB)
	if err != nil || len(list) != 1 || list[0].PackID != "kanjivg-components" || list[0].License != "CC BY-SA 3.0" || list[0].Language != "ja" {
		t.Fatalf("component packs = %+v, %v", list, err)
	}
}
