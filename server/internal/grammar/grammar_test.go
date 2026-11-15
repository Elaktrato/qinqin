package grammar_test

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/db"
	"qinqin/internal/dict"
	"qinqin/internal/grammar"
)

func newDB(t *testing.T) *sql.DB {
	t.Helper()
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	return sqlDB
}

func loadMini(t *testing.T) dict.Pack {
	t.Helper()
	p, err := dict.LoadPack(filepath.Join("testdata", "zh-mini"))
	if err != nil {
		t.Fatal(err)
	}
	return p
}

// packWith copies zh-mini's manifest and writes lessons into a temp pack.
func packWith(t *testing.T, manifest, lessons string) dict.Pack {
	t.Helper()
	dir := t.TempDir()
	if manifest == "" {
		b, err := os.ReadFile(filepath.Join("testdata", "zh-mini", "manifest.json"))
		if err != nil {
			t.Fatal(err)
		}
		manifest = string(b)
	}
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), []byte(manifest), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "lessons.json"), []byte(lessons), 0o644); err != nil {
		t.Fatal(err)
	}
	p, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func miniLessons(t *testing.T) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", "zh-mini", "lessons.json"))
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

const longAgo = "2020-01-01T00:00:00Z"

func TestImportAndList(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)
	res, err := grammar.Import(ctx, sqlDB, loadMini(t))
	if err != nil {
		t.Fatal(err)
	}
	if res.Lessons != 3 {
		t.Errorf("Lessons = %d, want 3", res.Lessons)
	}
	packs, err := grammar.ListPacks(ctx, sqlDB, "zh")
	if err != nil {
		t.Fatal(err)
	}
	if len(packs) != 1 {
		t.Fatalf("packs = %d, want 1", len(packs))
	}
	p := packs[0]
	if p.PackID != "zh-grammar-mini" || p.Name != "Chinese grammar mini" || p.Version != "1.0" || p.Language != "zh" ||
		p.License != "CC0-1.0" || p.Notice != "Test pack." || p.Attribution == "" {
		t.Errorf("pack = %+v", p)
	}
	if len(p.Levels) != 2 || p.Levels[0].ID != "a1-1" || p.Levels[0].SchemeLevels[0].Level != "HSK 1" {
		t.Errorf("levels = %+v", p.Levels)
	}
	var ids []string
	for _, l := range p.Lessons {
		ids = append(ids, l.ID)
	}
	if strings.Join(ids, ",") != "shi,bu,ge" {
		t.Errorf("lesson order = %v", ids)
	}
	if p.Lessons[0].Examples != 2 || p.Lessons[0].Level != "a1-1" || p.Lessons[2].Level != "a1-2" || p.Lessons[0].Title != "是: A is B" {
		t.Errorf("summaries = %+v", p.Lessons)
	}

	all, err := grammar.ListPacks(ctx, sqlDB, "")
	if err != nil || len(all) != 1 {
		t.Errorf("all packs = %v, %v", all, err)
	}
	ja, err := grammar.ListPacks(ctx, sqlDB, "ja")
	if err != nil || len(ja) != 0 || ja == nil {
		t.Errorf("ja packs = %#v, %v; want empty non-nil", ja, err)
	}
}

func TestLessonByID(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)
	if _, err := grammar.Import(ctx, sqlDB, loadMini(t)); err != nil {
		t.Fatal(err)
	}
	v, err := grammar.LessonByID(ctx, sqlDB, "zh-grammar-mini", "bu")
	if err != nil {
		t.Fatal(err)
	}
	if v.Lesson.Title != "不: not" || len(v.Lesson.Examples) != 1 || v.Lesson.Examples[0].Focus != "不" {
		t.Errorf("lesson = %+v", v.Lesson)
	}
	if v.Prev != "shi" || v.Next != "ge" {
		t.Errorf("prev/next = %q/%q, want shi/ge", v.Prev, v.Next)
	}
	if v.Pack.PackID != "zh-grammar-mini" || v.Pack.License != "CC0-1.0" || len(v.Pack.Lessons) != 0 {
		t.Errorf("pack = %+v", v.Pack)
	}
	first, _ := grammar.LessonByID(ctx, sqlDB, "zh-grammar-mini", "shi")
	last, _ := grammar.LessonByID(ctx, sqlDB, "zh-grammar-mini", "ge")
	if first.Prev != "" || first.Next != "bu" || last.Prev != "bu" || last.Next != "" {
		t.Errorf("ends: first %q/%q last %q/%q", first.Prev, first.Next, last.Prev, last.Next)
	}
	if _, err := grammar.LessonByID(ctx, sqlDB, "zh-grammar-mini", "nope"); !errors.Is(err, grammar.ErrNotFound) {
		t.Errorf("unknown lesson err = %v", err)
	}
	if _, err := grammar.LessonByID(ctx, sqlDB, "nope", "shi"); !errors.Is(err, grammar.ErrNotFound) {
		t.Errorf("unknown pack err = %v", err)
	}
}

