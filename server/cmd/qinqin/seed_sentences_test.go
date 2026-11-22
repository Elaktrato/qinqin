package main

import (
	"context"
	"database/sql"
	"path/filepath"
	"strings"
	"testing"
)

// tatoebaTool holds the Tatoeba sentences tool's fixture dictionaries and
// the golden packs it writes from its fixture export: Tatoeba-shaped
// sentence packs in exactly the format of the bundled ones.
const tatoebaTool = "../../tools/tatoeba/testdata"

// tatoebaRoot is a pack root holding the two Tatoeba-shaped sentence
// packs, named so that path order puts them before their dictionaries:
// only the type order makes them link.
func tatoebaRoot(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	copyTree(t, filepath.Join(tatoebaTool, "golden", "zh-sentences-tatoeba"), filepath.Join(root, "a-zh-sentences-tatoeba"))
	copyTree(t, filepath.Join(tatoebaTool, "golden", "ja-sentences-tatoeba"), filepath.Join(root, "a-ja-sentences-tatoeba"))
	copyTree(t, filepath.Join(tatoebaTool, "dict", "cedict"), filepath.Join(root, "z-cedict"))
	copyTree(t, filepath.Join(tatoebaTool, "dict", "jmdict"), filepath.Join(root, "z-jmdict"))
	return root
}

// checkTatoebaInstalled: both packs are registered with their notice and
// every word group linked to an entry.
func checkTatoebaInstalled(t *testing.T, sqlDB *sql.DB) {
	t.Helper()
	for id, want := range map[string]int{"zh-sentences-tatoeba": 18, "ja-sentences-tatoeba": 13} {
		var n int
		if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM sentences WHERE source_pack = ? AND deleted_at IS NULL`, id).Scan(&n); err != nil || n != want {
			t.Errorf("%s: %d linked sentence rows, %v; want %d (every group of the golden pack)", id, n, err, want)
		}
		var notice, license string
		if err := sqlDB.QueryRow(`SELECT notice, license FROM sentence_packs WHERE pack_id = ? AND deleted_at IS NULL`, id).Scan(&notice, &license); err != nil {
			t.Errorf("%s not registered: %v", id, err)
			continue
		}
		if !strings.Contains(notice, "Tatoeba") || !strings.Contains(license, "CC BY 2.0 FR") {
			t.Errorf("%s: notice %q, license %q", id, notice, license)
		}
	}
	// A sentence without a reading (an ambiguous word) is stored with an
	// empty one.
	var reading string
	if err := sqlDB.QueryRow(`SELECT pinyin FROM sentences WHERE hanzi = '银行很长。' AND deleted_at IS NULL`).Scan(&reading); err != nil || reading != "" {
		t.Errorf("reading of 银行很长。 = %q, %v; want empty", reading, err)
	}
}

// TestSeedInstallsTatoebaSentencePacks: qinqin seed installs the Tatoeba
// sentence packs after the dictionaries they link to, whatever the path
// order, and a second seed is a no-op.
func TestSeedInstallsTatoebaSentencePacks(t *testing.T) {
	sqlDB, _ := openTestDB(t)
	root := tatoebaRoot(t)
	var out strings.Builder
	if err := seed(context.Background(), sqlDB, t.TempDir(), []string{root}, &out); err != nil {
		t.Fatalf("seed: %v\n%s", err, out.String())
	}
	checkTatoebaInstalled(t, sqlDB)
	lines := strings.Split(strings.TrimSpace(out.String()), "\n")
	var order []string
	for _, l := range lines {
		if f := strings.Fields(l); len(f) > 1 && (f[1] == "dictionary" || f[1] == "sentences") {
			order = append(order, f[1])
		}
	}
	if strings.Join(order, ",") != "dictionary,dictionary,sentences,sentences" {
		t.Errorf("seed order %v; want the dictionaries first\n%s", order, out.String())
	}
	if err := seed(context.Background(), sqlDB, t.TempDir(), []string{root}, &strings.Builder{}); err != nil {
		t.Fatalf("second seed: %v", err)
	}
	checkTatoebaInstalled(t, sqlDB)
}

// TestAutoSeedInstallsTatoebaSentencePacks: the first-start auto-seed
// installs them too (they are not demo packs).
func TestAutoSeedInstallsTatoebaSentencePacks(t *testing.T) {
	ctx := context.Background()
	sqlDB, dir := openTestDB(t)
	var rec logRecorder
	if err := autoSeed(ctx, sqlDB, dir, []string{tatoebaRoot(t)}, noEnv, rec.logf); err != nil {
		t.Fatalf("autoSeed: %v", err)
	}
	ids := installedIDs(t, sqlDB)
	for _, want := range []string{"zh-sentences-tatoeba", "ja-sentences-tatoeba"} {
		if !ids[want] || demoPacks[want] {
			t.Errorf("%s: installed %v, demo %v", want, ids[want], demoPacks[want])
		}
	}
	checkTatoebaInstalled(t, sqlDB)
}
