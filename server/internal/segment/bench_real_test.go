package segment_test

import (
	"compress/gzip"
	"context"
	"database/sql"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"testing"
	"time"

	"qinqin/internal/db"
	"qinqin/internal/dbtest"
	"qinqin/internal/dict"
	"qinqin/internal/freq"
	"qinqin/internal/pack"
)

// QINQIN_SEGMENT_BENCH=1 segments a long chapter (5,000 runes of the
// Tatoeba pack's Japanese sentences, the size of one /api/segment request)
// on the whole shipped JMdict and the Jiten frequency list, and logs the
// time and the token count (#348: the segmenter before and after). Skipped
// by default: the import takes a while.
func TestBenchLongChapter(t *testing.T) {
	if os.Getenv("QINQIN_SEGMENT_BENCH") == "" {
		t.Skip("set QINQIN_SEGMENT_BENCH=1")
	}
	data := filepath.Join("..", "..", "..", "plugins", "data")
	ctx := context.Background()
	// QINQIN_SEGMENT_BENCH_DB keeps the imported database between runs.
	cache := os.Getenv("QINQIN_SEGMENT_BENCH_DB")
	if cache != "" {
		if _, err := os.Stat(cache); err == nil {
			sqlDB, err := db.Open(cache) // reopen: an earlier run of this test wrote it
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { sqlDB.Close() })
			benchSegment(t, sqlDB, data)
			return
		}
	}
	sqlDB := dbtest.Open(t)
	p, err := pack.LoadPack(filepath.Join(data, "jmdict"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := dict.ImportLexicon(ctx, sqlDB, &p); err != nil {
		t.Fatal(err)
	}
	fdir := t.TempDir()
	for _, name := range []string{"manifest.json", "freq.csv"} {
		src, err := os.Open(filepath.Join(data, "jiten-frequency", name))
		var r io.Reader = src
		if err != nil {
			if src, err = os.Open(filepath.Join(data, "jiten-frequency", name+".gz")); err != nil {
				t.Fatal(err)
			}
			if r, err = gzip.NewReader(src); err != nil {
				t.Fatal(err)
			}
		}
		out, _ := os.Create(filepath.Join(fdir, name))
		if _, err := io.Copy(out, r); err != nil {
			t.Fatal(err)
		}
		out.Close()
		src.Close()
	}
	fp, err := pack.LoadPack(fdir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := freq.Import(ctx, sqlDB, &fp); err != nil {
		t.Fatal(err)
	}
	if cache != "" {
		if _, err := sqlDB.Exec(`VACUUM INTO ?`, cache); err != nil {
			t.Fatal(err)
		}
	}
	benchSegment(t, sqlDB, data)
}

// benchSegment segments the long chapter three times and logs the times.
func benchSegment(t *testing.T, sqlDB *sql.DB, data string) {
	ctx := context.Background()
	raw, err := os.ReadFile(filepath.Join(data, "ja-sentences-tatoeba", "sentences.json"))
	if err != nil {
		t.Fatal(err)
	}
	var text []rune
	for _, m := range regexp.MustCompile(`"hanzi":"([^"]+)"`).FindAllStringSubmatch(string(raw), -1) {
		text = append(text, []rune(m[1])...)
		if len(text) >= 5000 {
			break
		}
	}
	text = text[:5000]
	svc := service(sqlDB)
	for run := range 3 {
		start := time.Now()
		ms, err := svc.Segment(ctx, "ja", string(text))
		if err != nil {
			t.Fatal(err)
		}
		t.Logf("run %d: 5,000 runes, %d tokens in %v", run, len(ms), time.Since(start))
	}
}
