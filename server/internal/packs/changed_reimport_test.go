package packs_test

import (
	"bytes"
	"compress/gzip"
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/lemma"
	"qinqin/internal/pack"
	"qinqin/internal/packs"
)

// change is one edit of a pack and the stored value it must produce.
type change struct {
	name     string
	edit     func(t *testing.T, dir string)
	query    string // one ?: the registry id; one string column
	want     string // the exact value, or with contains a substring of it
	contains bool
}

// variant copies the pack's directory, applies edit and loads the copy.
func variant(t *testing.T, p pack.Pack, edit func(t *testing.T, dir string)) pack.Pack {
	t.Helper()
	dir := t.TempDir()
	if err := os.CopyFS(dir, os.DirFS(p.Dir)); err != nil {
		t.Fatal(err)
	}
	edit(t, dir)
	v, err := pack.LoadPack(dir)
	if err != nil {
		t.Fatalf("load the changed pack: %v", err)
	}
	return v
}

// setManifest sets one manifest field.
func setManifest(key string, value any) func(t *testing.T, dir string) {
	return func(t *testing.T, dir string) {
		t.Helper()
		path := filepath.Join(dir, "manifest.json")
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		m := map[string]any{}
		if err := json.Unmarshal(raw, &m); err != nil {
			t.Fatal(err)
		}
		m[key] = value
		out, _ := json.Marshal(m)
		if err := os.WriteFile(path, out, 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

// replaceIn replaces old (which must occur) by new in one file.
func replaceIn(file, old, new string) func(t *testing.T, dir string) {
	return func(t *testing.T, dir string) {
		t.Helper()
		path := filepath.Join(dir, filepath.FromSlash(file))
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(raw), old) {
			t.Fatalf("%s holds no %q", file, old)
		}
		if err := os.WriteFile(path, []byte(strings.Replace(string(raw), old, new, 1)), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

func both(edits ...func(t *testing.T, dir string)) func(t *testing.T, dir string) {
	return func(t *testing.T, dir string) {
		for _, e := range edits {
			e(t, dir)
		}
	}
}

// writeStrokes replaces the strokes data file.
func writeStrokes(body string) func(t *testing.T, dir string) {
	return func(t *testing.T, dir string) {
		var gz bytes.Buffer
		zw := gzip.NewWriter(&gz)
		zw.Write([]byte(body))
		zw.Close()
		if err := os.WriteFile(filepath.Join(dir, "strokes.jsonl.gz"), gz.Bytes(), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

// registryColumn reads one column of the type's registry row.
func registryColumn(typ, col string) string {
	d, _ := pack.Lookup(typ)
	return `SELECT ` + col + ` FROM ` + d.Registry + ` WHERE pack_id = ?`
}

// The changes of every type beyond the manifest terms: its language, its
// own registry columns and its data rows.
var typeChanges = map[string][]change{
	pack.TypeDictionary: {
		{"language", setManifest("language", "pt"), registryColumn(pack.TypeDictionary, "language"), "pt", false},
		{"a gloss", replaceIn("dictionary.json", `"glosses":["water"]`, `"glosses":["fresh water"]`),
			`SELECT group_concat(s.glosses, '|') FROM senses s JOIN dictionaries d ON d.id = s.dictionary_id WHERE d.pack_id = ? AND s.deleted_at IS NULL`, "fresh water", true},
	},
	pack.TypeFrequency: {
		{"language", setManifest("language", "pt"), registryColumn(pack.TypeFrequency, "language"), "pt", false},
		{"a rank", replaceIn("freq.csv", "agua,,2", "agua,,9"),
			`SELECT group_concat(f.term || ':' || f.rank, '|') FROM frequency f JOIN frequency_packs p ON p.id = f.pack_id WHERE p.pack_id = ?`, "agua:9", true},
	},
	pack.TypeLevels: {
		{"language", setManifest("language", "pt"), registryColumn(pack.TypeLevels, "language"), "pt", false},
		{"unit", replaceIn("levels.json", `"unit":"word"`, `"unit":"character"`), registryColumn(pack.TypeLevels, "unit"), "character", false},
		{"a level name", replaceIn("levels.json", `"name":"1"`, `"name":"Uno"`),
			`SELECT group_concat(l.name, '|') FROM levels l JOIN schemes s ON s.id = l.scheme_id WHERE s.pack_id = ? AND l.deleted_at IS NULL`, "Uno", false},
	},
	pack.TypeSentences: {
		{"language", setManifest("language", "pt"), registryColumn(pack.TypeSentences, "language"), "pt", false},
		{"a translation", replaceIn("sentences.json", `Hello, friend.`, `Hi, friend.`),
			`SELECT group_concat(translation, '|') FROM sentences WHERE source_pack = ? AND deleted_at IS NULL`, "Hi, friend.", false},
	},
	pack.TypeGrammar: {
		{"language", setManifest("language", "pt"), registryColumn(pack.TypeGrammar, "language"), "pt", false},
		{"levels", replaceIn("lessons.json", `"name": "A1"`, `"name": "Beginner"`), registryColumn(pack.TypeGrammar, "levels_json"), "Beginner", true},
		{"a lesson", replaceIn("lessons.json", `"summary": "To be."`, `"summary": "To be (identity)."`),
			`SELECT group_concat(l.summary, '|') FROM grammar_lessons l JOIN grammar_packs p ON p.id = l.pack_id WHERE p.pack_id = ? AND l.deleted_at IS NULL`, "To be (identity).", false},
	},
	pack.TypeAudio: {
		{"language", setManifest("language", "zh"), registryColumn(pack.TypeAudio, "language"), "zh", false},
		{"a clip licence", replaceIn("index.tsv", "audio/a.opus\t\t", "audio/a.opus\tCC-BY-4.0\t"),
			`SELECT group_concat(c.license, '|') FROM audio_clips c JOIN audio_packs p ON p.id = c.pack_id WHERE p.pack_id = ?`, "CC-BY-4.0", true},
		{"a clip file", replaceIn("audio/b.ogg", "OggS-two", "OggS-other"),
			`SELECT group_concat(c.bytes, '|') FROM audio_clips c JOIN audio_packs p ON p.id = c.pack_id WHERE p.pack_id = ?`, "10", true},
		{"a clip form, same count", replaceIn("index.tsv", "term\t水\tみず", "term\t氷\tみず"),
			`SELECT group_concat(c.form, '|') FROM audio_clips c JOIN audio_packs p ON p.id = c.pack_id WHERE p.pack_id = ?`, "氷", true},
	},
	pack.TypeComponents: {
		{"language", setManifest("language", "pt"), registryColumn(pack.TypeComponents, "language"), "pt", false},
		{"parts", replaceIn("components.tsv", "話\t言 舌", "話\t言 千 口"),
			`SELECT group_concat(char || parts, '|') FROM components WHERE pack_id = ?`, `話["言","千","口"]`, true},
	},
	pack.TypeStrokes: {
		{"languages", setManifest("languages", []string{"zh"}), registryColumn(pack.TypeStrokes, "languages"), `["zh"]`, false},
		{"a stroke", writeStrokes(`{"char":"好","data":{"strokes":["M 9 9"],"medians":[[[9,9]]]}}` + "\n" + `{"char":"一","data":{"strokes":["M 3 4"],"medians":[[[3,4]]]}}` + "\n"),
			`SELECT group_concat(data, '|') FROM strokes WHERE pack_id = ?`, "M 9 9", true},
	},
	pack.TypeLemmaRules: {
		{"language", both(setManifest("language", "pt"), replaceIn("rules.json", `"language": "es"`, `"language": "pt"`)), registryColumn(pack.TypeLemmaRules, "language"), "pt", false},
		{"the rules", replaceIn("rules.json", `"to": "ar"`, `"to": "ir"`), registryColumn(pack.TypeLemmaRules, "rules_json"), `"to": "ir"`, true},
	},
	pack.TypeImages: {
		{"languages", both(setManifest("languages", []string{"zh"}), replaceIn("map.tsv", "ja\t犬\t0\t1F415\t90\tname\t\n", "")), registryColumn(pack.TypeImages, "languages"), `["zh"]`, false},
		{"a picture", replaceIn("pictures/1F415.svg", `r="2"`, `r="3"`),
			`SELECT group_concat(svg, '|') FROM image_pictures WHERE pack_id = ?`, `r="3"`, true},
		{"a credit", replaceIn("pictures.tsv", "OpenMoji, Liz Bravo", "OpenMoji, Someone"),
			`SELECT group_concat(credit, '|') FROM image_pictures WHERE pack_id = ?`, "OpenMoji, Someone", true},
		{"a score", replaceIn("map.tsv", "zh\t狗\t1\t1F415\t100", "zh\t狗\t1\t1F415\t95"),
			`SELECT group_concat(score, '|') FROM image_map WHERE pack_id = ?`, "95", true},
		{"a sense", replaceIn("map.tsv", "zh\t狗\t1\t1F415", "zh\t狗\t2\t1F415"),
			`SELECT group_concat(sense, '|') FROM image_map WHERE pack_id = ?`, "2", true},
	},
	pack.TypeTheme: {
		{"a colour", replaceIn("themes.json", `"panel":"#1e1e2e"`, `"panel":"#1f1f2f"`),
			`SELECT group_concat(data, '|') FROM themes WHERE pack_id = ?`, "#1f1f2f", true},
	},
	pack.TypeFont: {
		{"a slice range", replaceIn("faces.json", "U+4E00-9FFF", "U+4E00-4FFF"),
			`SELECT group_concat(unicode_range, '|') FROM font_slices WHERE pack_id = ?`, "U+4E00-4FFF", false},
		{"a face name", replaceIn("faces.json", `"original":"Test Sans"`, `"original":"Test Sans Two"`),
			`SELECT group_concat(original, '|') FROM font_slices WHERE pack_id = ?`, "Test Sans Two", false},
	},
}

// Re-importing a changed pack stores the change, for every column of every
// type's registry row that is not insert-only and for its data rows (#192
// review: a column left out of the comparison would be lost silently, and
// for the licence terms that breaks the licensing rule).
func TestReimportOfAChangedPackStoresTheChange(t *testing.T) {
	t.Cleanup(func() { lemma.SetInstalled(nil) })
	terms := []change{
		{"name", setManifest("name", "Renamed"), "name", "Renamed", false},
		{"version", setManifest("version", "9.9"), "version", "9.9", false},
		{"license", setManifest("license", "CC BY 4.0"), "license", "CC BY 4.0", false},
		{"attribution", setManifest("attribution", "Someone else"), "attribution", "Someone else", false},
		{"notice", setManifest("notice", "Another notice."), "notice", "Another notice.", false},
	}
	for _, typ := range pack.Types() {
		build, ok := typeCases[typ]
		if !ok {
			t.Errorf("%s: no case", typ)
			continue
		}
		own, ok := typeChanges[typ]
		if !ok {
			t.Errorf("%s: no changes of its own", typ)
		}
		var all []change
		for _, c := range terms {
			all = append(all, change{c.name, c.edit, registryColumn(typ, c.query), c.want, false})
		}
		for _, c := range append(all, own...) {
			t.Run(typ+"/"+c.name, func(t *testing.T) {
				sqlDB := dbtest.Open(t)
				ctx := context.Background()
				stores := t.TempDir()
				opts := []packs.Option{packs.WithAudioStore(filepath.Join(stores, "audio")), packs.WithFontStore(filepath.Join(stores, "fonts"))}
				if typ != pack.TypeDictionary {
					if _, err := packs.Import(ctx, sqlDB, dictPack(t), opts...); err != nil {
						t.Fatal(err)
					}
				}
				p := build(t)
				if _, err := packs.Import(ctx, sqlDB, p, opts...); err != nil {
					t.Fatalf("first import: %v", err)
				}
				v := variant(t, p, c.edit)
				if _, err := packs.Import(ctx, sqlDB, v, opts...); err != nil {
					t.Fatalf("changed import: %v", err)
				}
				var got sql.NullString
				if err := sqlDB.QueryRow(c.query, packs.RegistryID(v.Manifest)).Scan(&got); err != nil {
					t.Fatalf("%s: %v", c.query, err)
				}
				if c.contains && !strings.Contains(got.String, c.want) || !c.contains && got.String != c.want {
					t.Errorf("stored %q, want %q", got.String, c.want)
				}
			})
		}
	}
}
