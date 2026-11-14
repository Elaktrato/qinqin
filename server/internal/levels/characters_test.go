package levels_test

import (
	"context"
	"errors"
	"testing"

	"qinqin/internal/dict"
	"qinqin/internal/lang"
	"qinqin/internal/levels"
)

// charsOf flattens SchemeCharacters into level name -> chars, keeping
// the level order in names.
func charsOf(t *testing.T, got []levels.LevelChars) (names []string, chars map[string]string) {
	t.Helper()
	chars = map[string]string{}
	for _, l := range got {
		if l.ID == 0 {
			t.Errorf("level %q has no id", l.Name)
		}
		names = append(names, l.Name)
		chars[l.Name] = l.Chars
	}
	return names, chars
}

func TestSchemeCharactersWordUnit(t *testing.T) {
	lang.Register(lang.Zh{})
	sqlDB := newDB(t)
	ctx := context.Background()
	seedFixture(t, sqlDB)

	pack, err := dict.LoadPack(hskMini)
	if err != nil {
		t.Fatalf("load fixture pack: %v", err)
	}
	if _, err := levels.Import(ctx, sqlDB, pack); err != nil {
		t.Fatalf("import fixture scheme: %v", err)
	}
	schemes, err := levels.List(ctx, sqlDB)
	if err != nil || len(schemes) != 1 {
		t.Fatalf("levels.List = %v (err %v), want one scheme", schemes, err)
	}
	id := schemes[0].ID

	got, err := levels.SchemeCharacters(ctx, sqlDB, id)
	if err != nil {
		t.Fatalf("SchemeCharacters: %v", err)
	}
	names, chars := charsOf(t, got)
	if len(names) != 2 || names[0] != "1" || names[1] != "2" {
		t.Fatalf("levels = %v, want 1 then 2", names)
	}
	if got[0].ID != schemes[0].Levels[0].ID || got[1].ID != schemes[0].Levels[1].ID {
		t.Errorf("level ids = %d, %d, want the listed levels' ids", got[0].ID, got[1].ID)
	}
	// Every Han character of the member words, each once, in order of
	// first appearance.
	if chars["1"] != "你好谢" || chars["2"] != "银行" {
		t.Errorf("chars = %v, want 1: 你好谢, 2: 银行", chars)
	}
}

func TestSchemeCharactersLowestLevelWins(t *testing.T) {
	lang.Register(lang.Zh{})
	sqlDB := newDB(t)
	ctx := context.Background()
	// No character entry for 人: it still counts, being written in a
	// member word; 好 sits in level 1 (你好) and not again in level 2.
	importCedict(t, sqlDB, lineNihao, lineHaoren, lineNi, lineHao)
	if _, err := levels.Import(ctx, sqlDB, buildPack(t, "lowest", `{"unit":"word","levels":[
		{"name":"1","entries":["你好"]},
		{"name":"2","entries":["好人"]},
		{"name":"3","entries":["你"]}]}`)); err != nil {
		t.Fatalf("import scheme: %v", err)
	}
	schemes, err := levels.List(ctx, sqlDB)
	if err != nil || len(schemes) != 1 {
		t.Fatalf("levels.List = %v (err %v), want one scheme", schemes, err)
	}
	got, err := levels.SchemeCharacters(ctx, sqlDB, schemes[0].ID)
	if err != nil {
		t.Fatalf("SchemeCharacters: %v", err)
	}
	names, chars := charsOf(t, got)
	// Level 3 keeps its place with no characters of its own.
	if len(names) != 3 || chars["1"] != "你好" || chars["2"] != "人" || chars["3"] != "" {
		t.Errorf("levels %v chars = %v, want 1: 你好, 2: 人, 3: empty", names, chars)
	}
}

func TestSchemeCharactersCharacterUnit(t *testing.T) {
	lang.Register(lang.Zh{})
	sqlDB := newDB(t)
	ctx := context.Background()
	importCedict(t, sqlDB, lineHao, lineNi, lineRen, lineNihao)
	if _, err := levels.Import(ctx, sqlDB, buildPack(t, "chars",
		`{"unit":"hanzi","levels":[{"name":"A","entries":["好","你"]},{"name":"B","entries":["人","好"]}]}`)); err != nil {
		t.Fatalf("import scheme: %v", err)
	}
	schemes, err := levels.List(ctx, sqlDB)
	if err != nil || len(schemes) != 1 {
		t.Fatalf("levels.List = %v (err %v), want one scheme", schemes, err)
	}
	got, err := levels.SchemeCharacters(ctx, sqlDB, schemes[0].ID)
	if err != nil {
		t.Fatalf("SchemeCharacters: %v", err)
	}
	if _, chars := charsOf(t, got); chars["A"] != "好你" || chars["B"] != "人" {
		t.Errorf("chars = %v, want A: 好你, B: 人", chars)
	}
}

