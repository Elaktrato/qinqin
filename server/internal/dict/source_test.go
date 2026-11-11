package dict_test

import (
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"qinqin/internal/dict"
	"qinqin/internal/entries"
	"qinqin/internal/model"
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
func readingValue(e *model.Entry, typ string) string {
	for _, r := range e.Readings {
		if r.Type == typ {
			return r.Value
		}
	}
	return ""
}

// TestCedictImportReadsGz imports the cedict fixture from dictionary.txt.gz
// (its upstream distribution form) and checks entries, senses, and the
// derived bopomofo reading survive the compressed path.
func TestCedictImportReadsGz(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)

	raw, err := os.ReadFile("testdata/cedict-sample.txt")
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	dir := writeCompressedPack(t, compressedManifest("cedict", "zh"), "dictionary.txt.gz", gzipBytes(t, raw))

	pack, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatalf("LoadPack: %v", err)
	}
	res, err := dict.Import(ctx, sqlDB, pack)
	if err != nil {
		t.Fatalf("Import(cedict gz): %v", err)
	}
	if res.Entries != 5 || res.Senses != 10 {
		t.Fatalf("result = %d entries, %d senses; want 5 entries, 10 senses", res.Entries, res.Senses)
	}

	st := entries.Store{DB: sqlDB}
	hello, err := st.GetByWritten(ctx, "你好", "word", "zh")
	if err != nil {
		t.Fatalf("GetByWritten(你好): %v", err)
	}
	if got := readingValue(hello, "bopomofo"); got != "ㄋㄧˇ ㄏㄠˇ" {
		t.Errorf("bopomofo reading = %q, want %q", got, "ㄋㄧˇ ㄏㄠˇ")
	}
}

// TestUnihanImportReadsZip imports the unihan fixture from Unihan.zip with
// the upstream member layout: radicals and definitions in the readings
// sources, variant mappings in the variants file.
func TestUnihanImportReadsZip(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)

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

	dir := writeCompressedPack(t, compressedManifest("unihan", "zh"), "Unihan.zip", buf.Bytes())
	pack, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatalf("LoadPack: %v", err)
	}
	if _, err := dict.Import(ctx, sqlDB, pack); err != nil {
		t.Fatalf("Import(unihan zip): %v", err)
	}

	st := entries.Store{DB: sqlDB}
	fu, err := st.GetByWritten(ctx, "复", "character", "zh")
	if err != nil {
		t.Fatalf("GetByWritten(复): %v", err)
	}
	variants, err := st.Variants(ctx, fu.ID)
	if err != nil {
		t.Fatalf("Variants(复): %v", err)
	}
	var written []string
	for _, v := range variants {
		written = append(written, v.Written)
	}
	slices.Sort(written)
	if !slices.Equal(written, []string{"復", "複"}) {
		t.Errorf("variants of 复 = %v, want [復 複]", written)
	}

	hao, err := st.GetByWritten(ctx, "好", "character", "zh")
	if err != nil {
		t.Fatalf("GetByWritten(好): %v", err)
	}
	if hao.RadicalID == nil {
		t.Fatalf("好 has no radical link")
	}
	radical, err := st.GetByID(ctx, *hao.RadicalID)
	if err != nil {
		t.Fatalf("GetByID(radical): %v", err)
	}
	if radical.Written != "女" {
		t.Errorf("radical of 好 = %q, want 女", radical.Written)
	}
	glosses := activeGlosses(t, sqlDB, dictionaryID(t, sqlDB, "unihan"), hao.ID)
	if !slices.Contains(glosses, "good, excellent, fine; well") {
		t.Errorf("unihan glosses of 好 = %v, want the kDefinition", glosses)
	}
}

// TestCedictPlainFileWinsOverGz pins the importer's source precedence:
// when both dictionary.txt and dictionary.txt.gz exist, the plain file
// wins. fetch-seeds.sh removes legacy plain payloads so a refreshed pack
// cannot silently keep importing the old data.
func TestCedictPlainFileWinsOverGz(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)

	plain, err := os.ReadFile("testdata/cedict-sample.txt")
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	dir := writeCompressedPack(t, compressedManifest("cedict", "zh"), "dictionary.txt.gz", gzipBytes(t, plain))
	mustWriteFile(t, filepath.Join(dir, "dictionary.txt"),
		"舊 旧 [jiu4] /old/\n")

	pack, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatalf("LoadPack: %v", err)
	}
	if _, err := dict.Import(ctx, sqlDB, pack); err != nil {
		t.Fatalf("Import: %v", err)
	}
	st := entries.Store{DB: sqlDB}
	if _, err := st.GetByWritten(ctx, "旧", "character", "zh"); err != nil {
		t.Fatalf("plain dictionary.txt was not used: GetByWritten(旧): %v", err)
	}
	if _, err := st.GetByWritten(ctx, "你好", "word", "zh"); err == nil {
		t.Errorf("gz payload was imported; plain file should win")
	}
}

// TestJMdictImportReadsGz imports the JMdict fixture from jmdict.xml.gz and
// checks kana plus derived romaji readings.
func TestJMdictImportReadsGz(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)

	raw, err := os.ReadFile("testdata/jmdict-sample.xml")
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	dir := writeCompressedPack(t, compressedManifest("jmdict", "ja"), "jmdict.xml.gz", gzipBytes(t, raw))
	pack, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatalf("LoadPack: %v", err)
	}
	if _, err := dict.Import(ctx, sqlDB, pack); err != nil {
		t.Fatalf("Import(jmdict gz): %v", err)
	}

	st := entries.Store{DB: sqlDB}
	gakkou, err := st.GetByWritten(ctx, "学校", "word", "ja")
	if err != nil {
		t.Fatalf("GetByWritten(学校): %v", err)
	}
	if got := readingValue(gakkou, "kana"); got != "がっこう" {
		t.Errorf("kana reading = %q, want がっこう", got)
	}
	if got := readingValue(gakkou, "romaji"); got != "gakkou" {
		t.Errorf("romaji reading = %q, want gakkou", got)
	}
}

// TestKanjidic2ImportReadsGz imports the KANJIDIC2 fixture from
// kanjidic2.xml.gz and checks on/kun readings arrive.
func TestKanjidic2ImportReadsGz(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)

	raw, err := os.ReadFile("testdata/kanjidic2-sample.xml")
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	dir := writeCompressedPack(t, compressedManifest("kanjidic2", "ja"), "kanjidic2.xml.gz", gzipBytes(t, raw))
	pack, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatalf("LoadPack: %v", err)
	}
	if _, err := dict.Import(ctx, sqlDB, pack); err != nil {
		t.Fatalf("Import(kanjidic2 gz): %v", err)
	}

	st := entries.Store{DB: sqlDB}
	hi, err := st.GetByWritten(ctx, "日", "character", "ja")
	if err != nil {
		t.Fatalf("GetByWritten(日): %v", err)
	}
	if readingValue(hi, "on") == "" || readingValue(hi, "kun") == "" {
		t.Errorf("readings of 日 = %+v, want on and kun readings", hi.Readings)
	}
}
