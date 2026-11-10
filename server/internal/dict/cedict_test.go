package dict_test

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"qinqin/internal/dict"
	"qinqin/internal/entries"
	"qinqin/internal/model"
)

// cedictFixture is the committed CC-CEDICT sample, relative to this
// package's test working directory.
const cedictFixture = "testdata/cedict-sample.txt"

// cedictManifest is the manifest of the pack loadCedictFixture builds
// around the committed sample.
var cedictManifest = dict.Manifest{
	ID:          "cedict-sample",
	Name:        "CC-CEDICT sample",
	Version:     "1.0",
	Type:        "dictionary",
	Language:    "zh",
	License:     "CC BY-SA 4.0",
	Attribution: "CC-CEDICT contributors",
	Format:      "cedict",
}

// loadCedictFixture builds the pack around the committed sample: its
// manifest plus a dictionary.txt holding the fixture's lines verbatim.
func loadCedictFixture(t *testing.T) dict.Pack {
	t.Helper()
	data, err := os.ReadFile(cedictFixture)
	if err != nil {
		t.Fatalf("read %s: %v", cedictFixture, err)
	}
	dir := t.TempDir()
	manifest, err := json.Marshal(cedictManifest)
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	mustWriteFile(t, filepath.Join(dir, "manifest.json"), string(manifest))
	mustWriteFile(t, filepath.Join(dir, "dictionary.txt"), string(data))
	pack, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatalf("LoadPack(cedict sample): %v", err)
	}
	return pack
}

// wantVariants asserts the entry's active variants are exactly want, by
// written form.
func wantVariants(t *testing.T, st entries.Store, e model.Entry, want ...string) {
	t.Helper()
	vs, err := st.Variants(context.Background(), e.ID)
	if err != nil {
		t.Fatalf("Variants(%s): %v", e.Written, err)
	}
	got := make([]string, len(vs))
	for i, v := range vs {
		got[i] = v.Written
	}
	if !slices.Equal(got, want) {
		t.Errorf("Variants(%s) = %v, want %v", e.Written, got, want)
	}
}

// wordsContaining returns the written forms of the words linked to the
// character entry, sorted so the assertion is order-independent.
func wordsContaining(t *testing.T, st entries.Store, char model.Entry) []string {
	t.Helper()
	ws, err := st.WordsContaining(context.Background(), char.ID)
	if err != nil {
		t.Fatalf("WordsContaining(%s): %v", char.Written, err)
	}
	got := make([]string, len(ws))
	for i, w := range ws {
		got[i] = w.Written
	}
	slices.Sort(got)
	return got
}

func TestCedictParse(t *testing.T) {
	f, err := os.Open(cedictFixture)
	if err != nil {
		t.Fatalf("open %s: %v", cedictFixture, err)
	}
	defer f.Close()
	es, err := dict.ParseCedict(f)
	if err != nil {
		t.Fatalf("ParseCedict(%s): %v", cedictFixture, err)
	}
	want := []dict.RawEntry{
		{Written: "头发", Trad: "頭髮", Pinyin: "tou2 fa5", Glosses: []string{"hair", "CL:根|gen1"}},
		{Written: "你好", Trad: "你好", Pinyin: "ni3 hao3", Glosses: []string{"hello", "hi"}},
		{Written: "发展", Trad: "發展", Pinyin: "fa1 zhan3", Glosses: []string{"to develop", "development"}},
	}
	if len(es) != len(want) {
		t.Fatalf("ParseCedict(%s) = %d entries, want %d", cedictFixture, len(es), len(want))
	}
	for i, e := range es {
		w := want[i]
		if e.Written != w.Written || e.Trad != w.Trad || e.Pinyin != w.Pinyin || !slices.Equal(e.Glosses, w.Glosses) {
			t.Errorf("entry %d = %+v, want %+v", i, e, w)
		}
	}
}

func TestCedictParseSkipsCommentsAndBlanks(t *testing.T) {
	es, err := dict.ParseCedict(strings.NewReader(
		"#! cc-cedict 1.0\n\n# a comment line\n你好 你好 [ni3 hao3] /hello/\n"))
	if err != nil {
		t.Fatalf("ParseCedict: %v", err)
	}
	if len(es) != 1 {
		t.Fatalf("ParseCedict parsed %d entries, want 1 — comments and blank lines are skipped", len(es))
	}
	if e := es[0]; e.Written != "你好" || e.Trad != "你好" || e.Pinyin != "ni3 hao3" ||
		!slices.Equal(e.Glosses, []string{"hello"}) {
		t.Errorf("parsed entry = %+v, want 你好 你好 [ni3 hao3] /hello/", e)
	}
}

