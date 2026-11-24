package dict_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"qinqin/internal/dict"
	"qinqin/internal/pack"
)

// cedictFixture is the committed CC-CEDICT sample, relative to this
// package's test working directory.
const cedictFixture = "testdata/cedict-sample.txt"

// cedictManifest is the manifest of the pack loadCedictFixture builds
// around the committed sample.
var cedictManifest = pack.Manifest{
	ID:          "cedict-sample",
	Name:        "CC-CEDICT sample",
	Version:     "1.0",
	Type:        "dictionary",
	Language:    "zh",
	License:     "CC BY-SA 4.0",
	Attribution: "CC-CEDICT contributors",
	Format:      "cedict",
}

// loadCedictFixture builds the pack around the committed sample: its
// manifest plus a dictionary.txt holding the fixture's lines verbatim.
func loadCedictFixture(t *testing.T) pack.Pack {
	t.Helper()
	data, err := os.ReadFile(cedictFixture)
	if err != nil {
		t.Fatalf("read %s: %v", cedictFixture, err)
	}
	dir := t.TempDir()
	manifest, err := json.Marshal(cedictManifest)
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	mustWriteFile(t, filepath.Join(dir, "manifest.json"), string(manifest))
	mustWriteFile(t, filepath.Join(dir, "dictionary.txt"), string(data))
	pk, err := pack.LoadPack(dir)
	if err != nil {
		t.Fatalf("LoadPack(cedict sample): %v", err)
	}
	return pk
}

// wantVariants asserts the entry's active variants are exactly want, by
// written form.
func TestCedictParse(t *testing.T) {
	f, err := os.Open(cedictFixture)
	if err != nil {
		t.Fatalf("open %s: %v", cedictFixture, err)
	}
	defer f.Close()
	es, err := dict.ParseCedict(f)
	if err != nil {
		t.Fatalf("ParseCedict(%s): %v", cedictFixture, err)
	}
	want := []dict.RawEntry{
		{Written: "头发", Trad: "頭髮", Pinyin: "tou2 fa5", Glosses: []string{"hair", "CL:根|gen1"}},
		{Written: "你好", Trad: "你好", Pinyin: "ni3 hao3", Glosses: []string{"hello", "hi"}},
		{Written: "发展", Trad: "發展", Pinyin: "fa1 zhan3", Glosses: []string{"to develop", "development"}},
	}
	if len(es) != len(want) {
		t.Fatalf("ParseCedict(%s) = %d entries, want %d", cedictFixture, len(es), len(want))
	}
	for i, e := range es {
		w := want[i]
		if e.Written != w.Written || e.Trad != w.Trad || e.Pinyin != w.Pinyin || !slices.Equal(e.Glosses, w.Glosses) {
			t.Errorf("entry %d = %+v, want %+v", i, e, w)
		}
	}
}

func TestCedictParseSkipsCommentsAndBlanks(t *testing.T) {
	es, err := dict.ParseCedict(strings.NewReader(
		"#! cc-cedict 1.0\n\n# a comment line\n你好 你好 [ni3 hao3] /hello/\n"))
	if err != nil {
		t.Fatalf("ParseCedict: %v", err)
	}
	if len(es) != 1 {
		t.Fatalf("ParseCedict parsed %d entries, want 1 — comments and blank lines are skipped", len(es))
	}
	if e := es[0]; e.Written != "你好" || e.Trad != "你好" || e.Pinyin != "ni3 hao3" ||
		!slices.Equal(e.Glosses, []string{"hello"}) {
		t.Errorf("parsed entry = %+v, want 你好 你好 [ni3 hao3] /hello/", e)
	}
}

func TestCedictParseRejectsMalformedLine(t *testing.T) {
	for _, tc := range []struct{ name, line string }{
		{"not an entry", "hello world"},
		{"missing trailing slash", "你好 你好 [ni3 hao3] /hello"},
		{"no glosses", "你好 你好 [ni3 hao3] //"},
	} {
		_, err := dict.ParseCedict(strings.NewReader(tc.line + "\n"))
		if err == nil || !strings.Contains(err.Error(), "line 1") {
			t.Errorf("%s: ParseCedict(%q) = %v, want an error naming line 1", tc.name, tc.line, err)
		}
	}
}
