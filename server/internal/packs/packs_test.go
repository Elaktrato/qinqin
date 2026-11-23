package packs_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"qinqin/internal/db"
	"qinqin/internal/dict"
	"qinqin/internal/packs"
)

func newDB(t *testing.T) *sql.DB {
	t.Helper()
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	return sqlDB
}

// buildPack writes a pack directory from strings and loads it.
func buildPack(t *testing.T, typ, id, name, license, format string, files map[string]string) dict.Pack {
	t.Helper()
	dir := t.TempDir()
	m, _ := json.Marshal(map[string]string{
		"id": id, "name": name, "version": "1.0", "type": typ, "language": "es",
		"license": license, "attribution": "Qinqin test fixtures", "format": format,
		"notice": "A notice.",
	})
	files["manifest.json"] = string(m)
	for n, body := range files {
		if err := os.WriteFile(filepath.Join(dir, n), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	p, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatalf("LoadPack: %v", err)
	}
	return p
}

const esDict = `{"entries":[
 {"written":"hola","kind":"word","readings":[{"type":"latin","value":"hola"}],"glosses":["hello"]},
 {"written":"gracias","kind":"word","readings":[{"type":"latin","value":"gracias"}],"glosses":["thanks"]},
 {"written":"agua","kind":"word","readings":[{"type":"latin","value":"agua"}],"glosses":["water"]},
 {"written":"casa","kind":"word","readings":[{"type":"latin","value":"casa"}],"glosses":["house"]}]}`

func dictPack(t *testing.T) dict.Pack {
	return buildPack(t, "dictionary", "es-test", "Zeta dictionary", "CC0-1.0", "json", map[string]string{"dictionary.json": esDict})
}
func freqPack(t *testing.T) dict.Pack {
	return buildPack(t, "frequency", "es-freq", "Alpha frequency", "MIT", "freq-csv",
		map[string]string{"freq.csv": "term,reading,rank\nhola,,1\nagua,,2\ncasa,,3\n"})
}
func levelsPack(t *testing.T) dict.Pack {
	return buildPack(t, "levels", "es-levels", "Levels", "CC BY 4.0", "json",
		map[string]string{"levels.json": `{"unit":"word","levels":[{"name":"1","entries":["hola","agua"]}]}`})
}
func sentencesPack(t *testing.T) dict.Pack {
	return buildPack(t, "sentences", "es-sent", "Sentences", "CC BY-SA 4.0", "json",
		map[string]string{"sentences.json": `{"entries":[{"word":"hola","sentences":[{"hanzi":"Hola, amigo.","pinyin":"hola","translation":"Hello, friend."}]}]}`})
}

func grammarPack(t *testing.T) dict.Pack {
	return buildPack(t, "grammar", "es-grammar", "Grammar", "CC0-1.0", "json", map[string]string{"lessons.json": `{
  "levels": [{"id": "a1", "name": "A1"}],
  "lessons": [{"id": "ser", "level": "a1", "title": "ser", "summary": "To be.", "pattern": ["A + ser + B"], "body": ["ser links nouns."],
    "examples": [{"id": "ser-1", "text": "Soy estudiante.", "translation": "I am a student."}]}]}`})
}

func TestGrammarPacks(t *testing.T) {
	sqlDB := newDB(t)
	ctx := context.Background()
	got, err := packs.Import(ctx, sqlDB, grammarPack(t))
	if err != nil || got != "1 lessons" {
		t.Fatalf("Import = %q, %v", got, err)
	}
	list, _ := packs.List(ctx, sqlDB)
	if len(list) != 1 || list[0].Type != "grammar" || list[0].License != "CC0-1.0" || list[0].Name != "Grammar" || list[0].UpdatedAt == "" {
		t.Fatalf("list = %+v", list)
	}
	if err := packs.Uninstall(ctx, sqlDB, "grammar", "es-grammar"); err != nil {
		t.Fatal(err)
	}
	if err := packs.Uninstall(ctx, sqlDB, "grammar", "es-grammar"); !errors.Is(err, packs.ErrNotFound) {
		t.Errorf("second uninstall = %v", err)
	}
	if list, _ := packs.List(ctx, sqlDB); len(list) != 0 {
		t.Errorf("list after uninstall = %+v", list)
	}
}

func TestImportDispatchesByType(t *testing.T) {
	sqlDB := newDB(t)
	ctx := context.Background()
	for _, tc := range []struct {
		pack dict.Pack
		want string
	}{
		{dictPack(t), "4 entries, 4 senses"},
		{freqPack(t), "3 rows"},
		{levelsPack(t), "0 unknown forms skipped"},
		{sentencesPack(t), "0 unknown words skipped"},
	} {
		got, err := packs.Import(ctx, sqlDB, tc.pack)
		if err != nil || got != tc.want {
			t.Errorf("%s: summary %q, err %v, want %q", tc.pack.Type, got, err, tc.want)
		}
	}
	bad := dictPack(t)
	bad.Type = "bogus"
	if _, err := packs.Import(ctx, sqlDB, bad); !errors.Is(err, packs.ErrUnknownType) {
		t.Errorf("unknown type err = %v", err)
	}
}

func importAll(t *testing.T, sqlDB *sql.DB) {
	t.Helper()
	for _, p := range []dict.Pack{dictPack(t), freqPack(t), levelsPack(t), sentencesPack(t)} {
		if _, err := packs.Import(context.Background(), sqlDB, p); err != nil {
			t.Fatalf("import %s: %v", p.ID, err)
		}
	}
}

func TestListAllTypes(t *testing.T) {
	sqlDB := newDB(t)
	importAll(t, sqlDB)
	// Sentences without a registry row (a pre-v0.2.0 import) are no pack (#198).
	var entryID int64
	if err := sqlDB.QueryRow(`SELECT id FROM entries LIMIT 1`).Scan(&entryID); err != nil {
		t.Fatal(err)
	}
	if _, err := sqlDB.Exec(`INSERT INTO sentences (entry_id, source_pack, user_id, hanzi, pinyin, translation, updated_at) VALUES (?, 'legacy-pack', NULL, 'a', 'b', 'c', 't')`, entryID); err != nil {
		t.Fatal(err)
	}
	// A user-owned sentence never lists as a pack.
	if _, err := sqlDB.Exec(`INSERT INTO users (id, username, hash, admin, updated_at) VALUES (1, 'u', 'h', 0, 't')`); err != nil {
		t.Fatal(err)
	}
	if _, err := sqlDB.Exec(`INSERT INTO sentences (entry_id, source_pack, user_id, hanzi, pinyin, translation, updated_at) VALUES (?, '', 1, 'a', 'b', 'c', 't')`, entryID); err != nil {
		t.Fatal(err)
	}

	got, err := packs.List(context.Background(), sqlDB)
	if err != nil {
		t.Fatal(err)
	}
	order := []string{"dictionary/es-test", "frequency/es-freq", "levels/es-levels", "sentences/es-sent"}
	if len(got) != len(order) {
		t.Fatalf("list = %+v", got)
	}
	for i, want := range order {
		if have := got[i].Type + "/" + got[i].PackID; have != want {
			t.Errorf("row %d = %s, want %s", i, have, want)
		}
	}
	d := got[0]
	if d.Name != "Zeta dictionary" || d.Version != "1.0" || d.Language != "es" || d.License != "CC0-1.0" ||
		d.Attribution != "Qinqin test fixtures" || d.Notice != "A notice." || d.UpdatedAt == "" {
		t.Errorf("dictionary row = %+v", d)
	}
	for _, p := range got[:4] {
		if p.License == "" || p.Language != "es" || p.Name == "" {
			t.Errorf("%s/%s missing fields: %+v", p.Type, p.PackID, p)
		}
	}
	raw, _ := json.Marshal(got[0])
	var m map[string]any
	json.Unmarshal(raw, &m)
	for _, k := range []string{"type", "packId", "name", "version", "language", "license", "attribution", "notice", "updatedAt"} {
		if _, ok := m[k]; !ok {
			t.Errorf("JSON lacks %q: %s", k, raw)
		}
	}
}

func TestListSortsByNameWithinType(t *testing.T) {
	sqlDB := newDB(t)
	ctx := context.Background()
	for _, id := range []string{"b-dict", "a-dict"} {
		p := buildPack(t, "dictionary", id, "Same name", "CC0-1.0", "json", map[string]string{"dictionary.json": esDict})
		if _, err := packs.Import(ctx, sqlDB, p); err != nil {
			t.Fatal(err)
		}
	}
	got, _ := packs.List(ctx, sqlDB)
	if len(got) != 2 || got[0].PackID != "a-dict" {
		t.Errorf("tie on name must fall back to pack id: %+v", got)
	}
}

func TestUninstallEachType(t *testing.T) {
	sqlDB := newDB(t)
	ctx := context.Background()
	importAll(t, sqlDB)
	for _, k := range [][2]string{
		{"dictionary", "es-test"}, {"frequency", "es-freq"}, {"levels", "es-levels"}, {"sentences", "es-sent"},
	} {
		if err := packs.Uninstall(ctx, sqlDB, k[0], k[1]); err != nil {
			t.Errorf("Uninstall %v: %v", k, err)
		}
		if err := packs.Uninstall(ctx, sqlDB, k[0], k[1]); !errors.Is(err, packs.ErrNotFound) {
			t.Errorf("second Uninstall %v err = %v, want ErrNotFound", k, err)
		}
		if _, err := packs.Find(ctx, sqlDB, k[0], k[1]); !errors.Is(err, packs.ErrNotFound) {
			t.Errorf("Find after uninstall %v err = %v", k, err)
		}
	}
	if got, _ := packs.List(ctx, sqlDB); len(got) != 0 {
		t.Errorf("list after uninstalling all = %+v", got)
	}
	if err := packs.Uninstall(ctx, sqlDB, "bogus", "x"); !errors.Is(err, packs.ErrUnknownType) {
		t.Errorf("unknown type err = %v", err)
	}
	if err := packs.Uninstall(ctx, sqlDB, "dictionary", "missing"); !errors.Is(err, packs.ErrNotFound) {
		t.Errorf("missing err = %v", err)
	}
}

func TestFind(t *testing.T) {
	sqlDB := newDB(t)
	importAll(t, sqlDB)
	p, err := packs.Find(context.Background(), sqlDB, "levels", "es-levels")
	if err != nil || p.Name != "Levels" || p.License != "CC BY 4.0" {
		t.Errorf("Find = %+v, %v", p, err)
	}
	if _, err := packs.Find(context.Background(), sqlDB, "bogus", "x"); !errors.Is(err, packs.ErrUnknownType) {
		t.Errorf("unknown type err = %v", err)
	}
}

func componentsPack(t *testing.T) dict.Pack {
	return buildPack(t, "components", "es-comp", "Components", "CC BY-SA 3.0", "components-tsv",
		map[string]string{"components.tsv": "語\t言 口 吾\n話\t言 舌\n", "parts.tsv": "言\t7\n"})
}

func TestComponentsPacks(t *testing.T) {
	sqlDB := newDB(t)
	ctx := context.Background()
	importAll(t, sqlDB)
	got, err := packs.Import(ctx, sqlDB, componentsPack(t))
	if err != nil || got != "2 characters, 4 parts" {
		t.Fatalf("Import = %q, %v", got, err)
	}
	list, _ := packs.List(ctx, sqlDB)
	last := list[len(list)-1]
	if last.Type != "components" || last.PackID != "es-comp" || last.License != "CC BY-SA 3.0" || last.Notice != "A notice." || last.UpdatedAt == "" {
		t.Fatalf("list = %+v", list)
	}
	if !packs.Supported("components") || !packs.Installable("components") {
		t.Errorf("components must be supported and installable")
	}
	if _, err := packs.Find(ctx, sqlDB, "components", "es-comp"); err != nil {
		t.Errorf("Find = %v", err)
	}
	if err := packs.Uninstall(ctx, sqlDB, "components", "es-comp"); err != nil {
		t.Fatal(err)
	}
	if err := packs.Uninstall(ctx, sqlDB, "components", "es-comp"); !errors.Is(err, packs.ErrNotFound) {
		t.Errorf("second uninstall = %v", err)
	}
	var rows int
	sqlDB.QueryRow(`SELECT COUNT(*) FROM components`).Scan(&rows)
	if rows != 0 {
		t.Errorf("components rows after uninstall = %d", rows)
	}
}
