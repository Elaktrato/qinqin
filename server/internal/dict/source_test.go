package dict_test

import (
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/dict"
	"qinqin/internal/lexicon"
)

// gzipBytes returns data compressed with gzip.
func gzipBytes(t *testing.T, data []byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	if _, err := zw.Write(data); err != nil {
		t.Fatalf("gzip write: %v", err)
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("gzip close: %v", err)
	}
	return buf.Bytes()
}

// writeCompressedPack writes manifest.json plus one compressed payload
// file into a fresh temp directory and returns its path.
func writeCompressedPack(t *testing.T, m dict.Manifest, payloadName string, payload []byte) string {
	t.Helper()
	dir := t.TempDir()
	manifest, err := json.Marshal(m)
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	mustWriteFile(t, filepath.Join(dir, "manifest.json"), string(manifest))
	if err := os.WriteFile(filepath.Join(dir, payloadName), payload, 0o644); err != nil {
		t.Fatalf("write %s: %v", payloadName, err)
	}
	return dir
}

func compressedManifest(format, language string) dict.Manifest {
	return dict.Manifest{
		ID:          "compressed-" + format,
		Name:        "Compressed " + format + " pack",
		Version:     "1.0",
		Type:        "dictionary",
		Language:    language,
		License:     "CC BY-SA 4.0",
		Attribution: "test fixture",
		Format:      format,
	}
}

// readingValue returns the value of the first reading of the given type.
func readingValue(e lexicon.Entry, typ string) string {
	for _, r := range e.Readings {
		if r.Type == typ {
			return r.Value
		}
	}
	return ""
}

// importDir loads the pack in dir and imports it into the lexicon.
func importDir(t *testing.T, sqlDB *sql.DB, dir string) dict.Result {
	t.Helper()
	pack, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatalf("LoadPack: %v", err)
	}
	res, err := dict.ImportLexicon(context.Background(), sqlDB, &pack)
	if err != nil {
		t.Fatalf("ImportLexicon(%s): %v", pack.Manifest.Format, err)
	}
	return res
}

// byForm returns the active entry of kind with the written form, or
// nil.
func byForm(t *testing.T, sqlDB *sql.DB, language, kind, form string) *lexicon.Entry {
	t.Helper()
	found, err := lexicon.Store{DB: sqlDB}.ByForm(context.Background(), language, []string{form})
	if err != nil {
		t.Fatalf("ByForm(%s): %v", form, err)
	}
	for _, e := range found[form] {
		if e.Kind == kind {
			return &e
		}
	}
	return nil
}

// TestCedictImportReadsGz imports the cedict fixture from dictionary.txt.gz
// (its upstream distribution form) and checks the result matches the
// plain file's and the derived bopomofo reading survives the compressed
// path.
func TestCedictImportReadsGz(t *testing.T) {
	raw, err := os.ReadFile("testdata/cedict-sample.txt")
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	plain := importDir(t, dbtest.Open(t), writeCompressedPack(t, compressedManifest("cedict", "zh"), "dictionary.txt", raw))

	sqlDB := dbtest.Open(t)
	res := importDir(t, sqlDB, writeCompressedPack(t, compressedManifest("cedict", "zh"), "dictionary.txt.gz", gzipBytes(t, raw)))
	if res != plain || res.Entries == 0 {
		t.Fatalf("gz result = %+v, want the plain file's %+v", res, plain)
	}
	hello := byForm(t, sqlDB, "zh", "word", "你好")
	if hello == nil {
		t.Fatal("你好 not imported")
	}
	if got := readingValue(*hello, "bopomofo"); got != "ㄋㄧˇ ㄏㄠˇ" {
		t.Errorf("bopomofo reading = %q, want %q", got, "ㄋㄧˇ ㄏㄠˇ")
	}
}

