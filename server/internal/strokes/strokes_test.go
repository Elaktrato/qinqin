package strokes_test

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/pack"
	"qinqin/internal/strokes"
)

// Invented stroke data in the hanzi-writer-data shape (not its content).
const (
	dataHao = `{"strokes":["M 1 2 Q 3 4"],"medians":[[[1,2],[3,4]]]}`
	dataYi  = `{"strokes":["M 7 8"],"medians":[[[7,8]]]}`
	dataRad = `{"strokes":["M 5 6"],"medians":[[[5,6]]],"radStrokes":[0]}`
)

func line(char, data string) string {
	c, _ := json.Marshal(char)
	return `{"char":` + string(c) + `,"data":` + data + "}\n"
}

// writePack writes a strokes pack directory with the given jsonl body
// (gzipped) and loads it.
func writePack(t *testing.T, id, version string, languages []string, jsonl string) pack.Pack {
	t.Helper()
	dir := t.TempDir()
	m, _ := json.Marshal(map[string]any{
		"id": id, "name": "Stroke data " + id, "version": version, "type": "strokes", "languages": languages,
		"license": "Arphic Public License", "attribution": "Make Me a Hanzi via hanzi-writer-data",
		"format": "hanzi-writer-jsonl-gz",
	})
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), m, 0o644); err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	zw.Write([]byte(jsonl))
	zw.Close()
	if err := os.WriteFile(filepath.Join(dir, strokes.DataFile), buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	p, err := pack.LoadPack(dir)
	if err != nil {
		t.Fatalf("LoadPack: %v", err)
	}
	return p
}

func threeChars() string { return line("⺀", dataRad) + line("一", dataYi) + line("好", dataHao) }

func TestImportThreeCharacters(t *testing.T) {
	ctx := context.Background()
	sqlDB := dbtest.Open(t)
	r, err := strokes.Import(ctx, sqlDB, writePack(t, "hw", "2.0.1", []string{"zh", "ja"}, threeChars()))
	if err != nil {
		t.Fatalf("Import: %v", err)
	}
	if r.Chars != 3 {
		t.Errorf("Chars = %d, want 3", r.Chars)
	}
	for char, want := range map[string]string{"好": dataHao, "一": dataYi, "⺀": dataRad} {
		got, ok, err := strokes.Lookup(ctx, sqlDB, char)
		if err != nil || !ok {
			t.Fatalf("Lookup(%s) = %v, %v", char, ok, err)
		}
		if string(got) != want { // byte for byte as the npm file
			t.Errorf("Lookup(%s) = %s, want %s", char, got, want)
		}
	}
	list, err := strokes.Packs(ctx, sqlDB)
	if err != nil || len(list) != 1 {
		t.Fatalf("Packs = %v, %v", list, err)
	}
	p := list[0]
	if p.PackID != "hw" || p.Version != "2.0.1" || p.License != "Arphic Public License" || p.Ord != 1 ||
		!slices.Equal(p.Languages, []string{"ja", "zh"}) {
		t.Errorf("Packs[0] = %+v", p)
	}
}

func TestLookupMissingChar(t *testing.T) {
	ctx := context.Background()
	sqlDB := dbtest.Open(t)
	if _, ok, err := strokes.Lookup(ctx, sqlDB, "好"); ok || err != nil {
		t.Errorf("Lookup on an empty store = %v, %v; want false, nil", ok, err)
	}
	if _, err := strokes.Import(ctx, sqlDB, writePack(t, "hw", "1", []string{"zh"}, threeChars())); err != nil {
		t.Fatal(err)
	}
	if _, ok, err := strokes.Lookup(ctx, sqlDB, "妈"); ok || err != nil {
		t.Errorf("Lookup(妈) = %v, %v; want false, nil", ok, err)
	}
}

