package graded_test

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"

	"qinqin/internal/library/sources"
	"qinqin/internal/library/sources/graded"
)

// TestShippedFiles: both files parse, five texts a level, ids stable in shape, glosses at most the format's limit.
func TestShippedFiles(t *testing.T) {
	files, err := graded.Files()
	if err != nil {
		t.Fatal(err)
	}
	var langs []string
	for _, f := range files {
		langs = append(langs, f.Language)
		if f.HumanReviewed {
			t.Errorf("%s: humanReviewed is true; the owner has not read the texts yet", f.Language)
		}
		if !strings.Contains(f.Attribution, "reviewed by agents") {
			t.Errorf("%s: the attribution does not say the texts were reviewed by agents", f.Language)
		}
	}
	if !slices.Equal(langs, []string{"ja", "zh"}) {
		t.Fatalf("languages %v, want [ja zh]", langs)
	}
	if got := graded.Languages(); !slices.Equal(got, []string{"ja", "zh"}) {
		t.Fatalf("Languages() = %v", got)
	}
}

func TestSourceFetch(t *testing.T) {
	src := graded.Source{}
	if src.ID() != graded.SourceID || graded.SourceID != "graded" {
		t.Fatalf("ID = %q", src.ID())
	}
	files, _ := graded.Files()
	var zh graded.File
	for _, f := range files {
		if f.Language == "zh" {
			zh = f
		}
	}
	tx := zh.Texts[0]
	imp, err := src.Fetch(context.Background(), tx.ID)
	if err != nil {
		t.Fatal(err)
	}
	m := imp.Meta
	if m.Language != "zh" || m.Title != tx.Title || m.Author != "qinqin" || m.Source != "graded" || m.SourceID != tx.ID || m.SourceURL != "" {
		t.Fatalf("meta = %+v", m)
	}
	wantAttr := "qinqin graded readers, " + zh.Levels[tx.Level] + ": written for qinqin and reviewed by agents acting as teachers, not yet by a person."
	if m.Attribution != wantAttr || m.LicenseNote != "CC BY 4.0, qinqin contributors" {
		t.Fatalf("attribution %q, licence %q", m.Attribution, m.LicenseNote)
	}
	if len(imp.Chapters) != 1 || imp.Chapters[0].Title != tx.Title || len(imp.Chapters[0].Paragraphs) != len(tx.Paragraphs) {
		t.Fatalf("chapters = %+v", imp.Chapters)
	}
	for i, p := range imp.Chapters[0].Paragraphs {
		if len(p) != 1 || p[0].Text != tx.Paragraphs[i] || p[0].Ruby != "" {
			t.Fatalf("paragraph %d = %+v", i, p)
		}
	}
	if _, err := src.Fetch(context.Background(), "zh-nope"); !errors.Is(err, sources.ErrNotFound) {
		t.Fatalf("unknown id: %v", err)
	}
	d, err := src.Describe(context.Background(), tx.ID)
	if err != nil || d.Language != "zh" || d.SourceID != tx.ID || d.Title != tx.Title {
		t.Fatalf("Describe = %+v, %v", d, err)
	}
	if _, err := src.Describe(context.Background(), "nope"); !errors.Is(err, sources.ErrNotFound) {
		t.Fatalf("Describe unknown: %v", err)
	}
}

func TestSourceSearch(t *testing.T) {
	src := graded.Source{}
	files, _ := graded.Files()
	tx := files[0].Texts[0]
	res, err := src.Search(context.Background(), tx.Title, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(res) == 0 || res[0].SourceID != tx.ID || res[0].Author != "qinqin" || !strings.Contains(res[0].Note, files[0].Levels[tx.Level]) {
		t.Fatalf("Search(%q) = %+v", tx.Title, res)
	}
	all, _ := src.Search(context.Background(), "", 100)
	if len(all) != 0 {
		t.Fatalf("an empty query found %d", len(all))
	}
	few, _ := src.Search(context.Background(), "的", 2)
	if len(few) > 2 {
		t.Fatalf("limit 2 gave %d", len(few))
	}
}

func TestCatalogue(t *testing.T) {
	all := graded.Catalogue("")
	zh := graded.Catalogue("zh")
	ja := graded.Catalogue("ja")
	if len(all) != len(zh)+len(ja) || len(zh) != 20 || len(ja) != 15 {
		t.Fatalf("catalogue: %d all, %d zh, %d ja", len(all), len(zh), len(ja))
	}
	if len(graded.Catalogue("es")) != 0 {
		t.Fatal("es is not empty")
	}
	e := zh[0]
	if e.Language != "zh" || e.Scheme != "hsk-words" || e.LevelName != "HSK 1" || e.Levels != 4 || e.Length <= 0 || e.Names == nil || e.Glosses == nil || e.HumanReviewed {
		t.Fatalf("entry = %+v", e)
	}
	for i := 1; i < len(zh); i++ {
		if zh[i].Level < zh[i-1].Level {
			t.Fatalf("zh is not in level order at %s", zh[i].ID)
		}
	}
}