func TestCedictParseRejectsMalformedLine(t *testing.T) {
	for _, tc := range []struct{ name, line string }{
		{"not an entry", "hello world"},
		{"missing trailing slash", "你好 你好 [ni3 hao3] /hello"},
		{"no glosses", "你好 你好 [ni3 hao3] //"},
	} {
		_, err := dict.ParseCedict(strings.NewReader(tc.line + "\n"))
		if err == nil || !strings.Contains(err.Error(), "line 1") {
			t.Errorf("%s: ParseCedict(%q) = %v, want an error naming line 1", tc.name, tc.line, err)
		}
	}
}

func TestCedictImport(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)
	pack := loadCedictFixture(t)

	res, err := dict.Import(ctx, sqlDB, pack)
	if err != nil {
		t.Fatalf("Import(cedict sample): %v", err)
	}
	// Three lines: two differing trad pairs (頭髮/头发, 發展/发展) and one
	// equal pair (你好) — five entry rows, ten senses (both forms of
	// each pair carry the glosses).
	if res.Entries != 5 || res.Senses != 10 {
		t.Fatalf("Import(cedict sample) = %+v, want 5 entries and 10 senses", res)
	}
	dictID := dictionaryID(t, sqlDB, "cedict-sample")

	st := entries.Store{DB: sqlDB}
	toufa := mustGet(t, st, "头发", "word", "zh")
	fazhan := mustGet(t, st, "发展", "word", "zh")
	nihao := mustGet(t, st, "你好", "word", "zh")
	tradToufa := mustGet(t, st, "頭髮", "word", "zh")
	tradFazhan := mustGet(t, st, "發展", "word", "zh")

	// The tone-numbered pinyin from the file is stored as the marked
	// reading; the zh pack filled its plain form and derived the
	// bopomofo inside the upsert.
	if py := findReading(toufa, "pinyin"); py == nil || py.Value != "tóu fa" || py.Plain != "toufa" {
		t.Errorf("readings of 头发 = %+v, want pinyin tóu fa with plain toufa", toufa.Readings)
	}
	if bm := findReading(toufa, "bopomofo"); bm == nil || bm.Value != "ㄊㄡˊ ㄈㄚ" {
		t.Errorf("readings of 头发 = %+v, want derived bopomofo ㄊㄡˊ ㄈㄚ", toufa.Readings)
	}
	if py := findReading(fazhan, "pinyin"); py == nil || py.Value != "fā zhǎn" || py.Plain != "fazhan" {
		t.Errorf("readings of 发展 = %+v, want pinyin fā zhǎn with plain fazhan", fazhan.Readings)
	}
	if bm := findReading(fazhan, "bopomofo"); bm == nil || bm.Value != "ㄈㄚ ㄓㄢˇ" {
		t.Errorf("readings of 发展 = %+v, want derived bopomofo ㄈㄚ ㄓㄢˇ", fazhan.Readings)
	}
	if py := findReading(nihao, "pinyin"); py == nil || py.Value != "nǐ hǎo" || py.Plain != "nihao" {
		t.Errorf("readings of 你好 = %+v, want pinyin nǐ hǎo with plain nihao", nihao.Readings)
	}
	if py := findReading(tradToufa, "pinyin"); py == nil || py.Value != "tóu fa" {
		t.Errorf("readings of 頭髮 = %+v, want the readings carried over", tradToufa.Readings)
	}

	// The differing pairs are variant-linked both ways; 你好's trad
	// equals its written form, so no second entry and no link.
	wantVariants(t, st, toufa, "頭髮")
	wantVariants(t, st, tradToufa, "头发")
	wantVariants(t, st, fazhan, "發展")
	wantVariants(t, st, tradFazhan, "发展")
	wantVariants(t, st, nihao)

	// Both forms of a pair carry the glosses; the CL: measure-word
	// gloss is kept verbatim.
	if got := activeGlosses(t, sqlDB, dictID, toufa.ID); !slices.Equal(got, []string{"hair", "CL:根|gen1"}) {
		t.Errorf("glosses of 头发 = %v, want [hair CL:根|gen1] — CL: glosses kept as-is", got)
	}
	if got := activeGlosses(t, sqlDB, dictID, tradToufa.ID); !slices.Equal(got, []string{"hair", "CL:根|gen1"}) {
		t.Errorf("glosses of 頭髮 = %v, want the glosses carried over", got)
	}
	if got := activeGlosses(t, sqlDB, dictID, nihao.ID); !slices.Equal(got, []string{"hello", "hi"}) {
		t.Errorf("glosses of 你好 = %v, want [hello hi]", got)
	}
	if got := activeGlosses(t, sqlDB, dictID, fazhan.ID); !slices.Equal(got, []string{"to develop", "development"}) {
		t.Errorf("glosses of 发展 = %v, want [to develop development]", got)
	}

	// Word→character links: every word form — the traditional ones
	// included — links to a character entry per distinct hanzi in it.
	// 发 is written in 头发 and 发展; 展 in 发展 and 發展; 髮 only in 頭髮.
	fa := mustGet(t, st, "发", "character", "zh")
	if got := wordsContaining(t, st, fa); !slices.Equal(got, []string{"发展", "头发"}) {
		t.Errorf("WordsContaining(发) = %v, want [发展 头发]", got)
	}
	zhan := mustGet(t, st, "展", "character", "zh")
	if got := wordsContaining(t, st, zhan); !slices.Equal(got, []string{"发展", "發展"}) {
		t.Errorf("WordsContaining(展) = %v, want [发展 發展]", got)
	}
	faTrad := mustGet(t, st, "髮", "character", "zh")
	if got := wordsContaining(t, st, faTrad); !slices.Equal(got, []string{"頭髮"}) {
		t.Errorf("WordsContaining(髮) = %v, want [頭髮] — the traditional form links to its own hanzi", got)
	}

	// The linked hanzi entries are bare: character kind, no readings,
	// no senses of this dictionary.
	if len(fa.Readings) != 0 {
		t.Errorf("readings of 发 = %+v, want none — linking creates bare character entries", fa.Readings)
	}
	if got := activeGlosses(t, sqlDB, dictID, fa.ID); len(got) != 0 {
		t.Errorf("glosses of 发 = %v, want none", got)
	}

	// Everything the import wrote: five word entries plus one bare
	// character entry per distinct hanzi — 頭髮头發你我好展 — and one
	// wordchar link per distinct hanzi per word form.
	var entryRows, wordCharLinks int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM entries WHERE deleted_at IS NULL`).Scan(&entryRows); err != nil {
		t.Fatalf("count entries: %v", err)
	}
	if entryRows != 13 {
		t.Errorf("entries = %d, want 13 — 5 word entries, 8 character entries", entryRows)
	}
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM entry_links
		WHERE type = 'wordchar' AND deleted_at IS NULL`).Scan(&wordCharLinks); err != nil {
		t.Fatalf("count wordchar links: %v", err)
	}
	if wordCharLinks != 10 {
		t.Errorf("wordchar links = %d, want 10 — one per distinct hanzi per word form", wordCharLinks)
	}

	// Task 2 standing check: a pinyin reading without a derived
	// bopomofo reading means the syllable table lacks a real syllable.
	// The fixture must convert cleanly.
	var missingBopomofo int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM entries e
		WHERE e.deleted_at IS NULL
			AND EXISTS (SELECT 1 FROM readings p
				WHERE p.entry_id = e.id AND p.type = 'pinyin' AND p.deleted_at IS NULL)
			AND NOT EXISTS (SELECT 1 FROM readings b
				WHERE b.entry_id = e.id AND b.type = 'bopomofo' AND b.deleted_at IS NULL)`).Scan(&missingBopomofo); err != nil {
		t.Fatalf("count entries missing bopomofo: %v", err)
	}
	if missingBopomofo != 0 {
		t.Errorf("entries with pinyin but no bopomofo = %d, want 0 — the syllable table lacks real syllables", missingBopomofo)
	}

	// Re-importing is idempotent: same counts, same entry ids, links
	// not duplicated, senses replaced wholesale.
	if res, err := dict.Import(ctx, sqlDB, pack); err != nil {
		t.Fatalf("re-import cedict sample: %v", err)
	} else if res.Entries != 5 || res.Senses != 10 {
		t.Errorf("re-import = %+v, want 5 entries and 10 senses again", res)
	}
	if again := mustGet(t, st, "头发", "word", "zh"); again.ID != toufa.ID {
		t.Errorf("id of 头发 after re-import = %d, want %d", again.ID, toufa.ID)
	}
	if again := mustGet(t, st, "发", "character", "zh"); again.ID != fa.ID {
		t.Errorf("id of 发 after re-import = %d, want %d", again.ID, fa.ID)
	}
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM entry_links
		WHERE type = 'wordchar' AND deleted_at IS NULL`).Scan(&wordCharLinks); err != nil {
		t.Fatalf("count wordchar links after re-import: %v", err)
	}
	if wordCharLinks != 10 {
		t.Errorf("wordchar links after re-import = %d, want 10 — linking twice must not duplicate", wordCharLinks)
	}
	if a, d := senseCounts(t, sqlDB, dictID); a != 10 || d != 10 {
		t.Errorf("senses after re-import = %d active, %d tombstoned, want 10 and 10", a, d)
	}
	if got := wordsContaining(t, st, fa); !slices.Equal(got, []string{"发展", "头发"}) {
		t.Errorf("WordsContaining(发) after re-import = %v, want [发展 头发]", got)
	}
}