func TestMalformedLineFailsWholeImport(t *testing.T) {
	ctx := context.Background()
	for name, body := range map[string]string{
		"not json":           threeChars() + "nope\n",
		"two code points":    threeChars() + line("好好", dataHao),
		"empty char":         line("", dataHao) + threeChars(),
		"data not an object": threeChars() + line("二", `[1,2]`),
		"data missing":       threeChars() + `{"char":"二"}` + "\n",
		"duplicate char":     threeChars() + line("好", dataYi),
		"line too long":      threeChars() + line("二", `{"s":"`+strings.Repeat("x", strokes.MaxLineBytes)+`"}`),
		"unknown key":        threeChars() + `{"char":"二","data":{},"x":1}` + "\n",
		"empty pack":         "",
	} {
		t.Run(name, func(t *testing.T) {
			sqlDB := dbtest.Open(t)
			// A good pack first: a failed re-import must leave it as it was.
			if _, err := strokes.Import(ctx, sqlDB, writePack(t, "hw", "1", []string{"zh"}, line("一", dataYi))); err != nil {
				t.Fatal(err)
			}
			_, err := strokes.Import(ctx, sqlDB, writePack(t, "hw", "2", []string{"zh"}, body))
			if !errors.Is(err, pack.ErrInvalidPack) {
				t.Fatalf("Import = %v, want ErrInvalidPack", err)
			}
			var n int
			sqlDB.QueryRow(`SELECT COUNT(*) FROM strokes`).Scan(&n)
			var version string
			sqlDB.QueryRow(`SELECT version FROM stroke_packs WHERE pack_id = 'hw'`).Scan(&version)
			if n != 1 || version != "1" {
				t.Errorf("after a failed import: %d rows, version %q; want 1 row, version 1", n, version)
			}
		})
	}
}

func TestTwoPacksByOrd(t *testing.T) {
	ctx := context.Background()
	sqlDB := dbtest.Open(t)
	if _, err := strokes.Import(ctx, sqlDB, writePack(t, "first", "1", []string{"zh"}, line("好", dataHao))); err != nil {
		t.Fatal(err)
	}
	if _, err := strokes.Import(ctx, sqlDB, writePack(t, "second", "1", []string{"ja"}, line("好", dataYi)+line("一", dataYi))); err != nil {
		t.Fatal(err)
	}
	if got, _, _ := strokes.Lookup(ctx, sqlDB, "好"); string(got) != dataHao {
		t.Errorf("好 = %s, want the first pack's data", got)
	}
	if got, _, _ := strokes.Lookup(ctx, sqlDB, "一"); string(got) != dataYi {
		t.Errorf("一 = %s, want the second pack's data", got)
	}
	// A re-import of the first keeps its ord.
	if _, err := strokes.Import(ctx, sqlDB, writePack(t, "first", "2", []string{"zh"}, line("好", dataHao))); err != nil {
		t.Fatal(err)
	}
	list, _ := strokes.Packs(ctx, sqlDB)
	if len(list) != 2 || list[0].PackID != "first" || list[1].PackID != "second" {
		t.Errorf("Packs = %+v, want first then second", list)
	}
	// Uninstalling the first exposes the second's data.
	if err := strokes.Uninstall(ctx, sqlDB, "first"); err != nil {
		t.Fatal(err)
	}
	if got, ok, _ := strokes.Lookup(ctx, sqlDB, "好"); !ok || string(got) != dataYi {
		t.Errorf("after uninstall 好 = %s, %v; want the second pack's data", got, ok)
	}
}

