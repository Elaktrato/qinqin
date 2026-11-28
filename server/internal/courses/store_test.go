package courses_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/courses"
	"qinqin/internal/dbtest"
	"qinqin/internal/pack"
)

const samples = "../../../plugins/samples"

func loadSample(t *testing.T, name string) pack.Pack {
	t.Helper()
	p, err := pack.LoadPack(filepath.Join(samples, name))
	if err != nil {
		t.Fatal(err)
	}
	return p
}

// The fixture courses import, list with their titles, uninstall, and a second uninstall is not found.
func TestImportListUninstall(t *testing.T) {
	ctx := context.Background()
	sqlDB := dbtest.Open(t)
	for _, name := range []string{"zh-course-mini", "ja-course-mini"} {
		r, err := courses.Import(ctx, sqlDB, loadSample(t, name))
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if r.Sections < 2 || r.Units < 2 {
			t.Fatalf("%s: %+v", name, r)
		}
	}
	all, err := courses.List(ctx, sqlDB, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 2 || all[0].ID != "ja-course-mini" || all[1].ID != "zh-course-mini" || all[1].Title["en"] != "Chinese mini course (sample)" {
		t.Fatalf("List = %+v", all)
	}
	zh, err := courses.List(ctx, sqlDB, "zh")
	if err != nil || len(zh) != 1 || zh[0].Language != "zh" || zh[0].License != "CC-BY-4.0" {
		t.Fatalf("List(zh) = %+v, %v", zh, err)
	}
	if err := courses.Uninstall(ctx, sqlDB, "zh-course-mini"); err != nil {
		t.Fatal(err)
	}
	if err := courses.Uninstall(ctx, sqlDB, "zh-course-mini"); !errors.Is(err, pack.ErrNotFound) || !errors.Is(err, courses.ErrNotFound) {
		t.Fatalf("second uninstall: %v", err)
	}
	if zh, _ := courses.List(ctx, sqlDB, "zh"); len(zh) != 0 {
		t.Fatalf("after uninstall: %+v", zh)
	}
}

// A course.json of another language than the manifest's, or a refused course.json, is an invalid pack.
func TestImportRefusesABadPack(t *testing.T) {
	ctx := context.Background()
	sqlDB := dbtest.Open(t)
	for name, edit := range map[string]func(string) string{
		"language": func(s string) string { return strings.Replace(s, `"language": "zh"`, `"language": "ja"`, 1) },
		"words":    func(s string) string { return strings.Replace(s, `"topics": ["greetings"]`, `"words": ["你好"]`, 1) },
	} {
		dir := t.TempDir()
		if err := os.CopyFS(dir, os.DirFS(filepath.Join(samples, "zh-course-mini"))); err != nil {
			t.Fatal(err)
		}
		raw, _ := os.ReadFile(filepath.Join(dir, "course.json"))
		if err := os.WriteFile(filepath.Join(dir, "course.json"), []byte(edit(string(raw))), 0o644); err != nil {
			t.Fatal(err)
		}
		p, err := pack.LoadPack(dir)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := courses.Import(ctx, sqlDB, p); !errors.Is(err, pack.ErrInvalidPack) {
			t.Errorf("%s: %v, want an invalid pack", name, err)
		}
	}
}
