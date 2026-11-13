package dict_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"

	"qinqin/internal/dict"
	"qinqin/internal/lexicon"
)

// unihanFixture is the committed Unihan database sample, relative to this
// package's test working directory.
const unihanFixture = "testdata/unihan-sample.txt"

// unihanManifest is the manifest of the packs the unihan tests build
// around the committed sample: the Unihan database's own terms.
var unihanManifest = dict.Manifest{
	ID:          "unihan",
	Name:        "Unihan database",
	Version:     "1.0",
	Type:        "dictionary",
	Language:    "zh",
	License:     "Unicode License v3 (fixture)",
	Attribution: "Unicode Consortium (fixture attribution)",
	Format:      "unihan",
}

// loadUnihanFixture builds the pack around the committed sample: its
// manifest plus a dictionary.txt holding the fixture's lines verbatim.
func loadUnihanFixture(t *testing.T) dict.Pack {
	t.Helper()
	data, err := os.ReadFile(unihanFixture)
	if err != nil {
		t.Fatalf("read %s: %v", unihanFixture, err)
	}
	dir := t.TempDir()
	manifest, err := json.Marshal(unihanManifest)
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	mustWriteFile(t, filepath.Join(dir, "manifest.json"), string(manifest))
	mustWriteFile(t, filepath.Join(dir, "dictionary.txt"), string(data))
	pack, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatalf("LoadPack(unihan sample): %v", err)
	}
	return pack
}

// importUnihanPack builds a unihan pack around lines with manifest m and
// imports it, returning the import's result or its error.
func importUnihanPack(t *testing.T, ctx context.Context, sqlDB *sql.DB, m dict.Manifest, lines ...string) (dict.Result, error) {
	t.Helper()
	dir := t.TempDir()
	manifest, err := json.Marshal(m)
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	mustWriteFile(t, filepath.Join(dir, "manifest.json"), string(manifest))
	mustWriteFile(t, filepath.Join(dir, "dictionary.txt"), strings.Join(lines, "\n")+"\n")
	pack, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatalf("LoadPack(unihan pack): %v", err)
	}
	return dict.ImportLexicon(ctx, sqlDB, &pack)
}

func TestUnihanParse(t *testing.T) {
	f, err := os.Open(unihanFixture)
	if err != nil {
		t.Fatalf("open %s: %v", unihanFixture, err)
	}
	defer f.Close()
	data, err := dict.ParseUnihan(f)
	if err != nil {
		t.Fatalf("ParseUnihan(%s): %v", unihanFixture, err)
	}
	// U+ codepoints decode to characters: U+597D is 好, U+5FA9 復, U+8907
	// 複, U+590D 复 — the literal 复 on one variant line is the character
	// spelling of U+590D.
	if data.Radicals["好"] != 38 {
		t.Errorf("Radicals[好] = %d, want 38 — the count left of the \".\"", data.Radicals["好"])
	}
	if len(data.Radicals) != 1 {
		t.Errorf("Radicals = %v, want only 好 — the sample carries one kRSUnicode line", data.Radicals)
	}
	if data.Definitions["好"] != "good, excellent, fine; well" {
		t.Errorf("Definitions[好] = %q, want the kDefinition string without its quotes", data.Definitions["好"])
	}
	if len(data.Definitions) != 1 {
		t.Errorf("Definitions = %v, want only 好", data.Definitions)
	}
	if got := data.TradVariants["复"]; !slices.Equal(got, []string{"復", "複"}) {
		t.Errorf("TradVariants[复] = %v, want [復 複]", got)
	}
	if got := data.SimpVariants["復"]; !slices.Equal(got, []string{"复"}) {
		t.Errorf("SimpVariants[復] = %v, want [复]", got)
	}
	if got := data.SimpVariants["複"]; !slices.Equal(got, []string{"复"}) {
		t.Errorf("SimpVariants[複] = %v, want [复]", got)
	}
}

func TestUnihanParseSkipsCommentsBlanksUnknownFields(t *testing.T) {
	data, err := dict.ParseUnihan(strings.NewReader(
		"# Unihan 15.1.0\n" +
			"\n" +
			"U+597D\tkMandarin\thǎo\n" + // pronunciations are out of scope
			"U+597D\tkCangjie\tVND\n" + // as are input codes
			"# a comment line\n" +
			"U+597D\tkRSUnicode\t38.6\n"))
	if err != nil {
		t.Fatalf("ParseUnihan: %v", err)
	}
	if len(data.Radicals) != 1 || data.Radicals["好"] != 38 {
		t.Errorf("Radicals = %v, want only 好 -> 38", data.Radicals)
	}
	if len(data.Definitions) != 0 || len(data.TradVariants) != 0 || len(data.SimpVariants) != 0 || len(data.Attrs) != 0 {
		t.Errorf("unconsumed fields parsed: %+v", data)
	}
}

