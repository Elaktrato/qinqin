package dict_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"qinqin/internal/dict"
	"qinqin/internal/entries"
	"qinqin/internal/model"
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

// importUnihanFixture loads and imports the pack built around the
// committed sample.
func importUnihanFixture(t *testing.T, ctx context.Context, sqlDB *sql.DB) dict.Result {
	t.Helper()
	res, err := dict.Import(ctx, sqlDB, loadUnihanFixture(t))
	if err != nil {
		t.Fatalf("Import(unihan sample): %v", err)
	}
	return res
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
	return dict.Import(ctx, sqlDB, pack)
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
			"U+597D\tkTotalStrokes\t3\n" + // as are stroke counts
			"# a comment line\n" +
			"U+597D\tkRSUnicode\t38.6\n"))
	if err != nil {
		t.Fatalf("ParseUnihan: %v", err)
	}
	if len(data.Radicals) != 1 || data.Radicals["好"] != 38 {
		t.Errorf("Radicals = %v, want only 好 -> 38", data.Radicals)
	}
	if len(data.Definitions) != 0 || len(data.TradVariants) != 0 || len(data.SimpVariants) != 0 {
		t.Errorf("unconsumed fields parsed: %+v", data)
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
		t.Fatalf("Import(214 radical counts): %v", err)
	}
	if res.Entries != 214 || res.Senses != 0 {
		t.Errorf("Import(214 radical counts) = %+v, want 214 entries and 0 senses", res)
	}

	for _, n := range []int{0, 215} {
		sqlDB := newDB(t)
		_, err := importUnihanPack(t, ctx, sqlDB, unihanManifest, fmt.Sprintf("U+4E00\tkRSUnicode\t%d.0", n))
		if err == nil || !strings.Contains(err.Error(), "Kangxi") {
			t.Errorf("radical %d: Import = %v, want an error naming the Kangxi radicals", n, err)
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
		t.Fatalf("Import(radical anchors): %v", err)
	}
	st := entries.Store{DB: sqlDB}
	for _, a := range anchors {
		e := mustGet(t, st, a.chr, "character", "zh")
		if e.RadicalID == nil || *e.RadicalID != e.ID {
			under := "nothing"
			if e.RadicalID != nil {
				if r, err := st.GetByID(ctx, *e.RadicalID); err == nil {
					under = r.Written
				}
			}
			t.Errorf("Kangxi radical %d = %q, want %q", a.n, under, a.chr)
		}
	}
}

