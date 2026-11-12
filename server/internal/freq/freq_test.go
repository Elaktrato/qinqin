package freq_test

import (
	"archive/zip"
	"compress/gzip"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/db"
	"qinqin/internal/dict"
	"qinqin/internal/freq"
)

func openDB(t *testing.T) *sql.DB {
	t.Helper()
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "qinqin.db"))
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	return sqlDB
}

func loadPack(t *testing.T, dir string) *dict.Pack {
	t.Helper()
	p, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatalf("LoadPack(%s): %v", dir, err)
	}
	return &p
}

func manifest(id, format string) string {
	return fmt.Sprintf(`{"id":%q,"name":"Pack %s","version":"1","type":"frequency","language":"ja","license":"CC0-1.0","attribution":"test","format":%q}`, id, id, format)
}

// writeFiles creates a pack directory holding the given files.
func writeFiles(t *testing.T, files map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	for name, body := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func csvPack(t *testing.T, id, body string) *dict.Pack {
	return loadPack(t, writeFiles(t, map[string]string{
		"manifest.json": manifest(id, "freq-csv"),
		"freq.csv":      "term,reading,rank\n" + body,
	}))
}

func mustImport(t *testing.T, sqlDB *sql.DB, p *dict.Pack) dict.Result {
	t.Helper()
	r, err := freq.Import(context.Background(), sqlDB, p)
	if err != nil {
		t.Fatalf("Import(%s): %v", p.ID, err)
	}
	return r
}

func lookup(t *testing.T, sqlDB *sql.DB, terms []string, readings map[string][]string) map[string][]freq.Hit {
	t.Helper()
	got, err := freq.Store{DB: sqlDB}.Lookup(context.Background(), terms, readings)
	if err != nil {
		t.Fatalf("Lookup: %v", err)
	}
	return got
}

func count(t *testing.T, sqlDB *sql.DB, q string, args ...any) int {
	t.Helper()
	var n int
	if err := sqlDB.QueryRow(q, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func wantRank(t *testing.T, got map[string][]freq.Hit, term string, rank int, display string) {
	t.Helper()
	hits := got[term]
	if len(hits) != 1 || hits[0].Rank != rank || hits[0].Display != display {
		t.Errorf("hits[%s] = %+v, want one hit rank %d display %q", term, hits, rank, display)
	}
}

func TestImportYomitanDirectory(t *testing.T) {
	sqlDB := openDB(t)
	r := mustImport(t, sqlDB, loadPack(t, "testdata/yomitan-dir"))
	if r.Entries != 5 {
		t.Errorf("Entries = %d, want 5 freq rows (the pitch row is skipped)", r.Entries)
	}
	got := lookup(t, sqlDB, []string{"日本", "猫", "橋", "犬", "食べる", "none"}, nil)
	wantRank(t, got, "日本", 1200, "")
	wantRank(t, got, "猫", 300, "300㋕")
	wantRank(t, got, "橋", 50, "") // best of the two readings
	wantRank(t, got, "犬", 77, "") // a string value
	if len(got["食べる"]) != 0 || len(got["none"]) != 0 {
		t.Errorf("pitch-only and unknown terms must have no hit: %+v", got)
	}
	if h := got["日本"][0]; h.PackName != "Yomitan dir sample" || h.PackID == 0 {
		t.Errorf("hit pack = %d %q", h.PackID, h.PackName)
	}
}

func yomitanZipPack(t *testing.T, index, bank string) *dict.Pack {
	t.Helper()
	dir := t.TempDir()
	f, err := os.Create(filepath.Join(dir, "dictionary.zip"))
	if err != nil {
		t.Fatal(err)
	}
	zw := zip.NewWriter(f)
	for name, body := range map[string]string{"index.json": index, "term_meta_bank_1.json": bank} {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		w.Write([]byte(body))
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	f.Close()
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), []byte(manifest("yomi-zip", "yomitan-freq")), 0o644); err != nil {
		t.Fatal(err)
	}
	return loadPack(t, dir)
}

func TestImportYomitanZip(t *testing.T) {
	sqlDB := openDB(t)
	p := yomitanZipPack(t, `{"title":"z"}`, `[["日本","freq",5],["本","freq",{"value":9,"displayValue":"9x"}]]`)
	if r := mustImport(t, sqlDB, p); r.Entries != 2 {
		t.Errorf("Entries = %d, want 2", r.Entries)
	}
	got := lookup(t, sqlDB, []string{"日本", "本"}, nil)
	wantRank(t, got, "日本", 5, "") // no frequencyMode: rank-based
	wantRank(t, got, "本", 9, "9x")
}

func TestOccurrenceBasedBecomesDenseRanks(t *testing.T) {
	sqlDB := openDB(t)
	p := yomitanZipPack(t, `{"title":"o","frequencyMode":"occurrence-based"}`,
		`[["d","freq",20],["b","freq",{"value":"500","displayValue":"500x"}],["c","freq",100],["a","freq",500]]`)
	mustImport(t, sqlDB, p)
	got := lookup(t, sqlDB, []string{"a", "b", "c", "d"}, nil)
	wantRank(t, got, "a", 1, "")
	wantRank(t, got, "b", 1, "500x") // tied counts share a rank
	wantRank(t, got, "c", 2, "")     // dense: no gap after a tie
	wantRank(t, got, "d", 3, "")
}

func TestImportCSV(t *testing.T) {
	sqlDB := openDB(t)
	if r := mustImport(t, sqlDB, loadPack(t, "testdata/csv")); r.Entries != 5 {
		t.Errorf("Entries = %d, want 5", r.Entries)
	}
	got := lookup(t, sqlDB, []string{"日本", "猫", "foo, bar"}, map[string][]string{"日本": {"にほん"}})
	wantRank(t, got, "日本", 10, "")
	wantRank(t, got, "猫", 300, "")
	wantRank(t, got, "foo, bar", 7, "") // quoted field with a comma
}

func TestImportCSVGzip(t *testing.T) {
	dir := writeFiles(t, map[string]string{"manifest.json": manifest("gz", "freq-csv")})
	f, err := os.Create(filepath.Join(dir, "freq.csv.gz"))
	if err != nil {
		t.Fatal(err)
	}
	zw := gzip.NewWriter(f)
	zw.Write([]byte("term,reading,rank\n猫,,3\n"))
	zw.Close()
	f.Close()
	sqlDB := openDB(t)
	mustImport(t, sqlDB, loadPack(t, dir))
	wantRank(t, lookup(t, sqlDB, []string{"猫"}, nil), "猫", 3, "")
}

func TestLookupReadingPreference(t *testing.T) {
	sqlDB := openDB(t)
	mustImport(t, sqlDB, csvPack(t, "p", "橋,はし,50\n橋,きょう,900\n日,,8\n日,ひ,12\n月,つき,4\n方,ほう,224\n方,かた,322\n"))
	for _, tc := range []struct {
		name     string
		term     string
		readings []string
		want     int
	}{
		{"no readings asked: best overall", "橋", nil, 50},
		{"matching reading", "橋", []string{"きょう"}, 900},
		{"one of several readings", "橋", []string{"nope", "きょう"}, 900},
		{"empty-reading row matches any reading", "日", []string{"ひ"}, 8}, // best of {empty row 8, ひ 12}
		{"empty-reading row serves an unlisted reading", "日", []string{"じつ"}, 8},
		{"readings present, none matches: no hit", "月", []string{"げつ"}, 0},
		{"ひゃく is not in the pack: no hit", "月", []string{"ひゃく"}, 0},
		{"reading ほう", "方", []string{"ほう"}, 224},
		{"reading かた", "方", []string{"かた"}, 322},
		{"exact comparison: katakana is another reading", "方", []string{"ホウ"}, 0},
		{"both readings listed: best of the matching rows", "方", []string{"かた", "ほう"}, 224},
	} {
		var rd map[string][]string
		if tc.readings != nil {
			rd = map[string][]string{tc.term: tc.readings}
		}
		got := lookup(t, sqlDB, []string{tc.term}, rd)
		switch {
		case tc.want == 0 && len(got[tc.term]) != 0:
			t.Errorf("%s: hits = %+v, want none", tc.name, got[tc.term])
		case tc.want != 0 && (len(got[tc.term]) != 1 || got[tc.term][0].Rank != tc.want):
			t.Errorf("%s: hits = %+v, want rank %d", tc.name, got[tc.term], tc.want)
		}
	}
}

func TestLookupOneBestHitPerPackInPackOrder(t *testing.T) {
	sqlDB := openDB(t)
	mustImport(t, sqlDB, csvPack(t, "first", "猫,,30\n猫,ねこ,20\n"))
	mustImport(t, sqlDB, csvPack(t, "second", "猫,,5\n"))
	hits := lookup(t, sqlDB, []string{"猫", "猫"}, nil)["猫"] // duplicate terms are harmless
	if len(hits) != 2 || hits[0].Rank != 20 || hits[1].Rank != 5 || hits[0].PackName != "Pack first" {
		t.Errorf("hits = %+v, want first-pack 20 then second-pack 5", hits)
	}
}

func TestLookupChunksLargeTermLists(t *testing.T) {
	sqlDB := openDB(t)
	var body strings.Builder
	terms := make([]string, 1200)
	for i := range terms {
		terms[i] = fmt.Sprintf("w%d", i)
		fmt.Fprintf(&body, "%s,,%d\n", terms[i], i+1)
	}
	mustImport(t, sqlDB, csvPack(t, "big", body.String()))
	got := lookup(t, sqlDB, terms, nil)
	if len(got) != 1200 {
		t.Fatalf("hits for %d terms, want 1200", len(got))
	}
	wantRank(t, got, "w0", 1, "")
	wantRank(t, got, "w1199", 1200, "")
}

func TestPacksAreOrderedByFirstRegistration(t *testing.T) {
	sqlDB := openDB(t)
	a, b := csvPack(t, "a", "x,,1\n"), csvPack(t, "b", "x,,2\n")
	mustImport(t, sqlDB, a)
	mustImport(t, sqlDB, b)
	mustImport(t, sqlDB, csvPack(t, "a", "x,,3\n")) // re-import keeps a's place
	packs, err := freq.Store{DB: sqlDB}.Packs(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(packs) != 2 || packs[0].PackID != "a" || packs[1].PackID != "b" || packs[0].Ord >= packs[1].Ord {
		t.Errorf("Packs = %+v, want a then b", packs)
	}
	if packs[0].License != "CC0-1.0" || packs[0].Attribution != "test" || packs[0].Version != "1" {
		t.Errorf("pack info = %+v", packs[0])
	}
}

func TestReimportReplacesRowsAndIdenticalWritesNothing(t *testing.T) {
	sqlDB := openDB(t)
	mustImport(t, sqlDB, csvPack(t, "p", "猫,,3\n犬,,4\n"))
	if _, err := sqlDB.Exec(`UPDATE lx_freq_packs SET updated_at = 'sentinel'`); err != nil {
		t.Fatal(err)
	}
	before := count(t, sqlDB, `SELECT max(rowid) FROM lx_frequency`)

	mustImport(t, sqlDB, csvPack(t, "p", "猫,,3\n犬,,4\n"))
	var stamp string
	sqlDB.QueryRow(`SELECT updated_at FROM lx_freq_packs`).Scan(&stamp)
	if stamp != "sentinel" {
		t.Errorf("identical re-import restamped the pack: updated_at = %q", stamp)
	}
	if after := count(t, sqlDB, `SELECT max(rowid) FROM lx_frequency`); after != before {
		t.Errorf("identical re-import rewrote rows (max rowid %d -> %d)", before, after)
	}

	mustImport(t, sqlDB, csvPack(t, "p", "猫,,9\n"))
	got := lookup(t, sqlDB, []string{"猫", "犬"}, nil)
	wantRank(t, got, "猫", 9, "")
	if len(got["犬"]) != 0 {
		t.Errorf("a re-import must replace the pack's rows: 犬 = %+v", got["犬"])
	}
	if n := count(t, sqlDB, `SELECT count(*) FROM lx_freq_packs`); n != 1 {
		t.Errorf("%d pack rows after re-import, want 1", n)
	}
}

func TestMalformedPackWritesNothing(t *testing.T) {
	for _, tc := range []struct {
		name string
		pack func() *dict.Pack
		want string
	}{
		{"csv bad rank on the last row", func() *dict.Pack { return csvPack(t, "bad", "猫,,3\n犬,,x\n") }, "freq.csv row 1"},
		{"csv zero rank", func() *dict.Pack { return csvPack(t, "bad", "猫,,0\n") }, "freq.csv row 0"},
		{"csv rank beyond 2^53", func() *dict.Pack { return csvPack(t, "bad", "猫,,3\n犬,,99999999999999999999\n") }, "freq.csv row 1"},
		{"csv empty term", func() *dict.Pack { return csvPack(t, "bad", ",,3\n") }, "freq.csv row 0"},
		{"csv wrong header", func() *dict.Pack {
			return loadPack(t, writeFiles(t, map[string]string{"manifest.json": manifest("bad", "freq-csv"), "freq.csv": "word,rank\nx,1\n"}))
		}, "header"},
		{"csv missing file", func() *dict.Pack {
			return loadPack(t, writeFiles(t, map[string]string{"manifest.json": manifest("bad", "freq-csv")}))
		}, "freq.csv"},
		{"yomitan row not an array of three", func() *dict.Pack {
			return yomitanZipPack(t, `{}`, `[["a","freq",1],["b","freq"]]`)
		}, "term_meta_bank_1.json row 1"},
		{"yomitan unusable value", func() *dict.Pack {
			return yomitanZipPack(t, `{}`, `[["a","freq",1],["b","freq",{"frequency":[]}]]`)
		}, "term_meta_bank_1.json row 1"},
		{"yomitan value beyond 2^53", func() *dict.Pack {
			return yomitanZipPack(t, `{"frequencyMode":"occurrence-based"}`, `[["a","freq",1],["b","freq",1e300]]`)
		}, "term_meta_bank_1.json row 1"},
		{"yomitan non-integer rank", func() *dict.Pack {
			return yomitanZipPack(t, `{}`, `[["a","freq",1.5]]`)
		}, "term_meta_bank_1.json row 0"},
		{"yomitan unknown mode", func() *dict.Pack {
			return yomitanZipPack(t, `{"frequencyMode":"weird"}`, `[["a","freq",1]]`)
		}, "frequencyMode"},
		{"yomitan broken json", func() *dict.Pack {
			return yomitanZipPack(t, `{}`, `[["a","freq",1],`)
		}, "term_meta_bank_1.json"},
	} {
		sqlDB := openDB(t)
		_, err := freq.Import(context.Background(), sqlDB, tc.pack())
		if err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("%s: err = %v, want it to mention %q", tc.name, err, tc.want)
		}
		if !errors.Is(err, dict.ErrInvalidPack) {
			t.Errorf("%s: err = %v, want it to wrap dict.ErrInvalidPack", tc.name, err)
		}
		if n := count(t, sqlDB, `SELECT count(*) FROM lx_frequency`) + count(t, sqlDB, `SELECT count(*) FROM lx_freq_packs`); n != 0 {
			t.Errorf("%s: %d rows written by a failed import", tc.name, n)
		}
	}
}

func TestFailedReimportKeepsThePreviousRows(t *testing.T) {
	sqlDB := openDB(t)
	mustImport(t, sqlDB, csvPack(t, "p", "猫,,3\n"))
	if _, err := freq.Import(context.Background(), sqlDB, csvPack(t, "p", "犬,,4\n猫,,oops\n")); err == nil {
		t.Fatal("malformed re-import succeeded")
	}
	wantRank(t, lookup(t, sqlDB, []string{"猫"}, nil), "猫", 3, "")
}

func TestImportRejectsOtherPackTypes(t *testing.T) {
	sqlDB := openDB(t)
	p := csvPack(t, "x", "猫,,3\n")
	p.Type = dict.TypeDictionary
	if _, err := freq.Import(context.Background(), sqlDB, p); err == nil {
		t.Error("Import of a dictionary pack succeeded")
	}
}

func TestCSVWithBOMAndCRLF(t *testing.T) {
	sqlDB := openDB(t)
	mustImport(t, sqlDB, loadPack(t, writeFiles(t, map[string]string{
		"manifest.json": manifest("bom", "freq-csv"),
		"freq.csv":      "\xef\xbb\xbfterm,reading,rank\r\n猫,ねこ,3\r\n\"a,b\",,4\r\n",
	})))
	got := lookup(t, sqlDB, []string{"猫", "a,b"}, map[string][]string{"猫": {"ねこ"}})
	wantRank(t, got, "猫", 3, "")
	wantRank(t, got, "a,b", 4, "")
}

func TestMetadataOnlyChangeIsRegistered(t *testing.T) {
	sqlDB := openDB(t)
	mustImport(t, sqlDB, csvPack(t, "p", "猫,,3\n"))
	if _, err := sqlDB.Exec(`UPDATE lx_freq_packs SET updated_at = 'sentinel'`); err != nil {
		t.Fatal(err)
	}
	p := csvPack(t, "p", "猫,,3\n")
	p.Version = "2"
	mustImport(t, sqlDB, p)
	packs, err := freq.Store{DB: sqlDB}.Packs(context.Background())
	if err != nil || len(packs) != 1 || packs[0].Version != "2" {
		t.Fatalf("Packs = %+v, %v; want version 2", packs, err)
	}
	var stamp string
	sqlDB.QueryRow(`SELECT updated_at FROM lx_freq_packs`).Scan(&stamp)
	if stamp == "sentinel" {
		t.Error("a version bump with identical rows was not restamped")
	}
	wantRank(t, lookup(t, sqlDB, []string{"猫"}, nil), "猫", 3, "")
}

func TestSoftDeletedPackIsRevived(t *testing.T) {
	sqlDB := openDB(t)
	mustImport(t, sqlDB, csvPack(t, "p", "猫,,3\n"))
	if _, err := sqlDB.Exec(`UPDATE lx_freq_packs SET deleted_at = '2020-01-01T00:00:00Z'`); err != nil {
		t.Fatal(err)
	}
	if got := lookup(t, sqlDB, []string{"猫"}, nil); len(got["猫"]) != 0 {
		t.Fatalf("a soft-deleted pack answered: %+v", got)
	}
	mustImport(t, sqlDB, csvPack(t, "p", "猫,,3\n")) // identical rows, but deleted: must come back
	wantRank(t, lookup(t, sqlDB, []string{"猫"}, nil), "猫", 3, "")
	if n := count(t, sqlDB, `SELECT count(*) FROM lx_freq_packs WHERE deleted_at IS NULL`); n != 1 {
		t.Errorf("%d active packs after revival, want 1", n)
	}
}

func TestPackZipFoundDespiteGlobMetacharactersInPath(t *testing.T) {
	root := filepath.Join(t.TempDir(), "pack[1]*")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	src := yomitanZipPack(t, `{}`, `[["a","freq",1]]`)
	for _, name := range []string{"manifest.json", "dictionary.zip"} {
		b, err := os.ReadFile(filepath.Join(src.Dir, name))
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(root, name), b, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	sqlDB := openDB(t)
	mustImport(t, sqlDB, loadPack(t, root))
	wantRank(t, lookup(t, sqlDB, []string{"a"}, nil), "a", 1, "")
}
