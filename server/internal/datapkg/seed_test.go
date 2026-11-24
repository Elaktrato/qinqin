package datapkg_test

import (
	"bytes"
	"compress/gzip"
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/lemma"
	"qinqin/internal/pack"
	"qinqin/internal/packs"
)

// jaRules is the lemma-rules pack's table, byte for byte what its package
// must carry.
const jaRules = `{"format": 2, "language": "ja", "version": "t", "maxDepth": 1,
 "classes": {"v1": {"tags": ["v1"]}}, "hints": {},
 "rules": [{"from": "た", "to": "る", "reason": "past", "out": "v1"}]}`

// writePack writes a pack directory (manifest fields plus files) and loads it.
func writePack(t *testing.T, manifest map[string]any, files map[string][]byte) pack.Pack {
	t.Helper()
	dir := t.TempDir()
	if _, ok := manifest["version"]; !ok {
		manifest["version"] = "1.0"
	}
	if _, ok := manifest["attribution"]; !ok {
		manifest["attribution"] = "Qinqin test fixtures"
	}
	m, _ := json.Marshal(manifest)
	files["manifest.json"] = m
	for name, body := range files {
		p := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, body, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	p, err := pack.LoadPack(dir)
	if err != nil {
		t.Fatalf("LoadPack %v: %v", manifest["id"], err)
	}
	return p
}

func gz(s string) []byte {
	var b bytes.Buffer
	w := gzip.NewWriter(&b)
	w.Write([]byte(s))
	w.Close()
	return b.Bytes()
}

const (
	zhALicense     = "Test licence of zh-a\nline two\n"
	zhAAttribution = "# zh-a\nMade for tests.\n"
)

// seeded is a test database with one pack of every type.
type seeded struct {
	db       *sql.DB
	audioDir string
}

// seedAll installs, through packs.Import: two zh dictionaries (zh-a with
// LICENSE and ATTRIBUTION.md, zh-b without licence files), a ja dictionary,
// and one levels, sentences, frequency, components, grammar, audio and
// strokes pack, and a lemma-rules pack (ja-rules).
func seedAll(t *testing.T) seeded {
	t.Helper()
	t.Cleanup(func() { lemma.SetInstalled(nil) }) // ja-rules overlays the built-in table
	ctx := context.Background()
	s := seeded{db: dbtest.Open(t), audioDir: t.TempDir()}
	for _, p := range []pack.Pack{
		writePack(t, map[string]any{"id": "zh-a", "name": "Zh A", "type": "dictionary", "language": "zh", "license": "CC0-1.0", "format": "json", "notice": "Zh A notice."},
			map[string][]byte{
				"dictionary.json": []byte(`{"entries":[
 {"written":"好","kind":"character","readings":[{"type":"pinyin","value":"hǎo"}],"glosses":["good"]},
 {"written":"你好","kind":"word","readings":[{"type":"pinyin","value":"nǐ hǎo"}],"glosses":["hello"]},
 {"written":"水","kind":"character","readings":[{"type":"pinyin","value":"shuǐ"}],"glosses":["water"]}]}`),
				"LICENSE":        []byte(zhALicense),
				"ATTRIBUTION.md": []byte(zhAAttribution),
			}),
		writePack(t, map[string]any{"id": "zh-b", "name": "Zh B", "type": "dictionary", "language": "zh", "license": "MIT", "format": "json"},
			map[string][]byte{"dictionary.json": []byte(`{"entries":[
 {"written":"好","kind":"character","readings":[{"type":"pinyin","value":"hǎo"}],"glosses":["fine (zh-b)"]}]}`)}),
		writePack(t, map[string]any{"id": "ja-a", "name": "Ja A", "type": "dictionary", "language": "ja", "license": "CC0-1.0", "format": "json"},
			map[string][]byte{"dictionary.json": []byte(`{"entries":[
 {"written":"水","kind":"word","readings":[{"type":"kana","value":"みず"}],"glosses":["water"]},
 {"written":"水道","kind":"word","readings":[{"type":"kana","value":"すいどう"}],"glosses":["water supply"]}]}`)}),
		writePack(t, map[string]any{"id": "zh-levels", "name": "Zh levels", "type": "levels", "language": "zh", "license": "CC0-1.0", "format": "json"},
			map[string][]byte{"levels.json": []byte(`{"unit":"word","levels":[{"name":"1","entries":["你好"]}]}`)}),
		writePack(t, map[string]any{"id": "zh-sent", "name": "Zh sentences", "type": "sentences", "language": "zh", "license": "CC BY 4.0", "format": "json"},
			map[string][]byte{"sentences.json": []byte(`{"entries":[{"word":"你好","sentences":[
 {"hanzi":"你好！","pinyin":"nǐ hǎo","translation":"Hello!"},
 {"hanzi":"你好吗？","pinyin":"nǐ hǎo ma","translation":"How are you?"}]}]}`)}),
		writePack(t, map[string]any{"id": "zh-freq", "name": "Zh frequency", "type": "frequency", "language": "zh", "license": "MIT", "format": "freq-csv"},
			map[string][]byte{"freq.csv": []byte("term,reading,rank\n你好,,1\n水,,2\n好,,3\n")}),
		writePack(t, map[string]any{"id": "zh-comp", "name": "Zh components", "type": "components", "language": "zh", "license": "CC BY-SA 3.0", "format": "components-tsv"},
			map[string][]byte{"components.tsv": []byte("好\t女 子\n"), "parts.tsv": []byte("女\t3\n")}),
		writePack(t, map[string]any{"id": "zh-gram", "name": "Zh grammar", "type": "grammar", "language": "zh", "license": "CC0-1.0", "format": "json"},
			map[string][]byte{"lessons.json": []byte(`{"levels":[{"id":"a1","name":"A1"}],
 "lessons":[{"id":"shi","level":"a1","title":"是","summary":"To be.","pattern":["A 是 B"],"body":["是 links nouns."],
 "examples":[{"id":"shi-1","text":"我是学生。","translation":"I am a student."}]}]}`)}),
		writePack(t, map[string]any{"id": "ja-audio", "name": "Ja audio", "type": "audio", "language": "ja", "license": "CC0", "format": "audio-index"},
			map[string][]byte{
				"index.tsv":    []byte("kind\tform\treading\tfile\tlicense\tattribution\tsource\nterm\t水\tみず\taudio/a.opus\t\t\t\nterm\t風\tかぜ\taudio/b.ogg\t\t\t\n"),
				"audio/a.opus": []byte("OggS-one"),
				"audio/b.ogg":  []byte("OggS-two"),
			}),
		writePack(t, map[string]any{"id": "hw", "name": "Strokes", "type": "strokes", "languages": []string{"zh", "ja"}, "license": "Arphic Public License", "format": "hanzi-writer-jsonl-gz"},
			map[string][]byte{"strokes.jsonl.gz": gz(`{"char":"好","data":{"strokes":["M 1 2"]}}` + "\n" + `{"char":"一","data":{"strokes":["M 3 4"]}}` + "\n"), "LICENSE": []byte("Arphic\n")}),
		writePack(t, map[string]any{"id": "ja-rules", "name": "Ja rules", "type": "lemma-rules", "language": "ja", "license": "CC0-1.0", "format": "rules-json"},
			map[string][]byte{"rules.json": []byte(jaRules), "LICENSE": []byte("CC0\n")}),
	} {
		if _, err := packs.Import(ctx, s.db, p, packs.WithAudioStore(s.audioDir)); err != nil {
			t.Fatalf("import %s: %v", p.ID, err)
		}
	}
	// Links: one per language, and one across languages (in no package).
	if _, err := s.db.Exec(`INSERT INTO entry_links (from_id, to_id, type, updated_at)
		SELECT a.id, b.id, 'variant', 't' FROM entries a, entries b
		WHERE (a.language = 'zh' AND a.ext_key LIKE '%你好%' AND b.language = 'zh' AND b.ext_key LIKE '%好%' AND b.kind = 'character')
		   OR (a.language = 'ja' AND a.ext_key LIKE '%水道%' AND b.language = 'ja' AND b.ext_key LIKE '%水%' AND b.id <> a.id)
		   OR (a.language = 'zh' AND a.kind = 'character' AND a.ext_key LIKE '%水%' AND b.language = 'ja' AND b.ext_key LIKE '%水%' AND b.ext_key NOT LIKE '%道%')`); err != nil {
		t.Fatal(err)
	}
	return s
}