// TestManyToManyVariants: 复's simplified/traditional mapping spans two
// traditional forms — three entries, linked as variants in both
// directions.
func TestManyToManyVariants(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)
	res := importUnihanFixture(t, ctx, sqlDB)
	if res.Entries != 4 || res.Senses != 1 {
		t.Fatalf("Import(unihan sample) = %+v, want 4 entries (好 and the 复/復/複 trio) and 1 sense", res)
	}
	st := entries.Store{DB: sqlDB}
	fu := mustGet(t, st, "复", "character", "zh")
	fuFu := mustGet(t, st, "復", "character", "zh")
	fuZa := mustGet(t, st, "複", "character", "zh")
	if fu.ID == fuFu.ID || fu.ID == fuZa.ID || fuFu.ID == fuZa.ID {
		t.Fatalf("the variant trio 复/復/複 collapsed into one entry: ids %d %d %d", fu.ID, fuFu.ID, fuZa.ID)
	}
	for _, e := range []model.Entry{fu, fuFu, fuZa} {
		if e.Kind != "character" || e.Language != "zh" {
			t.Errorf("entry %s = %s/%s, want a zh character", e.Written, e.Kind, e.Language)
		}
		if len(e.Readings) != 0 {
			t.Errorf("readings of %s = %+v, want none — Unihan fields carry no pronunciation", e.Written, e.Readings)
		}
	}
	wantVariants(t, st, fu, "復", "複")
	wantVariants(t, st, fuFu, "复")
	wantVariants(t, st, fuZa, "复")
	// Exactly the two pairs, stored in both directions — the lines name
	// them from both sides, and linking twice must not duplicate.
	var variantLinks int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM entry_links
		WHERE type = 'variant' AND deleted_at IS NULL`).Scan(&variantLinks); err != nil {
		t.Fatalf("count variant links: %v", err)
	}
	if variantLinks != 4 {
		t.Errorf("variant links = %d, want 4 — 复↔復 and 复↔複, both directions", variantLinks)
	}
}

// TestUnihanDefinitions: 好's kDefinition becomes a sense under the
// built-in "unihan" dictionary, registered with the Unihan database's
// license terms.
func TestUnihanDefinitions(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)
	importUnihanFixture(t, ctx, sqlDB)
	dictID := dictionaryID(t, sqlDB, "unihan")

	var name, version, license, attribution string
	var deletedAt sql.NullString
	err := sqlDB.QueryRow(`SELECT name, version, license, attribution, deleted_at
		FROM dictionaries WHERE pack_id = 'unihan'`).Scan(&name, &version, &license, &attribution, &deletedAt)
	if err != nil {
		t.Fatalf("read unihan dictionary row: %v", err)
	}
	if name != unihanManifest.Name || version != unihanManifest.Version ||
		license != unihanManifest.License || attribution != unihanManifest.Attribution {
		t.Errorf("unihan dictionary row = %q %q %q %q, want the manifest's name/version/license/attribution", name, version, license, attribution)
	}
	if deletedAt.Valid {
		t.Errorf("unihan dictionary deleted_at = %v, want active", deletedAt)
	}

	st := entries.Store{DB: sqlDB}
	hao := mustGet(t, st, "好", "character", "zh")
	if got := activeGlosses(t, sqlDB, dictID, hao.ID); !slices.Equal(got, []string{"good, excellent, fine; well"}) {
		t.Errorf("glosses of 好 = %v, want the unquoted kDefinition string as one sense", got)
	}
}

// TestUnihanBuiltInDictionary: the dictionary a unihan pack registers is
// the built-in "unihan" one, whatever the pack's manifest id — the Unihan
// database is one canonical dataset.
func TestUnihanBuiltInDictionary(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)
	data, err := os.ReadFile(unihanFixture)
	if err != nil {
		t.Fatalf("read %s: %v", unihanFixture, err)
	}
	m := unihanManifest
	m.ID = "unihan-15.1.0-sample"
	m.Name = "Unihan database 15.1.0 sample"
	res, err := importUnihanPack(t, ctx, sqlDB, m, strings.Split(strings.TrimRight(string(data), "\n"), "\n")...)
	if err != nil {
		t.Fatalf("Import(unihan sample pack): %v", err)
	}
	if res.Entries != 4 || res.Senses != 1 {
		t.Fatalf("Import(unihan sample pack) = %+v, want 4 entries and 1 sense", res)
	}

	dictID := dictionaryID(t, sqlDB, "unihan")
	var packID, license, attribution string
	if err := sqlDB.QueryRow(`SELECT pack_id, license, attribution
		FROM dictionaries WHERE id = ?`, dictID).Scan(&packID, &license, &attribution); err != nil {
		t.Fatalf("read unihan dictionary row: %v", err)
	}
	if packID != "unihan" || license != m.License || attribution != m.Attribution {
		t.Errorf("dictionary row = %q %q %q, want pack id unihan with the manifest's license %q and attribution %q",
			packID, license, attribution, m.License, m.Attribution)
	}
	var manifestKeyed int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM dictionaries
		WHERE pack_id = 'unihan-15.1.0-sample'`).Scan(&manifestKeyed); err != nil {
		t.Fatalf("count dictionaries keyed by the manifest id: %v", err)
	}
	if manifestKeyed != 0 {
		t.Errorf("dictionaries keyed by the manifest id = %d, want 0 — the manifest id is not the built-in's key", manifestKeyed)
	}
}