func TestSchemeCharactersSkipsDeletedRows(t *testing.T) {
	lang.Register(lang.Zh{})
	sqlDB := newDB(t)
	ctx := context.Background()
	fe := seedFixture(t, sqlDB)
	pack, err := dict.LoadPack(hskMini)
	if err != nil {
		t.Fatalf("load fixture pack: %v", err)
	}
	if _, err := levels.Import(ctx, sqlDB, pack); err != nil {
		t.Fatalf("import fixture scheme: %v", err)
	}
	schemes, err := levels.List(ctx, sqlDB)
	if err != nil || len(schemes) != 1 {
		t.Fatalf("levels.List = %v (err %v), want one scheme", schemes, err)
	}
	id := schemes[0].ID
	before, err := levels.SchemeVersion(ctx, sqlDB, id)
	if err != nil {
		t.Fatalf("SchemeVersion: %v", err)
	}

	// A re-import that drops 银行 tombstones it and its derived 银 and
	// 行; level 2 stays, empty.
	if _, err := levels.Import(ctx, sqlDB, buildPack(t, "hsk-mini",
		`{"unit":"word","levels":[{"name":"1","entries":["你好","谢谢"]},{"name":"2","entries":[]}]}`)); err != nil {
		t.Fatalf("re-import: %v", err)
	}
	got, err := levels.SchemeCharacters(ctx, sqlDB, id)
	if err != nil {
		t.Fatalf("SchemeCharacters: %v", err)
	}
	if _, chars := charsOf(t, got); chars["1"] != "你好谢" || chars["2"] != "" {
		t.Errorf("after re-import chars = %v, want 1: 你好谢, 2: empty", chars)
	}
	after, err := levels.SchemeVersion(ctx, sqlDB, id)
	if err != nil {
		t.Fatalf("SchemeVersion: %v", err)
	}
	if after == before {
		t.Errorf("version %q unchanged by a re-import that dropped members", after)
	}

	// A soft-deleted entry is no member either: 谢谢 and its derived 谢
	// go, 你好 stays.
	for _, e := range []int64{fe.xiexie, fe.chars["谢"]} {
		if _, err := sqlDB.Exec(`UPDATE entries SET deleted_at = '2099-01-01T00:00:00Z' WHERE id = ?`, e); err != nil {
			t.Fatal(err)
		}
	}
	got, err = levels.SchemeCharacters(ctx, sqlDB, id)
	if err != nil {
		t.Fatalf("SchemeCharacters: %v", err)
	}
	if _, chars := charsOf(t, got); chars["1"] != "你好" {
		t.Errorf("after deleting 谢谢 chars = %v, want 1: 你好", chars)
	}

	// An uninstalled scheme and an unknown one are ErrNotFound.
	if err := levels.Uninstall(ctx, sqlDB, id); err != nil {
		t.Fatalf("uninstall: %v", err)
	}
	for _, bad := range []int64{id, 999999} {
		if _, err := levels.SchemeCharacters(ctx, sqlDB, bad); !errors.Is(err, levels.ErrNotFound) {
			t.Errorf("SchemeCharacters(%d) err = %v, want ErrNotFound", bad, err)
		}
		if _, err := levels.SchemeVersion(ctx, sqlDB, bad); !errors.Is(err, levels.ErrNotFound) {
			t.Errorf("SchemeVersion(%d) err = %v, want ErrNotFound", bad, err)
		}
	}
}

func TestSchemeVersionStableOnNoopReimport(t *testing.T) {
	lang.Register(lang.Zh{})
	sqlDB := newDB(t)
	ctx := context.Background()
	seedFixture(t, sqlDB)
	pack, err := dict.LoadPack(hskMini)
	if err != nil {
		t.Fatalf("load fixture pack: %v", err)
	}
	if _, err := levels.Import(ctx, sqlDB, pack); err != nil {
		t.Fatalf("import fixture scheme: %v", err)
	}
	schemes, err := levels.List(ctx, sqlDB)
	if err != nil || len(schemes) != 1 {
		t.Fatalf("levels.List = %v (err %v), want one scheme", schemes, err)
	}
	backdate(t, sqlDB)
	v1, err := levels.SchemeVersion(ctx, sqlDB, schemes[0].ID)
	if err != nil {
		t.Fatalf("SchemeVersion: %v", err)
	}
	if v1 == "" {
		t.Fatal("SchemeVersion is empty")
	}
	// An identical re-import re-stamps the scheme row but no level or
	// member: the characters, and so the version, stay the same.
	if _, err := levels.Import(ctx, sqlDB, pack); err != nil {
		t.Fatalf("re-import fixture scheme: %v", err)
	}
	if v2, err := levels.SchemeVersion(ctx, sqlDB, schemes[0].ID); err != nil || v2 != v1 {
		t.Errorf("SchemeVersion after an identical re-import = %q (err %v), want %q", v2, err, v1)
	}
}
