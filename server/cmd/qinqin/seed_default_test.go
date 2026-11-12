package main

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"qinqin/internal/freq"
	"qinqin/internal/lexicon"
	"qinqin/internal/lookup"
)

// Inside the container the sample packs live at an absolute path, so
// `qinqin seed` with no --packs must honor $QINQIN_PACKS instead of
// the repo-relative plugins/data default.
func TestSeedPacksDefaultsFromEnv(t *testing.T) {
	t.Setenv("QINQIN_PACKS", smallPacks(t))
	dir := t.TempDir()
	if err := seedCmd([]string{"--data", dir}, io.Discard); err != nil {
		t.Fatalf("seed with $QINQIN_PACKS and no --packs: %v", err)
	}
	if _, err := filepath.Glob(filepath.Join(dir, "qinqin.db")); err != nil {
		t.Fatal(err)
	}
}

// csvGzRows counts the data rows (all lines but the header) of a .csv.gz.
func csvGzRows(t *testing.T, path string) int {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	zr, err := gzip.NewReader(f)
	if err != nil {
		t.Fatal(err)
	}
	n := -1
	sc := bufio.NewScanner(zr)
	for sc.Scan() {
		n++
	}
	if err := sc.Err(); err != nil {
		t.Fatal(err)
	}
	return n
}

// TestSeedRealPacksRanksWithJiten seeds the committed plugins/data — the
// full JMdict, KANJIDIC2, CC-CEDICT, Unihan and the Jiten frequency list —
// and checks lookups against that real data. Slow (about a minute): it
// is skipped with -short and when the bundle is not checked out.
func TestSeedRealPacksRanksWithJiten(t *testing.T) {
	if testing.Short() {
		t.Skip("seeds the full bundled data")
	}
	jiten := filepath.Join(committedPacks, "jiten-frequency", "freq.csv.gz")
	for _, p := range []string{jiten, filepath.Join(committedPacks, "jmdict", "jmdict.xml.gz")} {
		if _, err := os.Stat(p); err != nil {
			t.Skipf("bundled data unavailable: %v", err)
		}
	}
	ctx := context.Background()
	sqlDB, _ := openTestDB(t)
	var out bytes.Buffer
	if err := seed(ctx, sqlDB, []string{committedPacks}, &out); err != nil {
		t.Fatalf("seed: %v", err)
	}

	rows := csvGzRows(t, jiten)
	if want := fmt.Sprintf("jiten-frequency frequency  %d rows", rows); !strings.Contains(out.String(), want) {
		t.Errorf("seed output lacks %q:\n%s", want, out.String())
	}
	packs, err := freq.Store{DB: sqlDB}.Packs(ctx)
	if err != nil || len(packs) != 1 || packs[0].PackID != "jiten-frequency" ||
		packs[0].License != "CC BY-SA 4.0" || packs[0].Language != "ja" {
		t.Fatalf("frequency packs = %+v, %v; want jiten-frequency (ja, CC BY-SA 4.0)", packs, err)
	}
	var stored int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM frequency WHERE pack_id = ?`, packs[0].ID).Scan(&stored); err != nil || stored != rows {
		t.Errorf("stored rows = %d, %v; want %d", stored, err, rows)
	}

	s := lookup.Service{Lexicon: lexicon.Store{DB: sqlDB}, Freq: freq.Store{DB: sqlDB}, DB: sqlDB}
	// look returns the word results' headwords (with reasons, as
	// 為る[past]) and each headword's Jiten rank (none: absent).
	look := func(text string, offset int) ([]string, map[string]int) {
		t.Helper()
		rs, err := s.Lookup(ctx, "ja", text, offset, []string{"word"})
		if err != nil {
			t.Fatalf("Lookup(%q, %d): %v", text, offset, err)
		}
		var hw []string
		ranks := map[string]int{}
		for _, r := range rs {
			h := r.Term
			if len(r.Forms) > 0 {
				h = r.Forms[0].Text
			}
			if len(r.Reasons) > 0 {
				h += "[" + strings.Join(r.Reasons, " ") + "]"
			}
			hw = append(hw, h)
			if len(r.Frequencies) > 0 {
				ranks[h] = r.Frequencies[0].Rank
			}
		}
		var top []string
		for _, h := range hw[:min(5, len(hw))] {
			top = append(top, fmt.Sprintf("%s(%d)", h, ranks[h]))
		}
		t.Logf("%s@%d: %v", text, offset, top)
		return hw, ranks
	}
	before := func(hw []string, a, b string) {
		t.Helper()
		ia, ib := slices.Index(hw, a), slices.Index(hw, b)
		if ia < 0 || (ib >= 0 && ib < ia) {
			t.Errorf("%s at %d, %s at %d in %v; want %s first", a, ia, b, ib, hw, a)
		}
	}

	first := func(text string, offset int, want string) {
		t.Helper()
		if hw, _ := look(text, offset); hw[0] != want {
			t.Errorf("%s@%d first = %s, want %s", text, offset, hw[0], want)
		}
	}
	first("宿題をした", 3, "為る[past]")
	first("いる", 0, "居る")
	first("こと", 0, "事")
	// Jiten ranks なる written in kana under 成る; 生る must not share it.
	first("なる", 0, "成る")
	hw, _ := look("ゆく", 0)
	before(hw, "行く", "征く")
	// The kana row する is 為る's: its homophones keep their own ranks.
	hw, ranks := look("する", 0)
	if hw[0] != "為る" {
		t.Errorf("する first = %s, want 為る", hw[0])
	}
	for _, other := range []string{"刷る", "擦る", "掏る"} {
		before(hw, "為る", other)
		if r := ranks[other]; r != 0 && r <= ranks["為る"] {
			t.Errorf("する: %s rank %d, want worse than 為る's %d", other, r, ranks["為る"])
		}
	}
}
