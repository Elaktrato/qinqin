package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"qinqin/internal/db"
	"qinqin/internal/dict"
	"qinqin/internal/sentences"
)

const goldenDir = "testdata/golden"

var packIDs = []string{"ja-sentences-tatoeba", "zh-sentences-tatoeba"}

// buildFixture builds both packs from the fixture export into a fresh
// output directory and returns it with the report directory.
func buildFixture(t *testing.T, mutate func(*buildConfig)) (out, reports string) {
	t.Helper()
	p, err := loadPin(fixturePin)
	if err != nil {
		t.Fatal(err)
	}
	r, err := loadRules(fixtureRules)
	if err != nil {
		t.Fatal(err)
	}
	out, reports = t.TempDir(), t.TempDir()
	cfg := buildConfig{
		Root: ".", ExportDir: fixtureExport, Pin: p, Rules: r, OutDir: out, ReportDir: reports,
		Langs: []string{"zh", "ja"}, Workers: 2, Log: io.Discard,
	}
	if mutate != nil {
		mutate(&cfg)
	}
	if err := build(context.Background(), cfg); err != nil {
		t.Fatalf("build: %v", err)
	}
	return out, reports
}

func readTree(t *testing.T, dir string) map[string]string {
	t.Helper()
	files := map[string]string{}
	err := filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel, _ := filepath.Rel(dir, path)
		data, err := os.ReadFile(path)
		files[filepath.ToSlash(rel)] = string(data)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	return files
}

// TestBuildMatchesGolden: the packs built from the fixture export are the
// committed golden packs, byte for byte. UPDATE_GOLDEN=1 rewrites them;
// the diff is then the review of a filter change.
func TestBuildMatchesGolden(t *testing.T) {
	out, _ := buildFixture(t, nil)
	got := readTree(t, out)
	if os.Getenv("UPDATE_GOLDEN") == "1" {
		os.RemoveAll(goldenDir)
		for rel, body := range got {
			writeFile(t, filepath.Join(goldenDir, rel), body)
		}
		t.Log("golden packs rewritten")
	}
	want := readTree(t, goldenDir)
	for _, id := range packIDs {
		for _, f := range []string{"manifest.json", "sentences.json", "credits.tsv", "ATTRIBUTION.md", "LICENSE"} {
			if _, ok := got[id+"/"+f]; !ok {
				t.Errorf("%s/%s not written", id, f)
			}
		}
	}
	if !slices.Equal(sortedKeys(got), sortedKeys(want)) {
		t.Fatalf("files %v, golden %v", sortedKeys(got), sortedKeys(want))
	}
	for rel, body := range got {
		if body != want[rel] {
			t.Errorf("%s differs from the golden copy (UPDATE_GOLDEN=1 go test ./tools/tatoeba to accept):\n%s", rel, body)
		}
	}
}

// TestBuildIsDeterministic: two builds, with different worker counts, write
// byte-identical packs and reports.
func TestBuildIsDeterministic(t *testing.T) {
	out1, rep1 := buildFixture(t, func(c *buildConfig) { c.Workers = 1 })
	out2, rep2 := buildFixture(t, func(c *buildConfig) { c.Workers = 4 })
	a, b := readTree(t, out1), readTree(t, out2)
	if len(a) == 0 || !mapsEqual(a, b) {
		t.Error("two builds wrote different packs")
	}
	if ra, rb := readTree(t, rep1), readTree(t, rep2); len(ra) == 0 || !mapsEqual(ra, rb) {
		t.Error("two builds wrote different reports")
	}
	for _, body := range a {
		if strings.Contains(body, "2026-") || strings.Contains(body, "\r") {
			t.Error("a pack file carries a build-time date or a CR")
		}
	}
}

func mapsEqual(a, b map[string]string) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if b[k] != v {
			return false
		}
	}
	return true
}

type outPack struct {
	Entries []struct {
		Word      string `json:"word"`
		Sentences []struct {
			Hanzi       string  `json:"hanzi"`
			Pinyin      *string `json:"pinyin"`
			Translation string  `json:"translation"`
		} `json:"sentences"`
	} `json:"entries"`
}

func readOut(t *testing.T, dir string) outPack {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(dir, "sentences.json"))
	if err != nil {
		t.Fatal(err)
	}
	var p outPack
	if err := json.Unmarshal(data, &p); err != nil {
		t.Fatalf("sentences.json: %v", err)
	}
	return p
}

