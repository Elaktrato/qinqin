package segment_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/levels"
	"qinqin/internal/pack"
	"qinqin/internal/segment"
)

// zhCasesFixture is docs/contracts/segment/zh-cases.json: CC-CEDICT lines,
// a word level list and texts with the tokens the Chinese lattice must
// produce, with the list installed (Cases) and without it (WithoutLevels).
type zhCasesFixture struct {
	Version  int      `json:"version"`
	Rule     string   `json:"rule"`
	Language string   `json:"language"`
	Rules    string   `json:"rules"`
	Doc      string   `json:"_doc"`
	Lexicon  []string `json:"lexicon"`
	Levels   []struct {
		Name    string `json:"name"`
		Entries []struct {
			Form    string `json:"form"`
			Reading string `json:"reading"`
		} `json:"entries"`
	} `json:"levels"`
	Cases         []zhCase `json:"cases"`
	WithoutLevels []zhCase `json:"withoutLevels"`
}

type zhCase struct {
	Name   string   `json:"name"`
	Text   string   `json:"text"`
	Greedy []string `json:"greedy"`
	Tokens []struct {
		Surface  string `json:"surface"`
		Reading  string `json:"reading"`
		Function bool   `json:"function"`
	} `json:"tokens"`
}

func readZhCases(t *testing.T) zhCasesFixture {
	t.Helper()
	raw, err := os.ReadFile("../../../docs/contracts/segment/zh-cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx zhCasesFixture
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&fx); err != nil {
		t.Fatal(err)
	}
	if fx.Version != 1 || fx.Rule != "segment/zh-cases" || fx.Language != "zh" || fx.Rules != "zh.json" || len(fx.Cases) == 0 || len(fx.WithoutLevels) == 0 || len(fx.Levels) == 0 {
		t.Fatalf("fixture header = %+v", fx.Rule)
	}
	return fx
}

// The Chinese rules of the contract are the ones the server embeds, byte
// for byte, and they parse.
func TestContractZhRulesAreEmbedded(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/segment/zh.json")
	if err != nil {
		t.Fatal(err)
	}
	embedded, ok := segment.RulesFile("zh")
	if !ok || !bytes.Equal(raw, embedded) {
		t.Fatal("docs/contracts/segment/zh.json differs from server/internal/segment/rules/zh.json")
	}
	if _, err := segment.ParseRules(raw); err != nil {
		t.Fatal(err)
	}
}

func TestContractZhSegmentCases(t *testing.T) {
	fx := readZhCases(t)
	lexicon := strings.Join(fx.Lexicon, "\n") + "\n"
	run := func(t *testing.T, withLevels bool, cases []zhCase) {
		sqlDB := dbtest.Open(t)
		importPack(t, sqlDB, pack.Manifest{
			ID: "cedict-test", Name: "CC-CEDICT test", Version: "1", Type: "dictionary", Language: "zh",
			License: "CC BY-SA 4.0", Attribution: "CC-CEDICT", Format: "cedict",
		}, "dictionary.txt", lexicon)
		if withLevels {
			importLevels(t, sqlDB, fx.Levels)
		}
		svc := service(sqlDB)
		svc.WithReadings = true
		for _, c := range cases {
			ms, err := svc.Segment(context.Background(), fx.Language, c.Text)
			if err != nil {
				t.Fatalf("%s: %v", c.Name, err)
			}
			var got, want []string
			for _, m := range ms {
				reading := ""
				if m.Reading != nil {
					reading = m.Reading.Value
				}
				got = append(got, zhToken(m.Surface, reading, m.Function))
			}
			for _, w := range c.Tokens {
				want = append(want, zhToken(w.Surface, w.Reading, w.Function))
			}
			if g, w := strings.Join(got, " | "), strings.Join(want, " | "); g != w {
				t.Errorf("%s: Segment(%q)\n got  %s\n want %s", c.Name, c.Text, g, w)
			}
		}
	}
	t.Run("with the level list", func(t *testing.T) { run(t, true, fx.Cases) })
	t.Run("without a level list", func(t *testing.T) { run(t, false, fx.WithoutLevels) })
}

func zhToken(surface, reading string, function bool) string {
	s := surface + "(" + reading + ")"
	if function {
		s += "*"
	}
	return s
}

// importLevels installs lvls as a word levels pack with the real importer.
func importLevels(t *testing.T, sqlDB *sql.DB, lvls any) {
	t.Helper()
	dir := t.TempDir()
	body, err := json.Marshal(map[string]any{"unit": "word", "levels": lvls})
	if err != nil {
		t.Fatal(err)
	}
	manifest, _ := json.Marshal(pack.Manifest{ID: "levels-test", Name: "Levels test", Version: "1", Type: pack.TypeLevels,
		Language: "zh", License: "CC BY 4.0", Attribution: "test", Format: pack.FormatJSON})
	for name, b := range map[string][]byte{"manifest.json": manifest, "levels.json": body} {
		if err := os.WriteFile(filepath.Join(dir, name), b, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	p, err := pack.LoadPack(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := levels.Import(context.Background(), sqlDB, p); err != nil {
		t.Fatal(err)
	}
}
