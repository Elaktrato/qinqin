package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"qinqin/internal/strokes"
)

// seedOrder is the seed order the owner pinned for #192: dictionaries first
// (the other packs refer to their entries), then frequency, levels,
// sentences, grammar, audio, components, strokes, lemma-rules, theme and
// font; within a type, path order. It is written out here on purpose, not
// read from the pack-type table: a change of the table's order must fail
// this test.
var seedOrder = []string{
	"dictionary", "frequency", "levels", "sentences", "grammar", "audio",
	"components", "strokes", "lemma-rules", "theme", "font",
}

// writeOrderPack writes a pack directory root/dir from its files.
func writeOrderPack(t *testing.T, root, dir string, files map[string]string) {
	t.Helper()
	for name, body := range files {
		path := filepath.Join(root, dir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

// One pack of every type in one root, their directories named so that path
// order is the reverse of the type order: only the type order can put the
// seed log in the pinned order. Two types have two packs each, which pins
// path order within a type.
func TestSeedOrderIsPinned(t *testing.T) {
	sqlDB, _ := openTestDB(t)
	root := smallPacks(t) // es-demo, ja-mini, zh-mini dictionaries; hsk-mini, jlpt-mini levels
	manifest := func(id, typ, lang, format string) string {
		l := `"language":"` + lang + `",`
		if lang == "" {
			l = ""
		}
		return `{"id":"` + id + `","name":"` + id + `","version":"1","type":"` + typ + `",` + l +
			`"license":"CC0-1.0","attribution":"Qinqin test fixtures","format":"` + format + `"}`
	}
	slice := "wOF2\x00\x01\x00\x00order"
	sum := sha256.Sum256([]byte(slice))
	sha := hex.EncodeToString(sum[:])
	writeOrderPack(t, root, "a-font", map[string]string{
		"manifest.json": manifest("order-font", "font", "", "font-slices"),
		"faces.json": `{"version":1,"faces":[{"face":"serif","script":"Hant","original":"Test Serif","weight":"400","style":"normal",
			"slices":[{"file":"slices/` + sha + `.woff2","unicodeRange":"U+4E00-9FFF"}]}]}`,
		"slices/" + sha + ".woff2": slice,
	})
	writeOrderPack(t, root, "b-theme", map[string]string{
		"manifest.json": manifest("order-theme", "theme", "", "themes-json"),
		"themes.json": `[{"id":"order-dark","name":"Order dark","scheme":"dark",
 "colors":{"chrome":"#11111b","panel":"#1e1e2e","raised":"#313244","line":"#45475a","text":"#cdd6f4","muted":"#a6adc8",
  "good":"#a6e3a1","warn":"#f9e2af","bad":"#f38ba8","gradeAgain":"#f38ba8","gradeHard":"#fab387","gradeGood":"#a6e3a1","gradeEasy":"#89b4fa"},
 "accents":{"mauve":"#cba6f7"},"defaultAccent":"mauve"}]`,
	})
	writeOrderPack(t, root, "c-lemma", map[string]string{
		"manifest.json": manifest("order-lemma", "lemma-rules", "es", "rules-json"),
		"rules.json":    lemmaTable("es", "1"),
	})
	writeOrderPack(t, root, "d-strokes", map[string]string{
		"manifest.json": `{"id":"order-strokes","name":"order-strokes","version":"1","type":"strokes","languages":["zh"],
			"license":"CC0-1.0","attribution":"Qinqin test fixtures","format":"hanzi-writer-jsonl-gz"}`,
	})
	if err := os.Rename(filepath.Join(writeStrokesPack(t, t.TempDir()), strokes.DataFile), filepath.Join(root, "d-strokes", strokes.DataFile)); err != nil {
		t.Fatal(err)
	}
	writeOrderPack(t, root, "e-components", map[string]string{
		"manifest.json":  manifest("order-components", "components", "zh", "components-tsv"),
		"components.tsv": "好\t女 子\n",
	})
	audioPackDir(t, root, "f-audio")
	copyTree(t, grammarFixture, filepath.Join(root, "g-grammar"))
	copyTree(t, "../../internal/sentences/testdata/zh-mini", filepath.Join(root, "h-sentences"))
	writeFreqPack(t, root, "i-frequency", "学校,がっこう,1\n")
	// A second dictionary, by path before the others.
	writeOrderPack(t, root, "0-dictionary", map[string]string{
		"manifest.json":   manifest("order-dictionary", "dictionary", "es", "json"),
		"dictionary.json": `{"entries":[{"written":"agua","kind":"word","readings":[{"type":"latin","value":"agua"}],"glosses":["water"]}]}`,
	})

	var out strings.Builder
	if err := seed(context.Background(), sqlDB, t.TempDir(), []string{root}, &out); err != nil {
		t.Fatalf("seed: %v\n%s", err, out.String())
	}
	var got []string
	for _, line := range strings.Split(strings.TrimSpace(out.String()), "\n") {
		f := strings.Fields(line)
		if len(f) >= 2 && slices.Contains(seedOrder, f[1]) {
			got = append(got, f[0]+" "+f[1])
		}
	}
	want := []string{
		"order-dictionary dictionary", "es-demo dictionary", "ja-mini dictionary", "zh-mini dictionary",
		"i-frequency frequency",
		"hsk-mini levels", "jlpt-mini levels",
		"zh-mini sentences",
		"zh-grammar-mini grammar",
		"f-audio audio",
		"order-components components",
		"order-strokes strokes",
		"order-lemma lemma-rules",
		"order-theme theme",
		"order-font font",
	}
	if !slices.Equal(got, want) {
		t.Errorf("seed order\n%s\nwant\n%s\nfull output:\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"), out.String())
	}
	// The pinned list names every type, in the order the lines show.
	var types []string
	for _, w := range want {
		if typ := strings.Fields(w)[1]; !slices.Contains(types, typ) {
			types = append(types, typ)
		}
	}
	if !slices.Equal(types, seedOrder) {
		t.Errorf("types in the pinned lines %v, want %v", types, seedOrder)
	}
	for i, typ := range seedOrder {
		if importRank(typ) != i {
			t.Errorf("importRank(%s) = %d, want %d", typ, importRank(typ), i)
		}
	}
}