func TestCedictWordLinksEachDistinctHanzi(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)
	dir := t.TempDir()
	manifest, err := json.Marshal(cedictManifest)
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	mustWriteFile(t, filepath.Join(dir, "manifest.json"), string(manifest))
	// A word written with the same hanzi twice links that hanzi once
	// per written form, not once per occurrence.
	mustWriteFile(t, filepath.Join(dir, "dictionary.txt"), "谢谢 謝謝 [xie4 xie5] /thank you/\n")
	pack, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatalf("LoadPack(repeated-hanzi sample): %v", err)
	}
	if _, err := dict.Import(ctx, sqlDB, pack); err != nil {
		t.Fatalf("Import(repeated-hanzi sample): %v", err)
	}
	st := entries.Store{DB: sqlDB}
	xie := mustGet(t, st, "谢", "character", "zh")
	if got := wordsContaining(t, st, xie); !slices.Equal(got, []string{"谢谢"}) {
		t.Errorf("WordsContaining(谢) = %v, want [谢谢]", got)
	}
	var links int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM entry_links
		WHERE type = 'wordchar' AND deleted_at IS NULL`).Scan(&links); err != nil {
		t.Fatalf("count wordchar links: %v", err)
	}
	if links != 2 {
		t.Errorf("wordchar links = %d, want 2 — 谢 for 谢谢 and 謝 for 謝謝, once each", links)
	}
}

func TestCedictImportUnconvertiblePinyin(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)
	dir := t.TempDir()
	manifest, err := json.Marshal(cedictManifest)
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	mustWriteFile(t, filepath.Join(dir, "manifest.json"), string(manifest))
	// an9 is not a Mandarin syllable: the entry still imports, with the
	// raw tone-numbered pinyin kept and the bopomofo underived.
	mustWriteFile(t, filepath.Join(dir, "dictionary.txt"), "晚安 晚安 [wan3 an9] /good night/\n")
	pack, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatalf("LoadPack(unconvertible sample): %v", err)
	}
	if _, err := dict.Import(ctx, sqlDB, pack); err != nil {
		t.Fatalf("Import(unconvertible sample): %v", err)
	}
	st := entries.Store{DB: sqlDB}
	wanan := mustGet(t, st, "晚安", "word", "zh")
	py := findReading(wanan, "pinyin")
	if py == nil || py.Value != "wan3 an9" || py.Plain != "wanan" {
		t.Errorf("readings of 晚安 = %+v, want the raw pinyin wan3 an9 with plain wanan", wanan.Readings)
	}
	if bm := findReading(wanan, "bopomofo"); bm != nil {
		t.Errorf("bopomofo of 晚安 = %q, want none — the syllable does not convert", bm.Value)
	}
	// The word still links to its hanzi.
	if got := wordsContaining(t, st, mustGet(t, st, "晚", "character", "zh")); !slices.Equal(got, []string{"晚安"}) {
		t.Errorf("WordsContaining(晚) = %v, want [晚安]", got)
	}
}
