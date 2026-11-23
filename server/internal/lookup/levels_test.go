package lookup_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/dict"
	"qinqin/internal/levels"
	"qinqin/internal/lookup"
)

// importLevels imports a word-unit zh levels pack named name with the
// given levels.json through the real importer.
func importLevels(t *testing.T, sqlDB *sql.DB, id, name, levelsJSON string) {
	t.Helper()
	dir := t.TempDir()
	manifest, err := json.Marshal(dict.Manifest{
		ID: id, Name: name, Version: "1", Type: dict.TypeLevels, Language: "zh",
		License: "CC BY-SA 4.0", Attribution: "test", Format: "json",
	})
	if err != nil {
		t.Fatal(err)
	}
	for file, body := range map[string]string{"manifest.json": string(manifest), "levels.json": levelsJSON} {
		if err := os.WriteFile(filepath.Join(dir, file), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	p, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatalf("LoadPack(%s): %v", id, err)
	}
	if _, err := levels.Import(context.Background(), sqlDB, p); err != nil {
		t.Fatalf("levels.Import(%s): %v", id, err)
	}
}

// hskLevels lists 学习 in HSK 3 and again in HSK 5: the entry keeps the
// lowest level of the scheme.
const hskLevels = `{"unit": "word", "levels": [
  {"name": "1", "entries": ["你好"]},
  {"name": "3", "entries": ["学习"]},
  {"name": "5", "entries": ["学习", "好人"]}
]}`

const tocflLevels = `{"unit": "word", "levels": [
  {"name": "A1", "entries": ["你好"]},
  {"name": "B1", "entries": ["学习"]}
]}`

func levelsOf(r *lookup.Result) []string {
	var out []string
	for _, l := range r.Levels {
		out = append(out, l.SchemeName+" "+l.LevelName)
	}
	return out
}

func TestLookupLevelsLowestPerScheme(t *testing.T) {
	sqlDB := dbtest.Open(t)
	importCedict(t, sqlDB)
	importLevels(t, sqlDB, "hsk-test", "HSK", hskLevels)
	s := service(sqlDB)
	s.WithLevels = true

	r := find(run(t, s, "zh", "学习", 0), "学习")
	if r == nil {
		t.Fatal("学习 not found")
	}
	if got := strings.Join(levelsOf(r), ","); got != "HSK 3" {
		t.Errorf("学习 levels = %q, want HSK 3 (the lowest of 3 and 5)", got)
	}

	importLevels(t, sqlDB, "tocfl-test", "TOCFL", tocflLevels)
	r = find(run(t, s, "zh", "学习", 0), "学习")
	if got := strings.Join(levelsOf(r), ","); got != "HSK 3,TOCFL B1" {
		t.Errorf("学习 levels = %q, want HSK 3,TOCFL B1 (one per scheme, scheme order)", got)
	}
}

func TestLookupLevelsEmptyArray(t *testing.T) {
	sqlDB := dbtest.Open(t)
	importCedict(t, sqlDB)
	importLevels(t, sqlDB, "hsk-test", "HSK", hskLevels)
	s := service(sqlDB)
	s.WithLevels = true
	rs := run(t, s, "zh", "行", 0)
	if len(rs) == 0 {
		t.Fatal("行 not found")
	}
	for _, r := range rs {
		if r.Levels == nil || len(r.Levels) != 0 {
			t.Errorf("%s levels = %#v, want an empty non-nil slice", r.Term, r.Levels)
		}
	}
}

// TestLookupLevelsOneQuery: the levels of every result come from one
// batched statement, however many results there are.
func TestLookupLevelsOneQuery(t *testing.T) {
	seeded, path := dbtest.OpenPath(t)
	importCedict(t, seeded)
	importLevels(t, seeded, "hsk-test", "HSK", hskLevels)

	var count atomic.Int64
	var levelQueries atomic.Int64
	counted := sql.OpenDB(countingConnector{drv: seeded.Driver(), dsn: path, count: &count, onQuery: func(q string) {
		if strings.Contains(q, "level_members") {
			levelQueries.Add(1)
		}
	}})
	defer counted.Close()
	s := service(counted)
	s.WithLevels = true

	for _, text := range []string{"你", "你好", "学习", "好人好人"} {
		levelQueries.Store(0)
		rs := run(t, s, "zh", text, 0)
		if len(rs) == 0 {
			t.Fatalf("Lookup(%q) found nothing", text)
		}
		if n := levelQueries.Load(); n != 1 {
			t.Errorf("Lookup(%q) with %d results ran %d levels statements, want 1", text, len(rs), n)
		}
	}
}

// TestLookupWithoutLevelsRunsNoLevelsQuery: the segmenter's lookups (one
// per token) do not ask for levels and pay nothing for them.
func TestLookupWithoutLevelsRunsNoLevelsQuery(t *testing.T) {
	seeded, path := dbtest.OpenPath(t)
	importCedict(t, seeded)
	importLevels(t, seeded, "hsk-test", "HSK", hskLevels)
	var count, levelQueries atomic.Int64
	counted := sql.OpenDB(countingConnector{drv: seeded.Driver(), dsn: path, count: &count, onQuery: func(q string) {
		if strings.Contains(q, "level_members") {
			levelQueries.Add(1)
		}
	}})
	defer counted.Close()
	rs := run(t, service(counted), "zh", "学习", 0)
	if len(rs) == 0 || levelQueries.Load() != 0 {
		t.Errorf("results %d, levels statements %d, want results and 0", len(rs), levelQueries.Load())
	}
	if rs[0].Levels != nil {
		t.Errorf("levels = %#v, want nil when not asked for", rs[0].Levels)
	}
}