func TestUninstall(t *testing.T) {
	ctx := context.Background()
	sqlDB := dbtest.Open(t)
	if err := strokes.Uninstall(ctx, sqlDB, "hw"); !errors.Is(err, strokes.ErrNotFound) {
		t.Errorf("Uninstall of an unknown pack = %v, want ErrNotFound", err)
	}
	if _, err := strokes.Import(ctx, sqlDB, writePack(t, "hw", "1", []string{"zh"}, threeChars())); err != nil {
		t.Fatal(err)
	}
	if err := strokes.Uninstall(ctx, sqlDB, "hw"); err != nil {
		t.Fatalf("Uninstall: %v", err)
	}
	if err := strokes.Uninstall(ctx, sqlDB, "hw"); !errors.Is(err, strokes.ErrNotFound) {
		t.Errorf("second Uninstall = %v, want ErrNotFound", err)
	}
	var n int
	sqlDB.QueryRow(`SELECT COUNT(*) FROM strokes`).Scan(&n)
	if n != 0 {
		t.Errorf("%d stroke rows left, want 0", n)
	}
	if list, _ := strokes.Packs(ctx, sqlDB); len(list) != 0 {
		t.Errorf("Packs after uninstall = %+v", list)
	}
	if _, ok, _ := strokes.Lookup(ctx, sqlDB, "好"); ok {
		t.Error("Lookup after uninstall found data")
	}
	// Reinstall keeps the ord of the first registration.
	if _, err := strokes.Import(ctx, sqlDB, writePack(t, "hw", "1", []string{"zh"}, threeChars())); err != nil {
		t.Fatal(err)
	}
	if list, _ := strokes.Packs(ctx, sqlDB); len(list) != 1 || list[0].Ord != 1 {
		t.Errorf("Packs after reinstall = %+v", list)
	}
}

func TestIdenticalReimportWritesNothing(t *testing.T) {
	ctx := context.Background()
	sqlDB := dbtest.Open(t)
	if _, err := strokes.Import(ctx, sqlDB, writePack(t, "hw", "1", []string{"zh"}, threeChars())); err != nil {
		t.Fatal(err)
	}
	if _, err := sqlDB.Exec(`UPDATE stroke_packs SET updated_at = '2000-01-01T00:00:00Z'`); err != nil {
		t.Fatal(err)
	}
	if _, err := strokes.Import(ctx, sqlDB, writePack(t, "hw", "1", []string{"zh"}, threeChars())); err != nil {
		t.Fatal(err)
	}
	var stamp string
	sqlDB.QueryRow(`SELECT updated_at FROM stroke_packs`).Scan(&stamp)
	if stamp != "2000-01-01T00:00:00Z" {
		t.Errorf("identical re-import restamped the pack: %s", stamp)
	}
	// A changed one replaces the rows.
	if _, err := strokes.Import(ctx, sqlDB, writePack(t, "hw", "1", []string{"zh"}, line("一", dataHao))); err != nil {
		t.Fatal(err)
	}
	if got, _, _ := strokes.Lookup(ctx, sqlDB, "一"); string(got) != dataHao {
		t.Errorf("一 = %s after a changed re-import", got)
	}
	if _, ok, _ := strokes.Lookup(ctx, sqlDB, "好"); ok {
		t.Error("好 survived a re-import without it")
	}
}

func TestImportRejectsOtherTypesAndFormats(t *testing.T) {
	ctx := context.Background()
	sqlDB := dbtest.Open(t)
	p := writePack(t, "hw", "1", []string{"zh"}, threeChars())
	p.Type = pack.TypeComponents
	if _, err := strokes.Import(ctx, sqlDB, p); !errors.Is(err, pack.ErrInvalidPack) {
		t.Errorf("components pack: Import = %v, want ErrInvalidPack", err)
	}
	p = writePack(t, "hw", "1", []string{"zh"}, threeChars())
	os.Remove(filepath.Join(p.Dir, strokes.DataFile))
	if _, err := strokes.Import(ctx, sqlDB, p); !errors.Is(err, pack.ErrInvalidPack) {
		t.Errorf("missing data file: Import = %v, want ErrInvalidPack", err)
	}
}

