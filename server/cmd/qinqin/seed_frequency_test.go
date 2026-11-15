package main

import (
	"bytes"
	"context"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"qinqin/internal/freq"
)

// writeFreqPack writes a freq-csv pack named id under root.
func writeFreqPack(t *testing.T, root, id, csvBody string) {
	t.Helper()
	dir := filepath.Join(root, id)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	manifest := `{"id":"` + id + `","name":"` + id + `","version":"1","type":"frequency","language":"ja","license":"CC0-1.0","attribution":"test","format":"freq-csv"}`
	for name, body := range map[string]string{"manifest.json": manifest, "freq.csv": "term,reading,rank\n" + csvBody} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

func TestSeedImportsFrequencyAfterDictionariesBeforeLevels(t *testing.T) {
	sqlDB, _ := openTestDB(t)
	root := smallPacks(t)
	// "aaa" sorts before every other pack by path: only the type order can
	// put it after the dictionaries.
	writeFreqPack(t, root, "aaa-freq", "猫,,3\n犬,,4\n")
	var out bytes.Buffer
	if err := seed(context.Background(), sqlDB, t.TempDir(), []string{root}, &out); err != nil {
		t.Fatalf("seed: %v", err)
	}
	lines := strings.Split(strings.TrimSpace(out.String()), "\n")
	at := func(id string) int {
		for i, l := range lines {
			if strings.HasPrefix(l, id+" ") {
				return i
			}
		}
		t.Fatalf("no output line for %s in:\n%s", id, out.String())
		return -1
	}
	f := at("aaa-freq")
	for _, d := range []string{"es-demo", "ja-mini", "zh-mini"} {
		if at(d) > f {
			t.Errorf("dictionary %s imported after the frequency pack", d)
		}
	}
	for _, l := range []string{"hsk-mini", "jlpt-mini"} {
		if at(l) < f {
			t.Errorf("levels pack %s imported before the frequency pack", l)
		}
	}
	if !strings.Contains(lines[f], "2 rows") {
		t.Errorf("frequency line = %q, want its row count (2 rows)", lines[f])
	}
	hits, err := freq.Store{DB: sqlDB}.Lookup(context.Background(), []string{"猫"}, nil)
	if err != nil || len(hits["猫"]) != 1 || hits["猫"][0].Rank != 3 {
		t.Errorf("Lookup after seed = %+v, %v", hits, err)
	}
}

func TestSeedFrequencyPackOrderFollowsImportOrder(t *testing.T) {
	sqlDB, _ := openTestDB(t)
	root := t.TempDir()
	writeFreqPack(t, root, "b-second", "猫,,1\n")
	writeFreqPack(t, root, "a-first", "猫,,2\n")
	if err := seed(context.Background(), sqlDB, t.TempDir(), []string{root}, io.Discard); err != nil {
		t.Fatalf("seed: %v", err)
	}
	packs, err := freq.Store{DB: sqlDB}.Packs(context.Background())
	if err != nil || len(packs) != 2 || packs[0].PackID != "a-first" || packs[1].PackID != "b-second" {
		t.Errorf("Packs = %+v, %v; want a-first (path order) then b-second", packs, err)
	}
}

func TestSeedWalksEveryRoot(t *testing.T) {
	sqlDB, _ := openTestDB(t)
	public, local := t.TempDir(), t.TempDir()
	writeFreqPack(t, public, "public-freq", "猫,,1\n")
	writeFreqPack(t, local, "local-freq", "犬,,2\n")
	var out bytes.Buffer
	if err := seed(context.Background(), sqlDB, t.TempDir(), []string{public, local}, &out); err != nil {
		t.Fatalf("seed: %v", err)
	}
	for _, id := range []string{"public-freq", "local-freq"} {
		if !strings.Contains(out.String(), id) {
			t.Errorf("pack %s from one of the roots was not imported:\n%s", id, out.String())
		}
	}
	if err := seed(context.Background(), sqlDB, t.TempDir(), []string{public, filepath.Join(local, "missing")}, io.Discard); err == nil {
		t.Error("seed with a missing explicit root succeeded, want an error")
	}
}

func TestPacksFlagAcceptsCommasAndRepeats(t *testing.T) {
	var f rootsFlag
	f.roots = []string{"default"}
	for _, v := range []string{"a,b", "c"} {
		if err := f.Set(v); err != nil {
			t.Fatal(err)
		}
	}
	if want := []string{"a", "b", "c"}; !reflect.DeepEqual(f.roots, want) {
		t.Errorf("roots = %v, want %v (the default is replaced, not extended)", f.roots, want)
	}
}

func TestDefaultPacksAddsLocalRootOnlyWhenPresent(t *testing.T) {
	t.Setenv("QINQIN_PACKS", "")
	dir := t.TempDir()
	t.Chdir(dir)
	if got, want := defaultPacks(), []string{"plugins/data"}; !reflect.DeepEqual(got, want) {
		t.Errorf("without plugins/data-local: %v, want %v", got, want)
	}
	if err := os.MkdirAll("plugins/data-local", 0o755); err != nil {
		t.Fatal(err)
	}
	if got, want := defaultPacks(), []string{"plugins/data", "plugins/data-local"}; !reflect.DeepEqual(got, want) {
		t.Errorf("with plugins/data-local: %v, want %v", got, want)
	}
	t.Setenv("QINQIN_PACKS", "/x,/y")
	if got, want := defaultPacks(), []string{"/x", "/y"}; !reflect.DeepEqual(got, want) {
		t.Errorf("with $QINQIN_PACKS: %v, want %v", got, want)
	}
}
