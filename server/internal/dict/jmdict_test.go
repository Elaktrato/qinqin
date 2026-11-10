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
	"qinqin/internal/lang"
	"qinqin/internal/model"
)

// jmdictFixture is the committed JMdict sample, relative to this
// package's test working directory.
const jmdictFixture = "testdata/jmdict-sample.xml"

// jmdictManifest is the manifest of the pack loadJmdictFixture builds
// around the committed sample: the JMdict's own terms, under which its
// senses register.
var jmdictManifest = dict.Manifest{
	ID:          "jmdict-sample",
	Name:        "JMdict sample",
	Version:     "1.0",
	Type:        "dictionary",
	Language:    "ja",
	License:     "CC BY-SA 4.0",
	Attribution: "Electronic Dictionary Research and Development Group (EDRDG)",
	Format:      "jmdict",
}

// loadJmdictFixture builds the pack around the committed sample: its
// manifest plus a jmdict.xml holding the fixture verbatim.
func loadJmdictFixture(t *testing.T) dict.Pack {
	t.Helper()
	data, err := os.ReadFile(jmdictFixture)
	if err != nil {
		t.Fatalf("read %s: %v", jmdictFixture, err)
	}
	dir := t.TempDir()
	manifest, err := json.Marshal(jmdictManifest)
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	mustWriteFile(t, filepath.Join(dir, "manifest.json"), string(manifest))
	mustWriteFile(t, filepath.Join(dir, "jmdict.xml"), string(data))
	pack, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatalf("LoadPack(jmdict sample): %v", err)
	}
	return pack
}

func TestJmdictParse(t *testing.T) {
	f, err := os.Open(jmdictFixture)
	if err != nil {
		t.Fatalf("open %s: %v", jmdictFixture, err)
	}
	defer f.Close()
	es, err := dict.ParseJMdict(f)
	if err != nil {
		t.Fatalf("ParseJMdict(%s): %v", jmdictFixture, err)
	}
	if len(es) != 2 {
		t.Fatalf("ParseJMdict(%s) = %d entries, want 2", jmdictFixture, len(es))
	}

	// 学校: the first kanji form written, the rest variant forms, the
	// kana reading typed kana, only the English gloss kept — the Dutch
	// gloss and the DTD entities stay out.
	gakkou := es[0]
	if gakkou.Written != "学校" || !slices.Equal(gakkou.Forms, []string{"學校"}) {
		t.Errorf("parsed 学校 = %+v, want written 学校 with variant form 學校", gakkou)
	}
	wantReadings := []model.Reading{{Type: "kana", Value: "がっこう"}}
	if !slices.Equal(gakkou.Readings, wantReadings) {
		t.Errorf("readings of 学校 = %+v, want %+v", gakkou.Readings, wantReadings)
	}
	if got := gakkou.Glosses; !slices.Equal(got, []string{"school"}) {
		t.Errorf("glosses of 学校 = %v, want [school] — the Dutch gloss stays out", got)
	}

	// これ: a word without a kanji form is written as its first kana
	// reading; its two glosses keep their sense order.
	kore := es[1]
	if kore.Written != "これ" || len(kore.Forms) != 0 {
		t.Errorf("parsed これ = %+v, want written これ with no variant forms", kore)
	}
	wantReadings = []model.Reading{{Type: "kana", Value: "これ"}}
	if !slices.Equal(kore.Readings, wantReadings) {
		t.Errorf("readings of これ = %+v, want %+v", kore.Readings, wantReadings)
	}
	if got := kore.Glosses; !slices.Equal(got, []string{"this", "this one (indicating an item near the listener)"}) {
		t.Errorf("glosses of これ = %v, want both glosses in sense order", got)
	}
}

func TestJmdictParseRejectsBadInput(t *testing.T) {
	// Malformed XML.
	if _, err := dict.ParseJMdict(strings.NewReader("not xml")); err == nil || !strings.Contains(err.Error(), "jmdict") {
		t.Errorf("ParseJMdict(malformed) = %v, want an error naming the format", err)
	}
	// An entry with neither a kanji form nor a reading.
	if _, err := dict.ParseJMdict(strings.NewReader(
		`<JMdict><entry><ent_seq>1</ent_seq><sense><gloss>x</gloss></sense></entry></JMdict>`)); err == nil || !strings.Contains(err.Error(), "no kanji form") {
		t.Errorf("ParseJMdict(entry without form or reading) = %v, want an error naming the gap", err)
	}
	// An entry with no English glosses.
	if _, err := dict.ParseJMdict(strings.NewReader(
		`<JMdict><entry><ent_seq>2</ent_seq><r_ele><reb>れ</reb></r_ele><sense><gloss xml:lang="dut">x</gloss></sense></entry></JMdict>`)); err == nil || !strings.Contains(err.Error(), "English glosses") {
		t.Errorf("ParseJMdict(entry without English glosses) = %v, want an error naming the glosses", err)
	}
}