func TestReimportIdenticalWritesNothing(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)
	if _, err := grammar.Import(ctx, sqlDB, loadMini(t)); err != nil {
		t.Fatal(err)
	}
	if _, err := sqlDB.Exec(`UPDATE grammar_packs SET updated_at = ?`, longAgo); err != nil {
		t.Fatal(err)
	}
	if _, err := sqlDB.Exec(`UPDATE grammar_lessons SET updated_at = ?`, longAgo); err != nil {
		t.Fatal(err)
	}
	if _, err := grammar.Import(ctx, sqlDB, loadMini(t)); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := sqlDB.QueryRow(`SELECT (SELECT COUNT(*) FROM grammar_packs WHERE updated_at != ?) +
		(SELECT COUNT(*) FROM grammar_lessons WHERE updated_at != ?)`, longAgo, longAgo).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Errorf("%d rows touched by an identical re-import", n)
	}
}

func TestReimportChangedLessonOnlyTouchesIt(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)
	if _, err := grammar.Import(ctx, sqlDB, loadMini(t)); err != nil {
		t.Fatal(err)
	}
	sqlDB.Exec(`UPDATE grammar_lessons SET updated_at = ?`, longAgo)
	changed := strings.Replace(miniLessons(t), "Negate verbs.", "Negate verbs and adjectives.", 1)
	if _, err := grammar.Import(ctx, sqlDB, packWith(t, "", changed)); err != nil {
		t.Fatal(err)
	}
	rows, err := sqlDB.Query(`SELECT lesson_id FROM grammar_lessons WHERE updated_at != ?`, longAgo)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var touched []string
	for rows.Next() {
		var id string
		rows.Scan(&id)
		touched = append(touched, id)
	}
	if strings.Join(touched, ",") != "bu" {
		t.Errorf("touched = %v, want [bu]", touched)
	}
	v, _ := grammar.LessonByID(ctx, sqlDB, "zh-grammar-mini", "bu")
	if v.Lesson.Summary != "Negate verbs and adjectives." {
		t.Errorf("summary = %q", v.Lesson.Summary)
	}
}

func TestReimportWithoutLessonSoftDeletesAndRevives(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)
	if _, err := grammar.Import(ctx, sqlDB, loadMini(t)); err != nil {
		t.Fatal(err)
	}
	// Drop the "bu" lesson.
	without := strings.Replace(miniLessons(t), `{"id": "bu", "level": "a1-1", "title": "不: not", "summary": "Negate verbs.",
     "body": ["不 goes before the verb."],
     "examples": [{"id": "bu-1", "text": "我不喝咖啡。", "reading": "wǒ bù hē kāfēi.", "translation": "I don't drink coffee.", "focus": "不", "distractors": ["吗", "的"]}]},
`, "", 1)
	if without == miniLessons(t) {
		t.Fatal("test bug: lesson not removed")
	}
	res, err := grammar.Import(ctx, sqlDB, packWith(t, "", without))
	if err != nil {
		t.Fatal(err)
	}
	if res.Lessons != 2 {
		t.Errorf("Lessons = %d, want 2", res.Lessons)
	}
	if _, err := grammar.LessonByID(ctx, sqlDB, "zh-grammar-mini", "bu"); !errors.Is(err, grammar.ErrNotFound) {
		t.Errorf("removed lesson err = %v, want ErrNotFound", err)
	}
	packs, _ := grammar.ListPacks(ctx, sqlDB, "zh")
	if len(packs[0].Lessons) != 2 {
		t.Errorf("listed lessons = %d, want 2", len(packs[0].Lessons))
	}
	// Back in: revived, not duplicated.
	if _, err := grammar.Import(ctx, sqlDB, loadMini(t)); err != nil {
		t.Fatal(err)
	}
	if _, err := grammar.LessonByID(ctx, sqlDB, "zh-grammar-mini", "bu"); err != nil {
		t.Errorf("revived lesson: %v", err)
	}
	var rows int
	sqlDB.QueryRow(`SELECT COUNT(*) FROM grammar_lessons`).Scan(&rows)
	if rows != 3 {
		t.Errorf("rows = %d, want 3", rows)
	}
}

