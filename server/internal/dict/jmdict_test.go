package dict_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"qinqin/internal/dict"
	"qinqin/internal/model"
	"qinqin/internal/pack"
)

// jmdictFixture is the committed JMdict sample, relative to this
// package's test working directory.
const jmdictFixture = "testdata/jmdict-sample.xml"

// jmdictManifest is the manifest of the pack loadJmdictFixture builds
// around the committed sample: the JMdict's own terms, under which its
// senses register.
var jmdictManifest = pack.Manifest{
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
func loadJmdictFixture(t *testing.T) pack.Pack {
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
	pk, err := pack.LoadPack(dir)
	if err != nil {
		t.Fatalf("LoadPack(jmdict sample): %v", err)
	}
	return pk
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
