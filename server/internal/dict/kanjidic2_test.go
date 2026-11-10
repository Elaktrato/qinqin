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

// kanjidic2Fixture is the committed KANJIDIC2 sample, relative to this
// package's test working directory.
const kanjidic2Fixture = "testdata/kanjidic2-sample.xml"

// kanjidic2Manifest is the manifest of the pack loadKanjidic2Fixture
// builds around the committed sample. Its own license terms are
// overridden at import by the built-in kanjidic2 dictionary's — the
// manifest still validates.
var kanjidic2Manifest = dict.Manifest{
	ID:          "kanjidic2-sample",
	Name:        "KANJIDIC2 sample",
	Version:     "1.0",
	Type:        "dictionary",
	Language:    "ja",
	License:     "CC BY-SA 4.0",
	Attribution: "Qinqin test fixtures",
	Format:      "kanjidic2",
}

// loadKanjidic2Fixture builds the pack around the committed sample: its
// manifest plus a kanjidic2.xml holding the fixture verbatim.
func loadKanjidic2Fixture(t *testing.T) dict.Pack {
	t.Helper()
	data, err := os.ReadFile(kanjidic2Fixture)
	if err != nil {
		t.Fatalf("read %s: %v", kanjidic2Fixture, err)
	}
	dir := t.TempDir()
	manifest, err := json.Marshal(kanjidic2Manifest)
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	mustWriteFile(t, filepath.Join(dir, "manifest.json"), string(manifest))
	mustWriteFile(t, filepath.Join(dir, "kanjidic2.xml"), string(data))
	pack, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatalf("LoadPack(kanjidic2 sample): %v", err)
	}
	return pack
}

func TestKanjidic2Parse(t *testing.T) {
	f, err := os.Open(kanjidic2Fixture)
	if err != nil {
		t.Fatalf("open %s: %v", kanjidic2Fixture, err)
	}
	defer f.Close()
	es, err := dict.ParseKanjidic2(f)
	if err != nil {
		t.Fatalf("ParseKanjidic2(%s): %v", kanjidic2Fixture, err)
	}
	if len(es) != 2 {
		t.Fatalf("ParseKanjidic2(%s) = %d entries, want 2", kanjidic2Fixture, len(es))
	}

	// 日: ON and KUN readings as written, the English meaning as its
	// only gloss, the first stroke count, the classical radical. The
	// nanori, the pinyin reading, and the Spanish meaning stay out.
	nichi := es[0]
	if nichi.Written != "日" || nichi.Radical != 72 || nichi.Attrs["strokes"] != "4" {
		t.Errorf("parsed 日 = %+v, want radical 72 and strokes 4", nichi)
	}
	wantReadings := []model.Reading{
		{Type: "on", Value: "ニチ"},
		{Type: "on", Value: "ジツ"},
		{Type: "kun", Value: "ひ"},
	}
	if !slices.Equal(nichi.Readings, wantReadings) {
		t.Errorf("readings of 日 = %+v, want %+v — nanori and pinyin stay out", nichi.Readings, wantReadings)
	}
	if got := nichi.Glosses; !slices.Equal(got, []string{"day, sun"}) {
		t.Errorf("glosses of 日 = %v, want [day, sun] — the Spanish meaning stays out", got)
	}

	// 学: kun with okurigana punctuation kept as written, two meanings.
	gaku := es[1]
	if gaku.Written != "学" || gaku.Radical != 39 || gaku.Attrs["strokes"] != "8" {
		t.Errorf("parsed 学 = %+v, want radical 39 and strokes 8", gaku)
	}
	wantReadings = []model.Reading{
		{Type: "on", Value: "ガク"},
		{Type: "kun", Value: "まな.ぶ"},
	}
	if !slices.Equal(gaku.Readings, wantReadings) {
		t.Errorf("readings of 学 = %+v, want %+v", gaku.Readings, wantReadings)
	}
	if got := gaku.Glosses; !slices.Equal(got, []string{"study", "learning"}) {
		t.Errorf("glosses of 学 = %v, want [study learning]", got)
	}
}

func TestKanjidic2ParseRejectsBadInput(t *testing.T) {
	// Malformed XML.
	if _, err := dict.ParseKanjidic2(strings.NewReader("not xml")); err == nil || !strings.Contains(err.Error(), "kanjidic2") {
		t.Errorf("ParseKanjidic2(malformed) = %v, want an error naming the format", err)
	}
	// A character without a literal.
	if _, err := dict.ParseKanjidic2(strings.NewReader(
		`<kanjidic2><character><misc><stroke_count>4</stroke_count></misc></character></kanjidic2>`)); err == nil || !strings.Contains(err.Error(), "literal") {
		t.Errorf("ParseKanjidic2(character without literal) = %v, want an error naming the literal", err)
	}
}