// TestRadicalAssignment: U+597D kRSUnicode 38.6 puts 好 under radical 38 —
// the entry for 女, which exists only through the Kangxi table.
func TestRadicalAssignment(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)
	importUnihanFixture(t, ctx, sqlDB)
	st := entries.Store{DB: sqlDB}

	hao := mustGet(t, st, "好", "character", "zh")
	nu := mustGet(t, st, "女", "character", "zh")
	if hao.RadicalID == nil || *hao.RadicalID != nu.ID {
		t.Errorf("RadicalID of 好 = %v, want the entry of 女 (id %d) — 38 is 女's Kangxi number", hao.RadicalID, nu.ID)
	}

	// The radical character itself is an entry, fetchable by id — the
	// promise behind GET /api/entries/{id} on a radical.
	byID, err := st.GetByID(ctx, nu.ID)
	if err != nil {
		t.Fatalf("GetByID(id of 女): %v", err)
	}
	if byID.Written != "女" || byID.Kind != "character" || byID.Language != "zh" {
		t.Errorf("entry %d = %s (%s/%s), want 女 the zh character", nu.ID, byID.Written, byID.Kind, byID.Language)
	}

	// 好 is findable under its radical.
	chars, err := st.CharsUnder(ctx, nu.ID)
	if err != nil {
		t.Fatalf("CharsUnder(女): %v", err)
	}
	found := false
	for _, c := range chars {
		if c.ID == hao.ID {
			found = true
		}
	}
	if !found {
		t.Errorf("CharsUnder(女) = %d entries, none of them 好", len(chars))
	}

	// The sample's whole footprint: 好, the variant trio 复/復/複, and the
	// radical 女 — five entries.
	var entryRows int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM entries WHERE deleted_at IS NULL`).Scan(&entryRows); err != nil {
		t.Fatalf("count entries: %v", err)
	}
	if entryRows != 5 {
		t.Errorf("entries = %d, want 5 — 好, 复, 復, 複, and 女 via the Kangxi table", entryRows)
	}
}

func TestUnihanImportIdempotent(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)
	first := importUnihanFixture(t, ctx, sqlDB)

	st := entries.Store{DB: sqlDB}
	ids := map[string]int64{}
	for _, written := range []string{"好", "复", "復", "複", "女"} {
		ids[written] = mustGet(t, st, written, "character", "zh").ID
	}

	second := importUnihanFixture(t, ctx, sqlDB)
	if second.Entries != first.Entries || second.Senses != first.Senses {
		t.Errorf("re-import = %+v, want the same counts as %+v", second, first)
	}
	for _, written := range []string{"好", "复", "復", "複", "女"} {
		if id := mustGet(t, st, written, "character", "zh").ID; id != ids[written] {
			t.Errorf("id of %s after re-import = %d, want %d", written, id, ids[written])
		}
	}
	if got := activeLinkCount(t, sqlDB, "variant"); got != 4 {
		t.Errorf("variant links after re-import = %d, want 4 — linking twice must not duplicate", got)
	}
	if got := activeLinkCount(t, sqlDB, "radical"); got != 1 {
		t.Errorf("radical links after re-import = %d, want 1", got)
	}
	if a, d := senseCounts(t, sqlDB, dictionaryID(t, sqlDB, "unihan")); a != 1 || d != 0 {
		t.Errorf("senses after re-import = %d active, %d tombstoned, want 1 and 0", a, d)
	}
	var entryRows int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM entries WHERE deleted_at IS NULL`).Scan(&entryRows); err != nil {
		t.Fatalf("count entries: %v", err)
	}
	if entryRows != 5 {
		t.Errorf("entries after re-import = %d, want 5", entryRows)
	}
}

// activeLinkCount counts the active entry_links of the given type.
func activeLinkCount(t *testing.T, sqlDB *sql.DB, linkType string) int {
	t.Helper()
	var n int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM entry_links
		WHERE type = ? AND deleted_at IS NULL`, linkType).Scan(&n); err != nil {
		t.Fatalf("count %s links: %v", linkType, err)
	}
	return n
}

// TestUnihanPreservesExistingReadings: a unihan import fits around
// another dictionary's data — 好's readings and mkgloss senses survive,
// and the radical and the unihan sense arrive on the same entry.
func TestUnihanPreservesExistingReadings(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)
	importFixture(t, ctx, sqlDB) // mkgloss: 好 with a pinyin reading
	importUnihanFixture(t, ctx, sqlDB)

	st := entries.Store{DB: sqlDB}
	hao := mustGet(t, st, "好", "character", "zh")
	if py := findReading(hao, "pinyin"); py == nil || py.Value != "hǎo" || py.Plain != "hao" {
		t.Errorf("readings of 好 = %+v, want the pinyin reading kept", hao.Readings)
	}
	if bm := findReading(hao, "bopomofo"); bm == nil || bm.Value != "ㄏㄠˇ" {
		t.Errorf("readings of 好 = %+v, want the derived bopomofo kept", hao.Readings)
	}
	nu := mustGet(t, st, "女", "character", "zh")
	if hao.RadicalID == nil || *hao.RadicalID != nu.ID {
		t.Errorf("RadicalID of 好 = %v, want the entry of 女 (id %d)", hao.RadicalID, nu.ID)
	}
	if got := activeGlosses(t, sqlDB, dictionaryID(t, sqlDB, "mkgloss"), hao.ID); !slices.Equal(got, []string{"good"}) {
		t.Errorf("glosses of 好 under mkgloss = %v, want [good] — the other dictionary's senses survive", got)
	}
	if got := activeGlosses(t, sqlDB, dictionaryID(t, sqlDB, "unihan"), hao.ID); !slices.Equal(got, []string{"good, excellent, fine; well"}) {
		t.Errorf("glosses of 好 under unihan = %v, want [good, excellent, fine; well]", got)
	}
}
