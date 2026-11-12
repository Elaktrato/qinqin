package dict_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"qinqin/internal/dict"
	"qinqin/internal/entries"
)

// cedictPackFromText builds a cedict pack around the given dictionary.txt
// content.
func cedictPackFromText(t *testing.T, text string) dict.Pack {
	t.Helper()
	dir := t.TempDir()
	manifest, err := json.Marshal(cedictManifest)
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	mustWriteFile(t, filepath.Join(dir, "manifest.json"), string(manifest))
	mustWriteFile(t, filepath.Join(dir, "dictionary.txt"), text)
	pack, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatalf("LoadPack: %v", err)
	}
	return pack
}

// goodCedictLines returns n distinct well-formed lines.
func goodCedictLines(n int) string {
	var b strings.Builder
	for i := 0; i < n; i++ {
		w := string(rune(0x4E00+i)) + "好"
		fmt.Fprintf(&b, "%s %s [ni3 hao3] /gloss %d/\n", w, w, i)
	}
	return b.String()
}

// Ruling (Task 15a): the real ~120k-line CC-CEDICT may carry a few odd
// lines; an import skips them, counts them in Result.Skipped, and keeps
// going rather than aborting the whole file.
func TestCedictImportSkipsMalformedLines(t *testing.T) {
	sqlDB := newDB(t)
	text := goodCedictLines(40) + "this is not an entry\n" + "你好 你好 [ni3 hao3] //\n"
	res, err := dict.Import(context.Background(), sqlDB, cedictPackFromText(t, text))
	if err != nil {
		t.Fatalf("Import with 2 malformed lines in 42: %v", err)
	}
	if res.Skipped != 2 {
		t.Errorf("Result.Skipped = %d, want 2", res.Skipped)
	}
	if res.Entries < 40 {
		t.Errorf("Result.Entries = %d, want the 40 good lines imported", res.Entries)
	}
}

// A file that is mostly unparseable is the wrong file (an HTML error
// page, a truncated download), not CEDICT with a few odd lines: the
// import fails instead of silently installing nothing.
func TestCedictImportRejectsMostlyMalformedFile(t *testing.T) {
	sqlDB := newDB(t)
	text := goodCedictLines(1) + strings.Repeat("<html>not cedict</html>\n", 5)
	_, err := dict.Import(context.Background(), sqlDB, cedictPackFromText(t, text))
	if !errors.Is(err, dict.ErrInvalidPack) {
		t.Fatalf("Import(mostly garbage) err = %v, want ErrInvalidPack", err)
	}
}

// Ruling (Task 15c): pinyin the converter cannot resolve is kept as
// written (so the entry still imports) but counted in
// Result.Unconverted, so a syllable-table gap is visible on the real
// data instead of silently leaving entries without bopomofo.
func TestCedictImportCountsUnconvertedPinyin(t *testing.T) {
	sqlDB := newDB(t)
	text := goodCedictLines(20) + "怪怪 怪怪 [xx5 yy] /odd/\n"
	res, err := dict.Import(context.Background(), sqlDB, cedictPackFromText(t, text))
	if err != nil {
		t.Fatalf("Import: %v", err)
	}
	if res.Unconverted != 1 {
		t.Errorf("Result.Unconverted = %d, want 1", res.Unconverted)
	}
	e := mustGet(t, entries.Store{DB: sqlDB}, "怪怪", "word", "zh")
	if py := findReading(e, "pinyin"); py == nil || py.Value != "xx5 yy" {
		t.Errorf("readings of 怪怪 = %+v, want the pinyin kept as written", e.Readings)
	}
	if bm := findReading(e, "bopomofo"); bm != nil {
		t.Errorf("unconvertible pinyin derived bopomofo %q", bm.Value)
	}
}

// Homographs — several CEDICT lines for one written form (行 xíng /
// háng, 了 le / liǎo, …) — merge into one entry carrying every distinct
// pronunciation in file order and every line's senses. (Readings replace
// wholesale on upsert, so merging has to happen before the upsert.)
func TestCedictHomographPolicy(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)
	text := goodCedictLines(20) + "行 行 [xing2] /to walk/\n" + "行 行 [hang2] /row/\n"
	if _, err := dict.Import(ctx, sqlDB, cedictPackFromText(t, text)); err != nil {
		t.Fatalf("Import: %v", err)
	}
	e := mustGet(t, entries.Store{DB: sqlDB}, "行", "character", "zh")
	glosses := activeGlosses(t, sqlDB, dictionaryID(t, sqlDB, "cedict-sample"), e.ID)
	slices.Sort(glosses)
	if !slices.Equal(glosses, []string{"row", "to walk"}) {
		t.Errorf("glosses of 行 = %v, want both lines' senses", glosses)
	}
	var pinyins []string
	for _, r := range e.Readings {
		if r.Type == "pinyin" {
			pinyins = append(pinyins, r.Value)
		}
	}
	if !slices.Equal(pinyins, []string{"xíng", "háng"}) {
		t.Errorf("pinyin readings of 行 = %v, want both, in file order", pinyins)
	}
}