func TestKanjidic2Import(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)
	pack := loadKanjidic2Fixture(t)

	res, err := dict.Import(ctx, sqlDB, pack)
	if err != nil {
		t.Fatalf("Import(kanjidic2 sample): %v", err)
	}
	// Two characters, three senses: 日's one meaning and 学's two.
	if res.Entries != 2 || res.Senses != 3 {
		t.Fatalf("Import(kanjidic2 sample) = %+v, want 2 entries and 3 senses", res)
	}
	dictID := dictionaryID(t, sqlDB, "kanjidic2")

	// The import registers the built-in kanjidic2 dictionary with the
	// EDRDG's terms, whatever the manifest carried.
	var license, attribution string
	if err := sqlDB.QueryRow(`SELECT license, attribution FROM dictionaries WHERE pack_id = 'kanjidic2'`).
		Scan(&license, &attribution); err != nil {
		t.Fatalf("read kanjidic2 dictionary row: %v", err)
	}
	if license != "CC BY-SA 4.0" || attribution != "Electronic Dictionary Research and Development Group (EDRDG)" {
		t.Errorf("kanjidic2 dictionary terms = %q / %q, want the built-in EDRDG terms", license, attribution)
	}

	st := entries.Store{DB: sqlDB}
	nichi := mustGet(t, st, "日", "character", "ja")

	// ON readings as written (katakana), KUN readings as written, plains
	// folded to hiragana by the ja pack. Kanji readings derive no
	// romaji — only kana readings do.
	wantReadings := []model.Reading{
		{Type: "on", Value: "ニチ", Plain: "にち", Ord: 0},
		{Type: "on", Value: "ジツ", Plain: "じつ", Ord: 1},
		{Type: "kun", Value: "ひ", Plain: "ひ", Ord: 2},
	}
	if !slices.Equal(nichi.Readings, wantReadings) {
		t.Errorf("readings of 日 = %+v, want %+v", nichi.Readings, wantReadings)
	}
	if r := findReading(nichi, "romaji"); r != nil {
		t.Errorf("romaji reading of 日 = %q, want none — kanji readings derive no romaji", r.Value)
	}
	if nichi.Attrs["strokes"] != "4" {
		t.Errorf(`attrs of 日 = %v, want strokes "4"`, nichi.Attrs)
	}
	// Radical 72 is 日 itself: the character classifies under its own
	// entry.
	if nichi.RadicalID == nil || *nichi.RadicalID != nichi.ID {
		t.Errorf("radical of 日 = %v, want its own id %d (radical 72 is 日)", nichi.RadicalID, nichi.ID)
	}

	// 学 classifies under 子 (radical 39): the radical's bare entry is
	// upserted when the dictionary has none, and 学 is findable under it.
	gaku := mustGet(t, st, "学", "character", "ja")
	wantReadings = []model.Reading{
		{Type: "on", Value: "ガク", Plain: "がく", Ord: 0},
		{Type: "kun", Value: "まな.ぶ", Plain: "まなぶ", Ord: 1},
	}
	if !slices.Equal(gaku.Readings, wantReadings) {
		t.Errorf("readings of 学 = %+v, want %+v — okurigana punctuation drops from the plain", gaku.Readings, wantReadings)
	}
	if gaku.Attrs["strokes"] != "8" {
		t.Errorf(`attrs of 学 = %v, want strokes "8"`, gaku.Attrs)
	}
	ko := mustGet(t, st, "子", "character", "ja")
	if len(ko.Readings) != 0 {
		t.Errorf("readings of 子 = %+v, want none — the radical entry is bare", ko.Readings)
	}
	if gaku.RadicalID == nil || *gaku.RadicalID != ko.ID {
		t.Errorf("radical of 学 = %v, want 子's id %d", gaku.RadicalID, ko.ID)
	}
	chars, err := st.CharsUnder(ctx, ko.ID)
	if err != nil {
		t.Fatalf("CharsUnder(子): %v", err)
	}
	if len(chars) != 1 || chars[0].ID != gaku.ID {
		t.Errorf("CharsUnder(子) = %v, want just 学 (id %d)", chars, gaku.ID)
	}

	// Senses: 日's meaning and 学's two meanings under the built-in
	// kanjidic2 dictionary.
	if got := activeGlosses(t, sqlDB, dictID, nichi.ID); !slices.Equal(got, []string{"day, sun"}) {
		t.Errorf("glosses of 日 = %v, want [day, sun]", got)
	}
	if got := activeGlosses(t, sqlDB, dictID, gaku.ID); !slices.Equal(got, []string{"study", "learning"}) {
		t.Errorf("glosses of 学 = %v, want [study learning]", got)
	}

	// ja is a registered code pack: importing it creates no language row.
	var jaRows int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM languages WHERE code = 'ja'`).Scan(&jaRows); err != nil {
		t.Fatalf("count ja language rows: %v", err)
	}
	if jaRows != 0 {
		t.Errorf("ja language rows = %d, want 0 (ja is a code pack, not data-only)", jaRows)
	}

	// Everything the import wrote: the two characters plus the bare
	// radical 子.
	var entryRows int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM entries WHERE deleted_at IS NULL`).Scan(&entryRows); err != nil {
		t.Fatalf("count entries: %v", err)
	}
	if entryRows != 3 {
		t.Errorf("entries = %d, want 3 — 2 character entries, the bare radical 子", entryRows)
	}

	// Re-importing is idempotent: same counts, same entry ids, senses
	// replaced wholesale.
	if res, err := dict.Import(ctx, sqlDB, pack); err != nil {
		t.Fatalf("re-import kanjidic2 sample: %v", err)
	} else if res.Entries != 2 || res.Senses != 3 {
		t.Errorf("re-import = %+v, want 2 entries and 3 senses again", res)
	}
	if again := mustGet(t, st, "日", "character", "ja"); again.ID != nichi.ID {
		t.Errorf("id of 日 after re-import = %d, want %d", again.ID, nichi.ID)
	}
	if again := mustGet(t, st, "子", "character", "ja"); again.ID != ko.ID {
		t.Errorf("id of 子 after re-import = %d, want %d", again.ID, ko.ID)
	}
	if a, d := senseCounts(t, sqlDB, dictID); a != 3 || d != 0 {
		t.Errorf("senses after re-import = %d active, %d tombstoned, want 3 and 0", a, d)
	}
}