// TestUnihanImportReadsZip imports the unihan fixture from Unihan.zip with
// the upstream member layout: radicals and definitions in the readings
// sources, variant mappings in the variants file.
func TestUnihanImportReadsZip(t *testing.T) {
	sqlDB := dbtest.Open(t)

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	members := map[string]string{
		"Unihan_IRGSources.txt": "U+597D\tkRSUnicode\t38.6\n",
		"Unihan_Variants.txt": "U+5FA9\tkSimplifiedVariant\tU+590D\n" +
			"U+8907\tkSimplifiedVariant\t复\n" +
			"U+590D\tkTraditionalVariant\tU+5FA9 U+8907\n",
		"Unihan_Readings.txt": "U+597D\tkDefinition\t\"good, excellent, fine; well\"\n",
	}
	for name, content := range members {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatalf("zip create %s: %v", name, err)
		}
		if _, err := w.Write([]byte(content)); err != nil {
			t.Fatalf("zip write %s: %v", name, err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("zip close: %v", err)
	}
	importDir(t, sqlDB, writeCompressedPack(t, compressedManifest("unihan", "zh"), "Unihan.zip", buf.Bytes()))

	fu := lexByKey(t, sqlDB, "zh", "character", "复")
	if got := lexLinks(t, sqlDB, fu, lexicon.LinkVariant); !slices.Equal(got, []string{"復", "複"}) {
		t.Errorf("variants of 复 = %v, want [復 複]", got)
	}

	hao := lexByKey(t, sqlDB, "zh", "character", "好")
	if got := lexLinks(t, sqlDB, hao, lexicon.LinkRadical); !slices.Equal(got, []string{"女"}) {
		t.Errorf("radical of 好 = %v, want [女]", got)
	}
	if got := senseGlosses(t, sqlDB, hao); !slices.Contains(got, "unihan: good, excellent, fine; well") {
		t.Errorf("unihan glosses of 好 = %v, want the kDefinition", got)
	}
}

// TestCedictPlainFileWinsOverGz pins the importer's source precedence:
// when both dictionary.txt and dictionary.txt.gz exist, the plain file
// wins. fetch-seeds.sh removes legacy plain payloads so a refreshed pack
// cannot silently keep importing the old data.
func TestCedictPlainFileWinsOverGz(t *testing.T) {
	sqlDB := dbtest.Open(t)
	plain, err := os.ReadFile("testdata/cedict-sample.txt")
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	dir := writeCompressedPack(t, compressedManifest("cedict", "zh"), "dictionary.txt.gz", gzipBytes(t, plain))
	mustWriteFile(t, filepath.Join(dir, "dictionary.txt"), "舊 旧 [jiu4] /old/\n")
	importDir(t, sqlDB, dir)
	if byForm(t, sqlDB, "zh", "character", "旧") == nil {
		t.Fatal("plain dictionary.txt was not used: 旧 missing")
	}
	if byForm(t, sqlDB, "zh", "word", "你好") != nil {
		t.Errorf("gz payload was imported; plain file should win")
	}
}

// TestJMdictImportReadsGz imports the JMdict fixture from jmdict.xml.gz and
// checks kana plus derived romaji readings.
func TestJMdictImportReadsGz(t *testing.T) {
	sqlDB := dbtest.Open(t)
	raw, err := os.ReadFile("testdata/jmdict-sample.xml")
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	importDir(t, sqlDB, writeCompressedPack(t, compressedManifest("jmdict", "ja"), "jmdict.xml.gz", gzipBytes(t, raw)))
	gakkou := byForm(t, sqlDB, "ja", "word", "学校")
	if gakkou == nil {
		t.Fatal("学校 not imported")
	}
	if got := readingValue(*gakkou, "kana"); got != "がっこう" {
		t.Errorf("kana reading = %q, want がっこう", got)
	}
	if got := readingValue(*gakkou, "romaji"); got != "gakkou" {
		t.Errorf("romaji reading = %q, want gakkou", got)
	}
}

// TestKanjidic2ImportReadsGz imports the KANJIDIC2 fixture from
// kanjidic2.xml.gz and checks on/kun readings arrive.
func TestKanjidic2ImportReadsGz(t *testing.T) {
	sqlDB := dbtest.Open(t)
	raw, err := os.ReadFile("testdata/kanjidic2-sample.xml")
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	importDir(t, sqlDB, writeCompressedPack(t, compressedManifest("kanjidic2", "ja"), "kanjidic2.xml.gz", gzipBytes(t, raw)))
	hi := byForm(t, sqlDB, "ja", "character", "日")
	if hi == nil {
		t.Fatal("日 not imported")
	}
	if readingValue(*hi, "on") == "" || readingValue(*hi, "kun") == "" {
		t.Errorf("readings of 日 = %+v, want on and kun readings", hi.Readings)
	}
}
