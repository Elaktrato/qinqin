package packs_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/pack"
	"qinqin/internal/packs"
)

const oneTheme = `[{"id":"test-dark","name":"Test dark","scheme":"dark",
 "colors":{"chrome":"#11111b","panel":"#1e1e2e","raised":"#313244","line":"#45475a","text":"#cdd6f4","muted":"#a6adc8",
  "good":"#a6e3a1","warn":"#f9e2af","bad":"#f38ba8","gradeAgain":"#f38ba8","gradeHard":"#fab387","gradeGood":"#a6e3a1","gradeEasy":"#89b4fa"},
 "accents":{"mauve":"#cba6f7"},"defaultAccent":"mauve"}]`

func themePack(t *testing.T) pack.Pack {
	t.Helper()
	dir := t.TempDir()
	for name, body := range map[string]string{
		"manifest.json": `{"id":"test-themes","name":"Test themes","version":"1.0","type":"theme","license":"MIT",
			"attribution":"Qinqin test fixtures","format":"themes-json"}`,
		"themes.json": oneTheme,
		"LICENSE":     "MIT (test stand-in)\n",
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	p, err := pack.LoadPack(dir)
	if err != nil {
		t.Fatalf("LoadPack: %v", err)
	}
	return p
}

func TestThemePacks(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	importAll(t, sqlDB)
	var changed []string
	got, err := packs.Import(ctx, sqlDB, themePack(t), packs.WithOnChange(func(typ, id, lang string) { changed = append(changed, typ+"/"+id+"/"+lang) }))
	if err != nil || got != "1 themes" {
		t.Fatalf("Import = %q, %v", got, err)
	}
	if len(changed) != 1 || changed[0] != "theme/test-themes/" {
		t.Errorf("onChange = %v", changed)
	}
	if !packs.Supported("theme") || !packs.Installable("theme") {
		t.Errorf("theme must be supported and installable (admin upload)")
	}
	list, _ := packs.List(ctx, sqlDB)
	last := list[len(list)-1]
	if last.Type != "theme" || last.PackID != "test-themes" || last.License != "MIT" || last.Version != "1.0" ||
		last.UpdatedAt == "" || last.Language != "" || last.Languages != nil {
		t.Fatalf("theme row (listed last) = %+v", last)
	}
	if _, err := packs.Find(ctx, sqlDB, "theme", "test-themes"); err != nil {
		t.Errorf("Find = %v", err)
	}
	texts, err := packs.Texts(ctx, sqlDB, "theme", "test-themes")
	if err != nil || len(texts) != 1 || texts[0].Name != "LICENSE" {
		t.Errorf("Texts = %+v, %v", texts, err)
	}
	if err := packs.Uninstall(ctx, sqlDB, "theme", "test-themes"); err != nil {
		t.Fatal(err)
	}
	if err := packs.Uninstall(ctx, sqlDB, "theme", "test-themes"); !errors.Is(err, packs.ErrNotFound) {
		t.Errorf("second uninstall = %v", err)
	}
	if texts, _ := packs.Texts(ctx, sqlDB, "theme", "test-themes"); len(texts) != 0 {
		t.Errorf("texts after uninstall = %+v", texts)
	}
}