func TestJmdictImport(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)
	pack := loadJmdictFixture(t)

	res, err := dict.Import(ctx, sqlDB, pack)
	if err != nil {
		t.Fatalf("Import(jmdict sample): %v", err)
	}
	// Three word entries — 学校, its 學校 variant form, これ — and four
	// senses: school for both kanji forms, これ's two glosses.
	if res.Entries != 3 || res.Senses != 4 {
		t.Fatalf("Import(jmdict sample) = %+v, want 3 entries and 4 senses", res)
	}
	dictID := dictionaryID(t, sqlDB, "jmdict-sample")

	st := entries.Store{DB: sqlDB}
	gakkou := mustGet(t, st, "学校", "word", "ja")

	// The kana reading with its hiragana plain form, plus the romaji
	// reading the ja pack derived from it inside the upsert.
	wantReadings := []model.Reading{
		{Type: "kana", Value: "がっこう", Plain: "がっこう", Ord: 0},
		{Type: "romaji", Value: "gakkou", Plain: "gakkou", Ord: 1},
	}
	if !slices.Equal(gakkou.Readings, wantReadings) {
		t.Errorf("readings of 学校 = %+v, want %+v", gakkou.Readings, wantReadings)
	}

	// A romaji query matches the kana reading's plain form — the point
	// of the canonical form.
	if got := lang.For("ja").SearchPlain("gakkou"); got != wantReadings[0].Plain {
		t.Errorf(`SearchPlain("gakkou") = %q, want the kana plain %q`, got, wantReadings[0].Plain)
	}

	// The 學校 form is its own entry, variant-linked both ways, with
	// the readings and glosses carried over.
	kyuukou := mustGet(t, st, "學校", "word", "ja")
	if !slices.Equal(kyuukou.Readings, wantReadings) {
		t.Errorf("readings of 學校 = %+v, want the readings carried over", kyuukou.Readings)
	}
	wantVariants(t, st, gakkou, "學校")
	wantVariants(t, st, kyuukou, "学校")

	// The kana-only word is written as its reading, with its romaji
	// derived and no variants.
	kore := mustGet(t, st, "これ", "word", "ja")
	wantKore := []model.Reading{
		{Type: "kana", Value: "これ", Plain: "これ", Ord: 0},
		{Type: "romaji", Value: "kore", Plain: "kore", Ord: 1},
	}
	if !slices.Equal(kore.Readings, wantKore) {
		t.Errorf("readings of これ = %+v, want %+v", kore.Readings, wantKore)
	}
	wantVariants(t, st, kore)

	// Glosses under the pack's own dictionary.
	if got := activeGlosses(t, sqlDB, dictID, gakkou.ID); !slices.Equal(got, []string{"school"}) {
		t.Errorf("glosses of 学校 = %v, want [school]", got)
	}
	if got := activeGlosses(t, sqlDB, dictID, kyuukou.ID); !slices.Equal(got, []string{"school"}) {
		t.Errorf("glosses of 學校 = %v, want [school] — both forms get the sense", got)
	}
	if got := activeGlosses(t, sqlDB, dictID, kore.ID); !slices.Equal(got, []string{"this", "this one (indicating an item near the listener)"}) {
		t.Errorf("glosses of これ = %v, want both glosses in order", got)
	}

	// ja is a registered code pack: importing it creates no language row.
	var jaRows int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM languages WHERE code = 'ja'`).Scan(&jaRows); err != nil {
		t.Fatalf("count ja language rows: %v", err)
	}
	if jaRows != 0 {
		t.Errorf("ja language rows = %d, want 0 (ja is a code pack, not data-only)", jaRows)
	}

	// Re-importing is idempotent: same counts, same entry ids, links not
	// duplicated, senses replaced wholesale.
	if res, err := dict.Import(ctx, sqlDB, pack); err != nil {
		t.Fatalf("re-import jmdict sample: %v", err)
	} else if res.Entries != 3 || res.Senses != 4 {
		t.Errorf("re-import = %+v, want 3 entries and 4 senses again", res)
	}
	again := mustGet(t, st, "学校", "word", "ja")
	if again.ID != gakkou.ID {
		t.Errorf("id of 学校 after re-import = %d, want %d", again.ID, gakkou.ID)
	}
	wantVariants(t, st, again, "學校")
	if a, d := senseCounts(t, sqlDB, dictID); a != 4 || d != 0 {
		t.Errorf("senses after re-import = %d active, %d tombstoned, want 4 and 0", a, d)
	}
}
