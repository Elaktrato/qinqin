package dict_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/dict"
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
	pack := cedictPackFromText(t, text)
	res, err := dict.ImportLexicon(context.Background(), sqlDB, &pack)
	if err != nil {
		t.Fatalf("ImportLexicon with 2 malformed lines in 42: %v", err)
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
	pack := cedictPackFromText(t, text)
	_, err := dict.ImportLexicon(context.Background(), sqlDB, &pack)
	if !errors.Is(err, dict.ErrInvalidPack) {
		t.Fatalf("ImportLexicon(mostly garbage) err = %v, want ErrInvalidPack", err)
	}
}