// TestUnihanParseAttrs: kTotalStrokes (first of several counts),
// kTGHZ2013 (presence), kGB0 (GB2312 row 16–55 level 1, 56–87 level 2,
// any other row no level) and kGradeLevel become the character's attrs.
func TestUnihanParseAttrs(t *testing.T) {
	data, err := dict.ParseUnihan(strings.NewReader(
		"U+597D\tkTotalStrokes\t6\n" +
			"U+597D\tkTGHZ2013\t095.050:hǎo 095.060:hào\n" +
			"U+597D\tkGB0\t2635\n" +
			"U+597D\tkGradeLevel\t1\n" +
			"U+590D\tkTotalStrokes\t7 9\n" +
			"U+590D\tkGB0\t1603\n" +
			"U+5FA9\tkGB0\t5601\n" +
			"U+5FA9\tkGradeLevel\t6\n" +
			"U+8907\tkGB0\t8794\n" +
			"U+3000\tkGB0\t0101\n" +
			"U+4E00\tkGB0\t1501\n" +
			"U+4E01\tkGB0\t8801\n"))
	if err != nil {
		t.Fatalf("ParseUnihan: %v", err)
	}
	want := map[string]map[string]string{
		"好": {"strokes": "6", "tghz": "1", "gb": "1", "hkgrade": "1"},
		"复": {"strokes": "7", "gb": "1"},
		"復": {"gb": "2", "hkgrade": "6"},
		"複": {"gb": "2"},
	}
	if !reflect.DeepEqual(data.Attrs, want) {
		t.Errorf("Attrs = %v, want %v — rows 01, 15 and 88 carry no level", data.Attrs, want)
	}
}

func TestUnihanParseRejectsMalformedAttrs(t *testing.T) {
	for _, line := range []string{
		"U+597D\tkTotalStrokes\tx",
		"U+597D\tkTotalStrokes\t0",
	} {
		_, err := dict.ParseUnihan(strings.NewReader(line + "\n"))
		if err == nil || !strings.Contains(err.Error(), "line 1") {
			t.Errorf("ParseUnihan(%q) = %v, want an error naming line 1", line, err)
		}
	}
}

// kGB0 and kGradeLevel come from optional members: a malformed value is
// skipped, the rest of the file still imports.
func TestUnihanParseSkipsMalformedOptionalAttrs(t *testing.T) {
	data, err := dict.ParseUnihan(strings.NewReader(
		"U+597D\tkTotalStrokes\t6\n" +
			"U+597D\tkGB0\t26x5\n" +
			"U+597D\tkGradeLevel\tseven\n" +
			"U+590D\tkGB0\t263\n" +
			"U+590D\tkGradeLevel\t0\n" +
			"U+5FA9\tkGB0\t5601\n" +
			"U+5FA9\tkGradeLevel\t6\n"))
	if err != nil {
		t.Fatalf("ParseUnihan: %v", err)
	}
	want := map[string]map[string]string{
		"好": {"strokes": "6"},
		"復": {"gb": "2", "hkgrade": "6"},
	}
	if !reflect.DeepEqual(data.Attrs, want) {
		t.Errorf("Attrs = %v, want %v", data.Attrs, want)
	}
}

func TestUnihanParseRadicalCounts(t *testing.T) {
	// Apostrophes after the radical number mark a simplified form of the
	// radical (86' is still radical 86); a char with several kRSUnicode
	// counts classifies under the first.
	data, err := dict.ParseUnihan(strings.NewReader(
		"U+9F99\tkRSUnicode\t86'.4\n" +
			"U+4E00\tkRSUnicode\t1.0 81.0\n"))
	if err != nil {
		t.Fatalf("ParseUnihan: %v", err)
	}
	if data.Radicals["龙"] != 86 {
		t.Errorf("Radicals[龙] = %d, want 86 — the apostrophe marks the radical's form, not its number", data.Radicals["龙"])
	}
	if data.Radicals["一"] != 1 {
		t.Errorf("Radicals[一] = %d, want 1 — the first count is the primary one", data.Radicals["一"])
	}
}

