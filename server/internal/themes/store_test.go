package themes

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/pack"
)

// testTheme is a valid theme with the given id.
func testTheme(id string) map[string]any {
	return map[string]any{"id": id, "name": strings.ToUpper(id[:1]) + id[1:], "scheme": "dark",
		"colors": map[string]string{"chrome": "#11111b", "panel": "#1e1e2e", "raised": "#313244", "line": "#45475a",
			"text": "#cdd6f4", "muted": "#a6adc8", "good": "#a6e3a1", "warn": "#f9e2af", "bad": "#f38ba8",
			"gradeAgain": "#f38ba8", "gradeHard": "#fab387", "gradeGood": "#a6e3a1", "gradeEasy": "#89b4fa"},
		"accents": map[string]string{"mauve": "#cba6f7"}, "defaultAccent": "mauve"}
}

// themePack writes a theme pack directory and loads it.
func themePack(t *testing.T, id, version string, themes any) pack.Pack {
	t.Helper()
	dir := t.TempDir()
	m, _ := json.Marshal(map[string]string{"id": id, "name": "Pack " + id, "version": version, "type": "theme",
		"license": "MIT", "attribution": "Test palette authors", "format": "themes-json"})
	body, ok := themes.([]byte)
	if !ok {
		body, _ = json.Marshal(themes)
	}
	for name, b := range map[string][]byte{"manifest.json": m, "themes.json": body, "LICENSE": []byte("MIT test\n")} {
		if err := os.WriteFile(filepath.Join(dir, name), b, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	p, err := pack.LoadPack(dir)
	if err != nil {
		t.Fatalf("LoadPack: %v", err)
	}
	return p
}

func storedIDs(t *testing.T, sqlDB *sql.DB) string {
	t.Helper()
	list, err := Installed(context.Background(), sqlDB)
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for _, it := range list {
		ids = append(ids, it.PackID+"/"+it.Theme.ID)
	}
	return strings.Join(ids, ",")
}

func TestImportListUninstall(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	r, err := Import(ctx, sqlDB, themePack(t, "night", "1", []any{testTheme("night-a"), testTheme("night-b")}))
	if err != nil || r.Themes != 2 {
		t.Fatalf("Import = %+v, %v", r, err)
	}
	if got := storedIDs(t, sqlDB); got != "night/night-a,night/night-b" {
		t.Fatalf("installed %s", got)
	}
	packs, err := Packs(ctx, sqlDB)
	if err != nil || len(packs) != 1 || packs[0].PackID != "night" || packs[0].License != "MIT" ||
		packs[0].Attribution != "Test palette authors" || packs[0].Version != "1" || packs[0].UpdatedAt == "" ||
		strings.Join(packs[0].Themes, ",") != "night-a,night-b" {
		t.Fatalf("Packs = %+v, %v", packs, err)
	}

	// An identical re-import writes nothing.
	var stamp string
	sqlDB.QueryRow(`SELECT updated_at FROM theme_packs WHERE pack_id = 'night'`).Scan(&stamp)
	sqlDB.Exec(`UPDATE theme_packs SET updated_at = 'kept' WHERE pack_id = 'night'`)
	if _, err := Import(ctx, sqlDB, themePack(t, "night", "1", []any{testTheme("night-a"), testTheme("night-b")})); err != nil {
		t.Fatal(err)
	}
	sqlDB.QueryRow(`SELECT updated_at FROM theme_packs WHERE pack_id = 'night'`).Scan(&stamp)
	if stamp != "kept" {
		t.Errorf("identical re-import rewrote the pack row (updated_at %q)", stamp)
	}

	// An upgrade replaces the pack's themes: dropped ones go, order follows the file.
	if _, err := Import(ctx, sqlDB, themePack(t, "night", "2", []any{testTheme("night-c"), testTheme("night-a")})); err != nil {
		t.Fatal(err)
	}
	if got := storedIDs(t, sqlDB); got != "night/night-c,night/night-a" {
		t.Fatalf("after upgrade %s", got)
	}

	// Another pack may not take a theme id that is installed.
	_, err = Import(ctx, sqlDB, themePack(t, "other", "1", []any{testTheme("night-a")}))
	if !errors.Is(err, pack.ErrInvalidPack) || !strings.Contains(err.Error(), "night-a") || !strings.Contains(err.Error(), "night") {
		t.Fatalf("clash = %v", err)
	}

	if err := Uninstall(ctx, sqlDB, "night"); err != nil {
		t.Fatal(err)
	}
	if err := Uninstall(ctx, sqlDB, "night"); !errors.Is(err, ErrNotFound) {
		t.Errorf("second uninstall = %v", err)
	}
	if got := storedIDs(t, sqlDB); got != "" {
		t.Errorf("after uninstall %s", got)
	}
	if packs, _ := Packs(ctx, sqlDB); len(packs) != 0 {
		t.Errorf("packs after uninstall %+v", packs)
	}
	// After the uninstall the id is free again, and a reinstall revives the pack row.
	if _, err := Import(ctx, sqlDB, themePack(t, "other", "1", []any{testTheme("night-a")})); err != nil {
		t.Fatal(err)
	}
	if _, err := Import(ctx, sqlDB, themePack(t, "night", "3", []any{testTheme("night-z")})); err != nil {
		t.Fatal(err)
	}
	if got := storedIDs(t, sqlDB); got != "night/night-z,other/night-a" {
		t.Errorf("reinstalled %s", got)
	}
}

func TestImportRefusesInvalidFilesAndBuiltinIDs(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	bad := testTheme("x")
	bad["colors"].(map[string]string)["panel"] = "#FFFFFF"
	_, err := Import(ctx, sqlDB, themePack(t, "p", "1", []any{bad}))
	if !errors.Is(err, pack.ErrInvalidPack) || !strings.Contains(err.Error(), "themes.json: bad-colour at $[0].colors.panel") {
		t.Fatalf("invalid file = %v", err)
	}
	_, err = Import(ctx, sqlDB, themePack(t, "p", "1", append([]byte(`[`), make([]byte, MaxFileBytes)...)))
	if !errors.Is(err, pack.ErrInvalidPack) || !strings.Contains(err.Error(), "too-large") {
		t.Fatalf("large file = %v", err)
	}

	defer func(saved func() []BuiltinPack) { builtinSource = saved }(builtinSource)
	th, _ := ParseTheme(mustJSON(testTheme("house-dark")))
	builtinSource = func() []BuiltinPack {
		return []BuiltinPack{{Manifest: pack.Manifest{ID: "house", Name: "House"}, Themes: []Theme{th}}}
	}
	if _, err := Import(ctx, sqlDB, themePack(t, "house", "1", []any{testTheme("mine")})); !errors.Is(err, pack.ErrInvalidPack) ||
		!strings.Contains(err.Error(), "built-in") {
		t.Errorf("built-in pack id = %v", err)
	}
	if _, err := Import(ctx, sqlDB, themePack(t, "p", "1", []any{testTheme("house-dark")})); !errors.Is(err, pack.ErrInvalidPack) ||
		!strings.Contains(err.Error(), "built-in") {
		t.Errorf("built-in theme id = %v", err)
	}
	if got := storedIDs(t, sqlDB); got != "" {
		t.Errorf("stored %s", got)
	}
	// The wrong type or format never reaches the store.
	p := themePack(t, "p", "1", []any{testTheme("ok")})
	p.Type = pack.TypeStrokes
	if _, err := Import(ctx, sqlDB, p); !errors.Is(err, pack.ErrInvalidPack) {
		t.Errorf("strokes manifest = %v", err)
	}
}

func mustJSON(v any) []byte { b, _ := json.Marshal(v); return b }
