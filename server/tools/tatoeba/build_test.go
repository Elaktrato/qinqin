package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"regexp"
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
	// No timestamp of the build: no RFC 3339 / ISO date-time anywhere, and
	// the only dates are the pinned export and licence-check dates.
	stamp := regexp.MustCompile(`\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}`)
	date := regexp.MustCompile(`\d{4}-\d{2}-\d{2}`)
	for name, body := range a {
		if stamp.MatchString(body) || strings.Contains(body, "\r") {
			t.Errorf("%s carries a date-time or a CR", name)
		}
		for _, d := range date.FindAllString(body, -1) {
			if d != "2000-01-02" && d != "2000-01-03" {
				t.Errorf("%s carries the date %s, which is not a pinned one", name, d)
			}
		}
	}
	// The staging directory never lands in the pack folder.
	for _, out := range []string{out1, out2} {
		entries, _ := os.ReadDir(out)
		for _, e := range entries {
			if strings.HasPrefix(e.Name(), ".") {
				t.Errorf("leftover %s in the pack folder", e.Name())
			}
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
	if lines[0] != "sentence\turl\tlicence\towner\ttranslation\ttranslation_url\ttranslation_licence\ttranslation_owner" {
		t.Errorf("credits header %q", lines[0])
	}
	show := "https://tatoeba.org/en/sentences/show/"
	if !slices.Contains(lines, "1011\t"+show+"1011\tCC0 1.0\twei\t2011\t"+show+"2011\tCC0 1.0\ttom") {
		t.Errorf("credits lack the CC0 line of 1011: %q", lines)
	}
	if !slices.Contains(lines, "1013\t"+show+"1013\tCC BY 2.0 FR\twei\t2015\t"+show+"2015\tCC BY 2.0 FR\temma") {
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

// TestPackCreditsTheDictionaryReadings: the readings and the filing under
// words derive from CC-CEDICT or JMdict (CC BY-SA 4.0): LICENSE,
// ATTRIBUTION.md and the manifest say so, and the attribution names a
// reachable copy of credits.tsv.
func TestPackCreditsTheDictionaryReadings(t *testing.T) {
	out, _ := buildFixture(t, nil)
	for _, tc := range []struct{ id, dict, link string }{
		{"zh-sentences-tatoeba", "CC-CEDICT", "https://cc-cedict.org"},
		{"ja-sentences-tatoeba", "JMdict", "https://www.edrdg.org/"},
	} {
		dir := filepath.Join(out, tc.id)
		p, err := dict.LoadPack(dir)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(p.License, "CC BY-SA 4.0") || !strings.Contains(p.License, tc.dict) {
			t.Errorf("%s license %q does not name the readings' licence", tc.id, p.License)
		}
		credits := "https://github.com/Elaktrato/qinqin/blob/main/plugins/data/" + tc.id + "/credits.tsv"
		if !strings.Contains(p.Attribution, credits) {
			t.Errorf("%s attribution %q lacks %s", tc.id, p.Attribution, credits)
		}
		if !strings.Contains(p.Notice, tc.link) || !strings.Contains(p.Notice, "https://creativecommons.org/licenses/by-sa/4.0/") {
			t.Errorf("%s notice lacks %s or the CC BY-SA 4.0 link", tc.id, tc.link)
		}
		for _, f := range []string{"LICENSE", "ATTRIBUTION.md"} {
			data, err := os.ReadFile(filepath.Join(dir, f))
			if err != nil {
				t.Fatal(err)
			}
			for _, want := range []string{tc.dict, tc.link, "https://creativecommons.org/licenses/by-sa/4.0/", "pinyin"} {
				if !strings.Contains(string(data), want) {
					t.Errorf("%s/%s lacks %q", tc.id, f, want)
				}
			}
		}
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

// TestSizeGuard: a pack file above the cap stops the build (nothing is
// written) unless the size is allowed, which ATTRIBUTION.md records.
func TestSizeGuard(t *testing.T) {
	if defaultMaxFileBytes != 24<<20 {
		t.Errorf("default cap %d, want 24 MiB", defaultMaxFileBytes)
	}
	p, _ := loadPin(fixturePin)
	r, _ := loadRules(fixtureRules)
	out := t.TempDir()
	cfg := buildConfig{Root: ".", ExportDir: fixtureExport, Pin: p, Rules: r, OutDir: out, ReportDir: t.TempDir(),
		Langs: []string{"zh"}, Workers: 1, Log: io.Discard, MaxFileBytes: 1000}
	err := build(context.Background(), cfg)
	if err == nil || !strings.Contains(err.Error(), "--allow-size") {
		t.Fatalf("build over the cap = %v, want a refusal naming --allow-size", err)
	}
	if entries, _ := os.ReadDir(out); len(entries) != 0 {
		t.Errorf("a refused build left %v", entries)
	}
	cfg.AllowSize = true
	if err := build(context.Background(), cfg); err != nil {
		t.Fatalf("build with --allow-size: %v", err)
	}
	attr, _ := os.ReadFile(filepath.Join(out, "zh-sentences-tatoeba", "ATTRIBUTION.md"))
	if !strings.Contains(string(attr), "--allow-size") {
		t.Error("ATTRIBUTION.md does not record --allow-size")
	}
}

// TestStagingIsOutsideThePackFolder: a pack is assembled under the report
// (upstream) folder, never as a hidden directory in plugins/data, where an
// interrupted build would leave it for seed to trip over.
func TestStagingIsOutsideThePackFolder(t *testing.T) {
	var stages []string
	afterStage = func(dir string) { stages = append(stages, dir) }
	defer func() { afterStage = nil }()
	var reports string
	out, _ := buildFixture(t, func(c *buildConfig) { reports = c.ReportDir })
	if len(stages) != 2 {
		t.Fatalf("stages %v, want one per pack", stages)
	}
	for _, s := range stages {
		if !strings.HasPrefix(s, reports+string(filepath.Separator)) || strings.HasPrefix(s, out) {
			t.Errorf("stage %s is not under the report folder %s", s, reports)
		}
		if _, err := os.Stat(s); !os.IsNotExist(err) {
			t.Errorf("stage %s left behind", s)
		}
	}
}