// An uninstall turns the startup auto-install off for good (server_meta);
// a fresh database has it on, and Live tells whether any pack serves.
func TestUninstallTurnsAutoInstallOff(t *testing.T) {
	ctx := context.Background()
	sqlDB := dbtest.Open(t)
	off, err := strokes.AutoInstallOff(ctx, sqlDB)
	if err != nil || off {
		t.Fatalf("fresh database: off = %v, %v", off, err)
	}
	if live, err := strokes.Live(ctx, sqlDB); err != nil || live {
		t.Fatalf("fresh database: live = %v, %v", live, err)
	}
	if _, err := strokes.Import(ctx, sqlDB, writePack(t, "hw", "1", []string{"zh"}, threeChars())); err != nil {
		t.Fatal(err)
	}
	if live, err := strokes.Live(ctx, sqlDB); err != nil || !live {
		t.Fatalf("after import: live = %v, %v", live, err)
	}
	if off, _ := strokes.AutoInstallOff(ctx, sqlDB); off {
		t.Fatal("an import turned auto-install off")
	}
	if err := strokes.Uninstall(ctx, sqlDB, "hw"); err != nil {
		t.Fatal(err)
	}
	if off, err := strokes.AutoInstallOff(ctx, sqlDB); err != nil || !off {
		t.Fatalf("after uninstall: off = %v, %v", off, err)
	}
	if live, _ := strokes.Live(ctx, sqlDB); live {
		t.Fatal("live after the uninstall")
	}
	// A failed uninstall (unknown pack) changes nothing; a reinstall keeps it off.
	if _, err := strokes.Import(ctx, sqlDB, writePack(t, "hw", "1", []string{"zh"}, threeChars())); err != nil {
		t.Fatal(err)
	}
	if off, _ := strokes.AutoInstallOff(ctx, sqlDB); !off {
		t.Fatal("a reinstall turned auto-install back on")
	}
	fresh := dbtest.Open(t)
	if err := strokes.Uninstall(ctx, fresh, "nope"); !errors.Is(err, strokes.ErrNotFound) {
		t.Fatalf("unknown uninstall: %v", err)
	}
	if off, _ := strokes.AutoInstallOff(ctx, fresh); off {
		t.Fatal("a failed uninstall turned auto-install off")
	}
}

// TestLookupForPrefersThePackMadeForTheLanguage: with a language, a pack that lists it wins, and one made for
// that language alone (KanjiVG's Japanese shapes) beats a shared pack (the Chinese shapes); without a language,
// or when no pack lists it, the order of registration decides as before.
func TestLookupForPrefersThePackMadeForTheLanguage(t *testing.T) {
	ctx := context.Background()
	sqlDB := dbtest.Open(t)
	if _, err := strokes.Import(ctx, sqlDB, writePack(t, "shared", "1", []string{"zh", "ja"}, line("好", dataHao))); err != nil {
		t.Fatal(err)
	}
	if _, err := strokes.Import(ctx, sqlDB, writePack(t, "japanese", "1", []string{"ja"}, line("好", dataYi)+line("あ", dataRad))); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct{ char, lang, want string }{
		{"好", "", dataHao},   // no language: the first pack
		{"好", "zh", dataHao}, // the Japanese pack does not list zh
		{"好", "ja", dataYi},  // made for ja alone
		{"好", "ko", dataHao}, // nobody lists ko: the first pack
		{"あ", "ja", dataRad}, // only the Japanese pack has it
		{"あ", "zh", dataRad}, // a character only one pack has is served whatever the language
		{"あ", "", dataRad},
	} {
		got, ok, err := strokes.LookupFor(ctx, sqlDB, c.char, c.lang)
		if err != nil || !ok || string(got) != c.want {
			t.Errorf("LookupFor(%s, %q) = %s, %v, %v; want %s", c.char, c.lang, got, ok, err, c.want)
		}
	}
	if _, ok, _ := strokes.LookupFor(ctx, sqlDB, "一", "ja"); ok {
		t.Error("a character no pack has must not be found")
	}
	// Lookup is LookupFor without a language.
	if got, _, _ := strokes.Lookup(ctx, sqlDB, "好"); string(got) != dataHao {
		t.Errorf("Lookup(好) = %s", got)
	}
}
