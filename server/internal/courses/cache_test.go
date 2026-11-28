package courses_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"qinqin/internal/courses"
	"qinqin/internal/dbtest"
	"qinqin/internal/lang"
	"qinqin/internal/levels"
	"qinqin/internal/pack"
	"qinqin/internal/packs"
)

type dbHandle = *sql.DB

// seedPacks imports the packs in dirs through the pack system.
func seedPacks(t *testing.T, ctx context.Context, sqlDB dbHandle, dirs ...string) {
	t.Helper()
	for _, d := range dirs {
		p, err := pack.LoadPack(d)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := packs.Import(ctx, sqlDB, p); err != nil {
			t.Fatalf("import %s: %v", d, err)
		}
	}
}

type answer struct {
	ID     string `json:"id"`
	Fill   string `json:"fill"`
	Source struct {
		Kind string  `json:"kind"`
		Pack *string `json:"pack"`
	} `json:"source"`
	Sections []struct {
		ID        string  `json:"id"`
		LevelName *string `json:"levelName"`
		Units     []struct {
			ID    string `json:"id"`
			Words []struct {
				Key     string   `json:"key"`
				Form    string   `json:"form"`
				Reading string   `json:"reading"`
				EntryID int64    `json:"entryId"`
				Topics  []string `json:"topics"`
			} `json:"words"`
			Lessons []struct {
				ID        string `json:"id"`
				Kind      string `json:"kind"`
				Available *bool  `json:"available"`
			} `json:"lessons"`
		} `json:"units"`
	} `json:"sections"`
}

func (a answer) unitWords(unit string) []string {
	for _, s := range a.Sections {
		for _, u := range s.Units {
			if u.ID == unit {
				var out []string
				for _, w := range u.Words {
					out = append(out, w.Form)
				}
				return out
			}
		}
	}
	return nil
}

func getAnswer(t *testing.T, ctx context.Context, c *courses.Cache, sqlDB dbHandle, id string) (answer, courses.Served) {
	t.Helper()
	s, err := c.Get(ctx, sqlDB, id)
	if err != nil {
		t.Fatal(err)
	}
	var a answer
	if err := json.Unmarshal(s.Body, &a); err != nil {
		t.Fatal(err)
	}
	if a.Fill != s.Fill || a.Fill == "" {
		t.Fatalf("fill %q / %q", a.Fill, s.Fill)
	}
	return a, s
}

// The Chinese fixture course fills from the installed hsk-mini pack and the embedded topic labels; the cache
// answers the same bytes until an input changes; with the level pack gone the course has no words.
func TestCacheFillsFromTheInstalledPacks(t *testing.T) {
	lang.Register(lang.Zh{})
	ctx := context.Background()
	sqlDB := dbtest.Open(t)
	seedPacks(t, ctx, sqlDB, filepath.Join(samples, "zh-mini"), filepath.Join(samples, "hsk-mini"),
		"../grammar/testdata/zh-mini", filepath.Join(samples, "zh-course-mini"))
	var c courses.Cache
	a, first := getAnswer(t, ctx, &c, sqlDB, "zh-course-mini")
	if a.Source.Kind != "levels" || a.Source.Pack == nil || *a.Source.Pack != "hsk-mini" {
		t.Fatalf("source %+v", a.Source)
	}
	if got := a.unitWords("hello"); !slices.Equal(got, []string{"你好", "谢谢"}) {
		t.Fatalf("hello: %v", got)
	}
	if got := a.unitWords("money"); !slices.Equal(got, []string{"银行"}) {
		t.Fatalf("money: %v", got)
	}
	hello := a.Sections[1].Units[0]
	if hello.Words[0].Key != "你好" || hello.Words[0].Reading == "" || hello.Words[0].EntryID == 0 || !slices.Contains(hello.Words[0].Topics, "greetings") {
		t.Fatalf("hello's first word %+v", hello.Words[0])
	}
	if *a.Sections[1].LevelName != "1" {
		t.Fatalf("level name %v", *a.Sections[1].LevelName)
	}
	var grammar *bool
	for _, l := range hello.Lessons {
		if l.Kind == "grammar" {
			grammar = l.Available
		}
	}
	if grammar == nil || !*grammar {
		t.Fatalf("the grammar lesson is not available: %+v", hello.Lessons)
	}
	_, again := getAnswer(t, ctx, &c, sqlDB, "zh-course-mini")
	if string(again.Body) != string(first.Body) {
		t.Fatal("a second Get answered other bytes")
	}

	schemes, _ := levels.List(ctx, sqlDB)
	if err := levels.Uninstall(ctx, sqlDB, schemes[0].ID); err != nil {
		t.Fatal(err)
	}
	b, after := getAnswer(t, ctx, &c, sqlDB, "zh-course-mini")
	if after.Fill == first.Fill || b.Source.Kind != "none" || len(b.unitWords("hello")) != 0 {
		t.Fatalf("after the uninstall: fill %s (was %s), source %+v, hello %v", after.Fill, first.Fill, b.Source, b.unitWords("hello"))
	}
	if _, err := c.Get(ctx, sqlDB, "nope"); !errors.Is(err, courses.ErrNotFound) {
		t.Fatalf("unknown course: %v", err)
	}
}

// With no level pack the Japanese fixture course estimates its levels from the frequency pack, and places words only
// after the units that introduce their kanji.
func TestCacheFallsBackToFrequency(t *testing.T) {
	lang.Register(lang.Ja{})
	ctx := context.Background()
	sqlDB := dbtest.Open(t)
	freqDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(freqDir, "manifest.json"), []byte(`{"id":"ja-freq","name":"Frequency","version":"1","type":"frequency","language":"ja","license":"CC0-1.0","attribution":"Qinqin test fixtures","format":"freq-csv"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(freqDir, "freq.csv"), []byte("term,reading,rank\n学校,がっこう,1\n水,みず,2\n食べる,たべる,3\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	seedPacks(t, ctx, sqlDB, filepath.Join(samples, "ja-mini"), freqDir, filepath.Join(samples, "ja-course-mini"))
	var c courses.Cache
	a, _ := getAnswer(t, ctx, &c, sqlDB, "ja-course-mini")
	if a.Source.Kind != "frequency" || *a.Source.Pack != "ja-freq" {
		t.Fatalf("source %+v", a.Source)
	}
	if got := a.unitWords("school"); !slices.Equal(got, []string{"学校"}) {
		t.Fatalf("school: %v", got)
	}
	if got := a.unitWords("meals"); !slices.Equal(got, []string{"水", "食べる"}) {
		t.Fatalf("meals: %v", got)
	}
}