func TestReimportRevivesDeletedPack(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)
	if _, err := grammar.Import(ctx, sqlDB, loadMini(t)); err != nil {
		t.Fatal(err)
	}
	sqlDB.Exec(`UPDATE grammar_lessons SET deleted_at = ?`, longAgo)
	sqlDB.Exec(`UPDATE grammar_packs SET deleted_at = ?`, longAgo)
	if packs, _ := grammar.ListPacks(ctx, sqlDB, ""); len(packs) != 0 {
		t.Fatalf("deleted pack listed: %v", packs)
	}
	if _, err := grammar.Import(ctx, sqlDB, loadMini(t)); err != nil {
		t.Fatal(err)
	}
	packs, _ := grammar.ListPacks(ctx, sqlDB, "zh")
	if len(packs) != 1 || len(packs[0].Lessons) != 3 {
		t.Errorf("after revive: %+v", packs)
	}
}

func TestImportRejectsWrongType(t *testing.T) {
	ctx := context.Background()
	m := `{"id":"x","name":"X","version":"1","type":"sentences","language":"zh","license":"CC0-1.0","attribution":"a","format":"json"}`
	_, err := grammar.Import(ctx, newDB(t), packWith(t, m, miniLessons(t)))
	if !errors.Is(err, grammar.ErrNotGrammar) {
		t.Errorf("err = %v, want ErrNotGrammar", err)
	}
}

func TestImportRejectsInvalidAndStaysAtomic(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)
	if _, err := grammar.Import(ctx, sqlDB, loadMini(t)); err != nil {
		t.Fatal(err)
	}
	bad := strings.Replace(miniLessons(t), `"focus": "不"`, `"focus": "呢"`, 1)
	_, err := grammar.Import(ctx, sqlDB, packWith(t, "", bad))
	if !errors.Is(err, dict.ErrInvalidPack) {
		t.Fatalf("err = %v, want ErrInvalidPack", err)
	}
	packs, _ := grammar.ListPacks(ctx, sqlDB, "zh")
	if len(packs) != 1 || len(packs[0].Lessons) != 3 {
		t.Errorf("first import disturbed: %+v", packs)
	}
	v, _ := grammar.LessonByID(ctx, sqlDB, "zh-grammar-mini", "bu")
	if v.Lesson.Examples[0].Focus != "不" {
		t.Errorf("lesson changed: %+v", v.Lesson)
	}
}

func TestImportRejectsNonJSONFormat(t *testing.T) {
	m := `{"id":"x","name":"X","version":"1","type":"grammar","language":"zh","license":"CC0-1.0","attribution":"a","format":"cedict"}`
	_, err := grammar.Import(context.Background(), newDB(t), packWith(t, m, miniLessons(t)))
	if !errors.Is(err, dict.ErrInvalidPack) {
		t.Errorf("err = %v, want ErrInvalidPack", err)
	}
}

func TestUninstallThenReinstall(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)
	if _, err := grammar.Import(ctx, sqlDB, loadMini(t)); err != nil {
		t.Fatal(err)
	}
	if err := grammar.Uninstall(ctx, sqlDB, "zh-grammar-mini"); err != nil {
		t.Fatal(err)
	}
	if got, _ := grammar.ListPacks(ctx, sqlDB, ""); len(got) != 0 {
		t.Errorf("uninstalled pack listed: %+v", got)
	}
	if _, err := grammar.LessonByID(ctx, sqlDB, "zh-grammar-mini", "shi"); !errors.Is(err, grammar.ErrNotFound) {
		t.Errorf("lesson of uninstalled pack err = %v", err)
	}
	if err := grammar.Uninstall(ctx, sqlDB, "zh-grammar-mini"); !errors.Is(err, grammar.ErrNotFound) {
		t.Errorf("second Uninstall err = %v, want ErrNotFound", err)
	}
	if _, err := grammar.Import(ctx, sqlDB, loadMini(t)); err != nil {
		t.Fatal(err)
	}
	got, _ := grammar.ListPacks(ctx, sqlDB, "zh")
	if len(got) != 1 || len(got[0].Lessons) != 3 {
		t.Errorf("after reinstall: %+v", got)
	}
}
