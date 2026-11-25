package components_test

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"qinqin/internal/components"
	"qinqin/internal/dbtest"
	"qinqin/internal/pack"
)

// writePack writes a components pack directory and loads it.
func writePack(t *testing.T, id, language, format string, files map[string]string) pack.Pack {
	t.Helper()
	dir := t.TempDir()
	m, _ := json.Marshal(map[string]string{
		"id": id, "name": "Components " + id, "version": "1", "type": "components", "language": language,
		"license": "CC BY-SA 3.0", "attribution": "Test fixture", "format": format, "notice": "Derived.",
	})
	files["manifest.json"] = string(m)
	for n, body := range files {
		if err := os.WriteFile(filepath.Join(dir, n), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	p, err := pack.LoadPack(dir)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

// contractFixture is docs/contracts/radicals/components-response.json.
type contractFixture struct {
	Pack       map[string]string `json:"pack"`
	Components struct {
		Language string              `json:"language"`
		Parts    []components.Part   `json:"parts"`
		Chars    map[string][]string `json:"chars"`
	} `json:"components"`
}

func loadContract(t *testing.T) contractFixture {
	t.Helper()
	raw, err := os.ReadFile("../../../docs/contracts/radicals/components-response.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx contractFixture
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	return fx
}

func TestImportAndIndexMatchContract(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	fx := loadContract(t)
	files := map[string]string{}
	for k, v := range fx.Pack {
		files[k] = v
	}
	r, err := components.Import(ctx, sqlDB, writePack(t, "ja-comp", "ja", "components-tsv", files))
	if err != nil {
		t.Fatal(err)
	}
	if r.Chars != 3 || r.Parts != 8 {
		t.Errorf("result = %+v, want 3 chars, 8 parts", r)
	}
	idx, err := components.Index(ctx, sqlDB, "ja")
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(idx.Parts, fx.Components.Parts) {
		t.Errorf("parts =\n%v\nwant\n%v", idx.Parts, fx.Components.Parts)
	}
	if !reflect.DeepEqual(idx.Chars, fx.Components.Chars) {
		t.Errorf("chars =\n%v\nwant\n%v", idx.Chars, fx.Components.Chars)
	}
	// Another language sees nothing; Parts and Chars are never nil.
	zh, err := components.Index(ctx, sqlDB, "zh")
	if err != nil || zh.Parts == nil || zh.Chars == nil || len(zh.Parts) != 0 || len(zh.Chars) != 0 {
		t.Errorf("zh index = %+v, %v", zh, err)
	}
}

func TestReimportReplacesRows(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	if _, err := components.Import(ctx, sqlDB, writePack(t, "p", "ja", "components-tsv", map[string]string{
		"components.tsv": "語\t言 口\n話\t言 舌\n", "parts.tsv": "舌\t6\n"})); err != nil {
		t.Fatal(err)
	}
	v1, _ := components.Version(ctx, sqlDB, "ja")
	if _, err := components.Import(ctx, sqlDB, writePack(t, "p", "ja", "components-tsv", map[string]string{
		"components.tsv": "語\t言 吾\n"})); err != nil {
		t.Fatal(err)
	}
	v2, _ := components.Version(ctx, sqlDB, "ja")
	if v1 == v2 {
		t.Errorf("version unchanged after a re-import with other rows: %q", v1)
	}
	idx, _ := components.Index(ctx, sqlDB, "ja")
	if want := map[string][]string{"語": {"言", "吾"}}; !reflect.DeepEqual(idx.Chars, want) {
		t.Errorf("chars after re-import = %v, want %v", idx.Chars, want)
	}
	var n int
	sqlDB.QueryRow(`SELECT COUNT(*) FROM component_parts`).Scan(&n)
	if n != 0 {
		t.Errorf("component_parts rows after re-import without parts.tsv = %d", n)
	}
}

func TestIndexUnionOverPacks(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	for _, p := range []pack.Pack{
		writePack(t, "b", "ja", "components-tsv", map[string]string{"components.tsv": "語\t言 口\n海\t氵 毎\n", "parts.tsv": "言\t7\n"}),
		writePack(t, "a", "ja", "components-tsv", map[string]string{"components.tsv": "語\t言 吾\n河\t氵 可\n", "parts.tsv": "氵\t3\n言\t6\n"}),
		writePack(t, "z", "zh", "components-tsv", map[string]string{"components.tsv": "语\t讠 吾\n"}),
	} {
		if _, err := components.Import(ctx, sqlDB, p); err != nil {
			t.Fatal(err)
		}
	}
	idx, err := components.Index(ctx, sqlDB, "ja")
	if err != nil {
		t.Fatal(err)
	}
	// 語 keeps pack a's parts (first by pack id); strokes are the max.
	want := map[string][]string{"語": {"言", "吾"}, "河": {"氵", "可"}, "海": {"氵", "毎"}}
	if !reflect.DeepEqual(idx.Chars, want) {
		t.Errorf("chars = %v, want %v", idx.Chars, want)
	}
	wantParts := []components.Part{{C: "氵", S: 3, N: 2}, {C: "言", S: 7, N: 1}, {C: "可", N: 1}, {C: "吾", N: 1}, {C: "毎", N: 1}}
	if !reflect.DeepEqual(idx.Parts, wantParts) {
		t.Errorf("parts = %v, want %v", idx.Parts, wantParts)
	}

	// An uninstalled pack is excluded, its rows gone, and the version moves.
	before, _ := components.Version(ctx, sqlDB, "ja")
	if err := components.Uninstall(ctx, sqlDB, "a"); err != nil {
		t.Fatal(err)
	}
	if err := components.Uninstall(ctx, sqlDB, "a"); !errors.Is(err, components.ErrNotFound) {
		t.Errorf("second uninstall = %v, want ErrNotFound", err)
	}
	after, _ := components.Version(ctx, sqlDB, "ja")
	if before == after {
		t.Errorf("version unchanged after uninstall")
	}
	idx, _ = components.Index(ctx, sqlDB, "ja")
	if want := map[string][]string{"語": {"言", "口"}, "海": {"氵", "毎"}}; !reflect.DeepEqual(idx.Chars, want) {
		t.Errorf("chars after uninstall = %v", idx.Chars)
	}
	var rows int
	sqlDB.QueryRow(`SELECT COUNT(*) FROM components WHERE pack_id = 'a'`).Scan(&rows)
	if rows != 0 {
		t.Errorf("rows of the uninstalled pack = %d", rows)
	}
	list, err := components.List(ctx, sqlDB)
	if err != nil || len(list) != 2 || list[0].PackID != "b" || list[1].PackID != "z" {
		t.Fatalf("list = %+v, %v", list, err)
	}
	if p := list[0]; p.Name != "Components b" || p.Version != "1" || p.Language != "ja" || p.License != "CC BY-SA 3.0" ||
		p.Attribution != "Test fixture" || p.Notice != "Derived." || p.UpdatedAt == "" {
		t.Errorf("pack info = %+v", p)
	}
	// A reinstall brings it back.
	if _, err := components.Import(ctx, sqlDB, writePack(t, "a", "ja", "components-tsv", map[string]string{"components.tsv": "語\t言 吾\n"})); err != nil {
		t.Fatal(err)
	}
	if list, _ := components.List(ctx, sqlDB); len(list) != 3 {
		t.Errorf("list after reinstall = %+v", list)
	}
}

func TestImportRejects(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	for name, p := range map[string]pack.Pack{
		"wrong format":     writePack(t, "p", "ja", "freq-csv", map[string]string{"components.tsv": "語\t言\n"}),
		"no file":          writePack(t, "p", "ja", "components-tsv", map[string]string{}),
		"malformed line":   writePack(t, "p", "ja", "components-tsv", map[string]string{"components.tsv": "語\t言\nx\t口\n"}),
		"malformed parts":  writePack(t, "p", "ja", "components-tsv", map[string]string{"components.tsv": "語\t言\n", "parts.tsv": "言\t0\n"}),
		"oversized parts ": writePack(t, "p", "ja", "components-tsv", map[string]string{"components.tsv": "語\t言\n", "parts.tsv": strings.Repeat("#", 9<<20)}),
	} {
		if _, err := components.Import(ctx, sqlDB, p); !errors.Is(err, pack.ErrInvalidPack) {
			t.Errorf("%s: err = %v, want ErrInvalidPack", name, err)
		}
	}
	freqPack := writePack(t, "f", "ja", "components-tsv", map[string]string{"components.tsv": "語\t言\n"})
	freqPack.Type = pack.TypeFrequency
	if _, err := components.Import(ctx, sqlDB, freqPack); !errors.Is(err, pack.ErrInvalidPack) {
		t.Errorf("wrong type: err = %v", err)
	}
	var n int
	sqlDB.QueryRow(`SELECT COUNT(*) FROM component_packs`).Scan(&n)
	if n != 0 {
		t.Errorf("a rejected pack left %d rows", n)
	}
}

// A pack's language is stored as its primary subtag: the lookup asks for
// zh, ja (GET /api/components takes the primary subtag).
func TestImportNormalisesLanguageToPrimarySubtag(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	if _, err := components.Import(ctx, sqlDB, writePack(t, "tw", "zh-tw", "components-tsv", map[string]string{"components.tsv": "語\t言 吾\n"})); err != nil {
		t.Fatal(err)
	}
	idx, err := components.Index(ctx, sqlDB, "zh")
	if err != nil || len(idx.Chars) != 1 {
		t.Fatalf("zh index = %+v, %v", idx, err)
	}
	if v, _ := components.Version(ctx, sqlDB, "zh"); v == components.NoPacks {
		t.Errorf("zh version = NoPacks")
	}
	list, _ := components.List(ctx, sqlDB)
	if len(list) != 1 || list[0].Language != "zh" {
		t.Errorf("list = %+v, want language zh", list)
	}
}
