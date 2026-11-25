package freq_test

import (
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/binary"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/freq"
	"qinqin/internal/pack"
)

// importFails runs Import and checks it failed with an invalid-pack error
// mentioning every want, and that nothing was written.
func importFails(t *testing.T, name string, p *pack.Pack, want ...string) {
	t.Helper()
	sqlDB := dbtest.Open(t)
	_, err := freq.Import(context.Background(), sqlDB, p)
	if err == nil {
		t.Errorf("%s: import succeeded, want an error", name)
		return
	}
	for _, w := range want {
		if !strings.Contains(err.Error(), w) {
			t.Errorf("%s: err = %v, want it to mention %q", name, err, w)
		}
	}
	if !errors.Is(err, pack.ErrInvalidPack) {
		t.Errorf("%s: err = %v, want pack.ErrInvalidPack", name, err)
	}
	if n := count(t, sqlDB, `SELECT count(*) FROM frequency`) + count(t, sqlDB, `SELECT count(*) FROM frequency_packs`); n != 0 {
		t.Errorf("%s: %d rows written", name, n)
	}
}

func TestIndexJSONTooLarge(t *testing.T) {
	defer freq.SetLimits(20, 1<<20, 100)()
	importFails(t, "index.json",
		yomitanZipPack(t, `{"title":"aaaaaaaaaaaaaaaaaaaaaaaaaaaa"}`, `[["a","freq",1]]`),
		"index.json", "exceeds")
}

func TestZipMemberTooLarge(t *testing.T) {
	defer freq.SetLimits(1<<20, 40, 100)()
	importFails(t, "bank",
		yomitanZipPack(t, `{}`, `[["a","freq",1],["b","freq",2],["c","freq",3],["d","freq",4]]`),
		"term_meta_bank_1.json", "exceeds")
}

// A zip whose central directory claims a small uncompressed size for a
// big member must not get through.
func TestZipMemberWithLyingHeaderIsStillCapped(t *testing.T) {
	bank := `[["a","freq",1],["b","freq",2],["c","freq",3],["d","freq",4]]`
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, body := range map[string]string{"index.json": `{}`, "term_meta_bank_1.json": bank} {
		w, err := zw.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Store})
		if err != nil {
			t.Fatal(err)
		}
		w.Write([]byte(body))
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	data := buf.Bytes()
	// Central directory file headers: signature, then the uncompressed
	// size at offset 24. Lower the bank's to 5 bytes.
	patched := 0
	for i := 0; i+46 <= len(data); i++ {
		if binary.LittleEndian.Uint32(data[i:]) != 0x02014b50 {
			continue
		}
		n := int(binary.LittleEndian.Uint16(data[i+28:]))
		if string(data[i+46:i+46+n]) == "term_meta_bank_1.json" {
			binary.LittleEndian.PutUint32(data[i+24:], 5)
			patched++
		}
	}
	if patched != 1 {
		t.Fatalf("patched %d central directory entries, want 1", patched)
	}
	dir := writeFiles(t, map[string]string{"manifest.json": manifest("lie", "yomitan-freq")})
	if err := os.WriteFile(filepath.Join(dir, "dictionary.zip"), data, 0o644); err != nil {
		t.Fatal(err)
	}
	defer freq.SetLimits(1<<20, 40, 100)()
	// archive/zip itself refuses to read past the declared size, so the
	// import fails either way; the point is that it fails and writes nothing.
	importFails(t, "lying header", loadPack(t, dir), "term_meta_bank_1.json")
}

func TestGzipCSVTooLarge(t *testing.T) {
	var gz bytes.Buffer
	zw := gzip.NewWriter(&gz)
	zw.Write([]byte("term,reading,rank\n" + strings.Repeat("猫,,3\n", 50)))
	zw.Close()
	if gz.Len() > 100 {
		t.Fatalf("test input is %d bytes compressed; it should be tiny", gz.Len())
	}
	dir := writeFiles(t, map[string]string{"manifest.json": manifest("gz", "freq-csv")})
	if err := os.WriteFile(filepath.Join(dir, "freq.csv.gz"), gz.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	defer freq.SetLimits(1<<20, 100, 100)()
	importFails(t, "gzip csv", loadPack(t, dir), "freq.csv.gz", "exceeds")
}

func TestTooManyRows(t *testing.T) {
	defer freq.SetLimits(1<<20, 1<<20, 3)()
	importFails(t, "csv", csvPack(t, "many", "a,,1\nb,,2\nc,,3\nd,,4\n"), "freq.csv", "row 3", "rows")
	importFails(t, "yomitan",
		yomitanZipPack(t, `{}`, `[["a","freq",1],["b","freq",2],["c","freq",3],["d","freq",4]]`),
		"term_meta_bank_1.json", "row 3", "rows")

	// Exactly at the cap is fine.
	sqlDB := dbtest.Open(t)
	mustImport(t, sqlDB, csvPack(t, "ok", "a,,1\nb,,2\nc,,3\n"))
}
