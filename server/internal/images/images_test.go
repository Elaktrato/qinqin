package images_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/images"
	"qinqin/internal/pack"
)

const (
	apple = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72"><path fill="none" stroke="#000" d="M1 2h3"/></svg>`
	dog   = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72"><circle cx="5" cy="5" r="2"/></svg>`
	call  = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72"><rect width="3" height="3"/></svg>`
	hit   = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72"><line x1="0" y1="0" x2="3" y2="3"/></svg>`
)

const pictures = "concept\tfile\tlabel\tcredit\n" +
	"1F34E\tpictures/1F34E.svg\tred apple\tOpenMoji, Liz Bravo\n" +
	"1F415\tpictures/1F415.svg\tdog\tOpenMoji\n" +
	"1F4DE\tpictures/1F4DE.svg\ttelephone receiver\tOpenMoji\n" +
	"1F44A\tpictures/1F44A.svg\toncoming fist\tOpenMoji\n"

const mapping = "language\ttarget\tsense\tconcept\tscore\tbasis\tnote\n" +
	"zh\t苹果\t0\t1F34E\t100\tmanual\t\n" +
	"zh\t狗\t1\t1F415\t100\tname+gloss\tgou3\n" +
	"zh\t打\t1\t1F44A\t80\tgloss\tda3 hit\n" +
	"zh\t打\t3\t1F4DE\t80\tgloss\tda3 phone\n" +
	"ja\t犬\t0\t1F415\t90\tname\t\n" +
	"ja\tj:1\t0\t1F34E\t70\tname\t\n"