func TestUnihanParseRejectsMalformedLines(t *testing.T) {
	for _, tc := range []struct{ name, line string }{
		{"not a data line", "hello world"},
		{"missing value", "U+597D\tkRSUnicode"},
		{"blank value", "U+597D\tkSimplifiedVariant\t   "},
		{"key without codepoint", "597D\tkDefinition\tx"},
		{"key not hexadecimal", "U+ZZZZ\tkDefinition\tx"},
		{"key beyond the character range", "U+110000\tkDefinition\tx"},
		{"radical count not a number", "U+597D\tkRSUnicode\tx.6"},
		{"variant neither codepoint nor character", "U+597D\tkSimplifiedVariant\tabc"},
		{"empty definition", "U+597D\tkDefinition\t\"\""},
	} {
		_, err := dict.ParseUnihan(strings.NewReader(tc.line + "\n"))
		if err == nil || !strings.Contains(err.Error(), "line 1") {
			t.Errorf("%s: ParseUnihan(%q) = %v, want an error naming line 1", tc.name, tc.line, err)
		}
	}
}

// TestKangxiRadicalsCoverAllNumbers classifies one synthetic ideograph
// per radical number: the import must resolve every Kangxi number 1–214
// through the table, and reject numbers outside it.
func TestKangxiRadicalsCoverAllNumbers(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)
	lines := make([]string, 0, 214)
	for n := 1; n <= 214; n++ {
		lines = append(lines, fmt.Sprintf("U+%04X\tkRSUnicode\t%d.0", 0x4E00+n-1, n))
	}
	res, err := importUnihanPack(t, ctx, sqlDB, unihanManifest, lines...)
	if err != nil {
		t.Fatalf("ImportLexicon(214 radical counts): %v", err)
	}
	if res.Entries != 214 || res.Senses != 0 {
		t.Errorf("ImportLexicon(214 radical counts) = %+v, want 214 entries and 0 senses", res)
	}

	for _, n := range []int{0, 215} {
		sqlDB := newDB(t)
		_, err := importUnihanPack(t, ctx, sqlDB, unihanManifest, fmt.Sprintf("U+4E00\tkRSUnicode\t%d.0", n))
		if err == nil || !strings.Contains(err.Error(), "Kangxi") {
			t.Errorf("radical %d: ImportLexicon = %v, want an error naming the Kangxi radicals", n, err)
		}
		var dictRows int
		if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM dictionaries`).Scan(&dictRows); err != nil {
			t.Fatalf("count dictionaries: %v", err)
		}
		if dictRows != 0 {
			t.Errorf("radical %d: dictionary rows = %d, want 0 — a rejected pack registers nothing", n, dictRows)
		}
	}
}

// TestKangxiRadicalCharacters verifies the table's number→character pairs
// through the import path: a radical's own character (kRSUnicode N.0)
// classifies under the entry the table's N-th character got, so the entry
// must be its own.
func TestKangxiRadicalCharacters(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)
	anchors := []struct {
		n   int
		chr string
	}{
		{1, "一"}, {30, "口"}, {38, "女"}, {61, "心"}, {63, "戶"}, {64, "手"},
		{72, "日"}, {75, "木"}, {85, "水"}, {86, "火"}, {96, "玉"}, {113, "示"},
		{118, "竹"}, {120, "糸"}, {140, "艸"}, {149, "言"}, {163, "邑"}, {167, "金"},
		{174, "靑"}, {178, "韋"}, {187, "馬"}, {190, "髟"}, {196, "鳥"}, {203, "黑"},
		{209, "鼻"}, {210, "齊"}, {212, "龍"}, {214, "龠"},
	}
	lines := make([]string, len(anchors))
	for i, a := range anchors {
		lines[i] = fmt.Sprintf("U+%04X\tkRSUnicode\t%d.0", []rune(a.chr)[0], a.n)
	}
	if _, err := importUnihanPack(t, ctx, sqlDB, unihanManifest, lines...); err != nil {
		t.Fatalf("ImportLexicon(radical anchors): %v", err)
	}
	st := lexicon.Store{DB: sqlDB}
	for _, a := range anchors {
		e := lexByKey(t, sqlDB, "zh", "character", a.chr)
		radicals, err := st.Radicals(ctx, []int64{e.ID})
		if err != nil {
			t.Fatalf("Radicals(%s): %v", a.chr, err)
		}
		if got, ok := radicals[e.ID]; !ok || got != e.ID {
			t.Errorf("Kangxi radical %d of %s = entry %d (linked %v), want its own entry %d", a.n, a.chr, got, ok, e.ID)
		}
	}
}