func TestBuildGroupsCapsAndCredits(t *testing.T) {
	out, reports := buildFixture(t, nil)
	zh := readOut(t, filepath.Join(out, "zh-sentences-tatoeba"))
	groups := map[string][]string{}
	var words []string
	for _, g := range zh.Entries {
		words = append(words, g.Word)
		for _, s := range g.Sentences {
			groups[g.Word] = append(groups[g.Word], s.Hanzi)
			if s.Pinyin != nil && *s.Pinyin == "" {
				t.Errorf("%s: an empty pinyin is written; leave the field out", s.Hanzi)
			}
		}
		if len(g.Sentences) > 2 {
			t.Errorf("group %s has %d sentences, cap 2", g.Word, len(g.Sentences))
		}
	}
	if !slices.IsSorted(words) {
		t.Errorf("groups not sorted: %v", words)
	}
	// 我们 has three candidates; the cap keeps the native, shorter ones.
	if got := groups["我们"]; !slices.Equal(got, []string{"我们一起学习。", "我们一起去吃饭吧。"}) {
		t.Errorf("我们 = %q", got)
	}
	// The capped-out 1011 still exemplifies 西安.
	if got := groups["西安"]; !slices.Equal(got, []string{"我们去西安。"}) {
		t.Errorf("西安 = %q", got)
	}
	// Dropped by the coverage rule (猫 is not in the dictionary) and by
	// having no word that links (我很好: characters only).
	for _, gone := range []string{"我喜欢猫。", "我很好。"} {
		for w, list := range groups {
			if slices.Contains(list, gone) {
				t.Errorf("%s bundled under %s", gone, w)
			}
		}
	}

	credits, err := os.ReadFile(filepath.Join(out, "zh-sentences-tatoeba", "credits.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSuffix(string(credits), "\n"), "\n")
	if lines[0] != "sentence\tlicence\tauthor\ttranslation\ttranslation_licence\ttranslation_author" {
		t.Errorf("credits header %q", lines[0])
	}
	if !slices.Contains(lines, "1011\tCC0 1.0\twei\t2011\tCC0 1.0\ttom") {
		t.Errorf("credits lack the CC0 line of 1011: %q", lines)
	}
	if !slices.Contains(lines, "1013\tCC BY 2.0 FR\twei\t2015\tCC BY 2.0 FR\temma") {
		t.Errorf("credits lack 1013 with its native translation: %q", lines)
	}
	for _, l := range lines[1:] {
		if strings.HasPrefix(l, "1014\t") || strings.HasPrefix(l, "1017\t") {
			t.Errorf("credits list a sentence that is not bundled: %q", l)
		}
	}

	ja := readOut(t, filepath.Join(out, "ja-sentences-tatoeba"))
	for _, g := range ja.Entries {
		if g.Word == "は" || g.Word == "を" || g.Word == "です" {
			t.Errorf("skip word %s has a group", g.Word)
		}
	}

	report, err := os.ReadFile(filepath.Join(reports, "report-zh.txt"))
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"match rate", "near duplicate: 1", "dictionary coverage below minimum: 1", "no word that links: 1", "sentences.json", "gzip"} {
		if !strings.Contains(string(report), want) {
			t.Errorf("report-zh.txt lacks %q:\n%s", want, report)
		}
	}
	review, err := os.ReadFile(filepath.Join(reports, "review-zh.tsv"))
	if err != nil || !strings.Contains(string(review), "\t长\t") {
		t.Errorf("review-zh.tsv = %q, %v; want 长", review, err)
	}
	if _, err := os.Stat(filepath.Join(reports, "sample-ja.tsv")); err != nil {
		t.Errorf("sample-ja.tsv: %v", err)
	}
}

func TestMaxPerWordOverride(t *testing.T) {
	out, _ := buildFixture(t, func(c *buildConfig) { c.MaxPerWord = 1 })
	for _, id := range packIDs {
		for _, g := range readOut(t, filepath.Join(out, id)).Entries {
			if len(g.Sentences) != 1 {
				t.Errorf("%s %s: %d sentences, want 1", id, g.Word, len(g.Sentences))
			}
		}
	}
}

// TestGoldenPacksInstall: the written packs load as packs, carry valid
// notices, and import with the real importer with every word linked.
func TestGoldenPacksInstall(t *testing.T) {
	ctx := context.Background()
	for _, tc := range []struct{ id, dict string }{
		{"zh-sentences-tatoeba", "testdata/dict/cedict"},
		{"ja-sentences-tatoeba", "testdata/dict/jmdict"},
	} {
		p, err := dict.LoadPack(filepath.Join(goldenDir, tc.id))
		if err != nil {
			t.Fatalf("LoadPack(%s): %v", tc.id, err)
		}
		if p.Type != dict.TypeSentences || p.Notice == "" {
			t.Errorf("%s: type %q, notice %q", tc.id, p.Type, p.Notice)
		}
		if err := dict.ValidateNotice(p.Notice); err != nil {
			t.Errorf("%s notice: %v", tc.id, err)
		}
		for _, want := range []string{"[Tatoeba](https://tatoeba.org)", "CC BY 2.0 FR", "CC0 1.0", "may contain errors", "credits.tsv"} {
			if !strings.Contains(p.Notice, want) {
				t.Errorf("%s notice lacks %q", tc.id, want)
			}
		}
		sqlDB, err := db.Open(filepath.Join(t.TempDir(), "q.db"))
		if err != nil {
			t.Fatal(err)
		}
		dp, err := dict.LoadPack(tc.dict)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := dict.ImportLexicon(ctx, sqlDB, &dp); err != nil {
			t.Fatal(err)
		}
		res, err := sentences.ImportPack(ctx, sqlDB, p)
		if err != nil {
			t.Fatalf("ImportPack(%s): %v", tc.id, err)
		}
		if res.Sentences == 0 || len(res.Skipped) != 0 {
			t.Errorf("%s: %d sentences, skipped %v; want every word linked", tc.id, res.Sentences, res.Skipped)
		}
		sqlDB.Close()
	}
}

func TestEmbeddedCC0MatchesTheRepositoryCopy(t *testing.T) {
	data, err := os.ReadFile("../../../plugins/data/zh-grammar/LICENSE")
	if err != nil {
		t.Fatal(err)
	}
	i := bytes.Index(data, []byte("Creative Commons Legal Code"))
	if i < 0 || string(data[i:]) != cc0Text {
		t.Error("templates/CC0-1.0.txt is not the legal code of plugins/data/zh-grammar/LICENSE")
	}
}