// build writes an images pack with the given overrides of its files (a nil
// value removes the file) and returns it loaded.
func build(t *testing.T, id string, override map[string]*string) pack.Pack {
	t.Helper()
	files := map[string]string{
		"manifest.json":      `{"id":"` + id + `","name":"Test pictures","version":"1.0","type":"images","languages":["zh","ja"],"license":"CC BY-SA 4.0","attribution":"Qinqin test fixtures","notice":"A notice.","format":"images-svg"}`,
		"LICENSE":            "CC BY-SA 4.0 (stand-in)\n",
		"pictures.tsv":       pictures,
		"map.tsv":            mapping,
		"pictures/1F34E.svg": apple,
		"pictures/1F415.svg": dog,
		"pictures/1F4DE.svg": call,
		"pictures/1F44A.svg": hit,
	}
	for k, v := range override {
		if v == nil {
			delete(files, k)
		} else {
			files[k] = *v
		}
	}
	dir := t.TempDir()
	for name, body := range files {
		path := filepath.Join(dir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	p, err := pack.LoadPack(dir)
	if err != nil {
		t.Fatalf("LoadPack: %v", err)
	}
	return p
}

func s(v string) *string { return &v }

func TestImportStoresPicturesAndMappings(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	r, err := images.Import(ctx, sqlDB, build(t, "images-test", nil))
	if err != nil || r.Pictures != 4 || r.Mappings != 6 {
		t.Fatalf("Import = %+v, %v", r, err)
	}
	var svg, credit string
	if err := sqlDB.QueryRow(`SELECT svg, credit FROM image_pictures WHERE pack_id = 'images-test' AND concept = '1F34E'`).Scan(&svg, &credit); err != nil {
		t.Fatal(err)
	}
	if svg != apple || credit != "OpenMoji, Liz Bravo" {
		t.Errorf("stored picture = %q, %q (the SVG must be stored byte for byte)", svg, credit)
	}
	infos, err := images.Packs(ctx, sqlDB)
	if err != nil || len(infos) != 1 {
		t.Fatalf("Packs = %+v, %v", infos, err)
	}
	i := infos[0]
	if i.PackID != "images-test" || i.Pictures != 4 || i.Mappings != 6 || strings.Join(i.Languages, ",") != "ja,zh" || i.License != "CC BY-SA 4.0" {
		t.Errorf("Packs[0] = %+v", i)
	}
}

func TestImportRefusesBadPacks(t *testing.T) {
	long := "language\ttarget\tsense\tconcept\tscore\tbasis\tnote\n"
	for name, c := range map[string]struct {
		override map[string]*string
		want     string
	}{
		"no pictures file":       {map[string]*string{"pictures.tsv": nil}, "pictures.tsv"},
		"no map file":            {map[string]*string{"map.tsv": nil}, "map.tsv"},
		"missing picture":        {map[string]*string{"pictures/1F415.svg": nil}, "1F415.svg"},
		"script in picture":      {map[string]*string{"pictures/1F415.svg": s(`<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>`)}, "not allowed"},
		"bad header":             {map[string]*string{"pictures.tsv": s("a\tb\n")}, "header"},
		"path in concept":        {map[string]*string{"pictures.tsv": s("concept\tfile\tlabel\tcredit\n../x\tpictures/../x.svg\tx\ty\n")}, "plain id"},
		"file column off":        {map[string]*string{"pictures.tsv": s(strings.Replace(pictures, "pictures/1F415.svg", "pictures/other.svg", 1))}, "must be pictures/1F415.svg"},
		"duplicate concept":      {map[string]*string{"pictures.tsv": s(pictures + "1F415\tpictures/1F415.svg\tdog\tOpenMoji\n")}, "twice"},
		"unknown concept in map": {map[string]*string{"map.tsv": s(long + "zh\tx\t0\tNOPE\t90\tname\t\n")}, "not in pictures.tsv"},
		"foreign language":       {map[string]*string{"map.tsv": s(long + "ko\tx\t0\t1F415\t90\tname\t\n")}, "manifest's languages"},
		"score out of range":     {map[string]*string{"map.tsv": s(long + "zh\tx\t0\t1F415\t101\tname\t\n")}, "score"},
		"negative sense":         {map[string]*string{"map.tsv": s(long + "zh\tx\t-1\t1F415\t90\tname\t\n")}, "sense"},
		"short row":              {map[string]*string{"map.tsv": s(long + "zh\tx\t0\n")}, "fields"},
		"duplicate row":          {map[string]*string{"map.tsv": s(long + "zh\tx\t0\t1F415\t90\tname\t\nzh\tx\t0\t1F415\t80\tgloss\t\n")}, "twice"},
		"empty map":              {map[string]*string{"map.tsv": s(long)}, "no mappings"},
		"bad basis":              {map[string]*string{"map.tsv": s(long + "zh\tx\t0\t1F415\t90\tBad Basis!\t\n")}, "basis"},
		"wrong type":             {map[string]*string{"manifest.json": s(`{"id":"images-test","name":"x","version":"1","type":"strokes","languages":["zh"],"license":"x","attribution":"x","format":"hanzi-writer-jsonl-gz"}`)}, "not an images pack"},
	} {
		t.Run(name, func(t *testing.T) {
			sqlDB := dbtest.Open(t)
			p := build(t, "images-test", c.override)
			_, err := images.Import(context.Background(), sqlDB, p)
			if !errors.Is(err, pack.ErrInvalidPack) || !strings.Contains(err.Error(), c.want) {
				t.Fatalf("Import error = %v, want an invalid pack naming %q", err, c.want)
			}
			var n int
			if err := sqlDB.QueryRow(`SELECT (SELECT COUNT(*) FROM image_packs) + (SELECT COUNT(*) FROM image_pictures) + (SELECT COUNT(*) FROM image_map)`).Scan(&n); err != nil || n != 0 {
				t.Errorf("a refused pack left %d rows (%v)", n, err)
			}
		})
	}
}

func TestSymlinkedPictureIsRefused(t *testing.T) {
	p := build(t, "images-test", nil)
	target := filepath.Join(t.TempDir(), "outside.svg")
	if err := os.WriteFile(target, []byte(dog), 0o644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(p.Dir, "pictures", "1F415.svg")
	if err := os.Remove(link); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, link); err != nil {
		t.Skip("no symlinks here")
	}
	_, err := images.Import(context.Background(), dbtest.Open(t), p)
	if !errors.Is(err, pack.ErrInvalidPack) || !strings.Contains(err.Error(), "regular file") {
		t.Fatalf("Import = %v, want a refusal of the symlink", err)
	}
}

func TestReimportAndUninstall(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	p := build(t, "images-test", nil)
	if _, err := images.Import(ctx, sqlDB, p); err != nil {
		t.Fatal(err)
	}
	if _, err := images.Import(ctx, sqlDB, p); err != nil {
		t.Fatalf("re-import: %v", err)
	}
	if err := images.Uninstall(ctx, sqlDB, "images-test"); err != nil {
		t.Fatal(err)
	}
	if infos, _ := images.Packs(ctx, sqlDB); len(infos) != 0 {
		t.Errorf("an uninstalled pack is still listed: %+v", infos)
	}
	var n int
	if err := sqlDB.QueryRow(`SELECT (SELECT COUNT(*) FROM image_pictures) + (SELECT COUNT(*) FROM image_map)`).Scan(&n); err != nil || n != 0 {
		t.Errorf("uninstall left %d data rows (%v)", n, err)
	}
	if err := images.Uninstall(ctx, sqlDB, "images-test"); !errors.Is(err, images.ErrNotFound) || !errors.Is(err, pack.ErrNotFound) {
		t.Errorf("second Uninstall = %v, want ErrNotFound", err)
	}
	if r, err := images.Import(ctx, sqlDB, p); err != nil || r.Pictures != 4 {
		t.Errorf("reinstall = %+v, %v", r, err)
	}
	if infos, _ := images.Packs(ctx, sqlDB); len(infos) != 1 {
		t.Errorf("a reinstalled pack is not listed: %+v", infos)
	}
}

func TestResolve(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	if _, err := images.Import(ctx, sqlDB, build(t, "images-test", nil)); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		name     string
		language string
		targets  []string
		sense    int
		want     string // concept, "" none
	}{
		{"entry-wide mapping", "zh", []string{"苹果"}, 0, "1F34E"},
		{"any of the forms", "zh", []string{"x", "", "苹果", "蘋果"}, 0, "1F34E"},
		{"a sense-1 mapping with no sense asked", "zh", []string{"狗"}, 0, "1F415"},
		{"no sense asked: the best of all senses", "zh", []string{"打"}, 0, "1F44A"},
		{"sense 1", "zh", []string{"打"}, 1, "1F44A"},
		{"sense 3", "zh", []string{"打"}, 3, "1F4DE"},
		{"a sense with no picture and no entry-wide one", "zh", []string{"打"}, 2, ""},
		{"an entry-wide picture serves every sense", "zh", []string{"苹果"}, 2, "1F34E"},
		{"another language", "ja", []string{"犬", "いぬ"}, 0, "1F415"},
		{"by entry key", "ja", []string{"j:1"}, 0, "1F34E"},
		{"wrong language", "ja", []string{"苹果"}, 0, ""},
		{"unknown word", "zh", []string{"桌子"}, 0, ""},
		{"no targets", "zh", nil, 0, ""},
	} {
		f, ok, err := images.Resolve(ctx, sqlDB, c.language, c.targets, c.sense, nil)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if got := f.Concept; got != c.want || ok != (c.want != "") {
			t.Errorf("%s: got %q (ok %v), want %q", c.name, got, ok, c.want)
		}
	}
	f, _, _ := images.Resolve(ctx, sqlDB, "zh", []string{"苹果"}, 0, nil)
	if f.SVG != apple || f.Label != "red apple" || f.Credit != "OpenMoji, Liz Bravo" || f.License != "CC BY-SA 4.0" || f.PackID != "images-test" {
		t.Errorf("Found = %+v", f)
	}
}

func TestResolvePrefersTheHigherScoreAcrossPacks(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	if _, err := images.Import(ctx, sqlDB, build(t, "images-a", nil)); err != nil {
		t.Fatal(err)
	}
	// A second pack maps 苹果 to the dog at a lower score: the first pack wins.
	low := "language\ttarget\tsense\tconcept\tscore\tbasis\tnote\nzh\t苹果\t0\t1F415\t70\tgloss\t\n"
	if _, err := images.Import(ctx, sqlDB, build(t, "images-b", map[string]*string{"map.tsv": s(low)})); err != nil {
		t.Fatal(err)
	}
	f, _, err := images.Resolve(ctx, sqlDB, "zh", []string{"苹果"}, 0, nil)
	if err != nil || f.Concept != "1F34E" || f.PackID != "images-a" {
		t.Fatalf("Resolve = %+v, %v; want the higher-scoring apple of images-a", f, err)
	}
	// Uninstalling the first pack leaves the second's picture.
	if err := images.Uninstall(ctx, sqlDB, "images-a"); err != nil {
		t.Fatal(err)
	}
	f, ok, err := images.Resolve(ctx, sqlDB, "zh", []string{"苹果"}, 0, nil)
	if err != nil || !ok || f.PackID != "images-b" || f.Concept != "1F415" {
		t.Fatalf("after the uninstall Resolve = %+v, %v, %v", f, ok, err)
	}
}
