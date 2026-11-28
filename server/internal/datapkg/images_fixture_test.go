package datapkg_test

import (
	"archive/zip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"qinqin/internal/datapkg"
	"qinqin/internal/dbtest"
	"qinqin/internal/pack"
	"qinqin/internal/packs"
)

// The images package fixture (#274): docs/contracts/images/package.qqpkg is a
// package this builder wrote, and package.json lists its rows. The web reads
// the same file with its own zip and package database reader
// (apps/web/src/lib/packages/imagesPackage.contract.test.ts). The pack is made
// to need what a real one needs: a picture longer than a database page
// (overflow pages) and enough map rows for interior b-tree pages.
// UPDATE_IMAGES_PACKAGE_FIXTURE=1 rewrites both files.

var imagesFixtureDir = filepath.Join("..", "..", "..", "docs", "contracts", "images")

type imagesFixture struct {
	Version     int    `json:"version"`
	Rule        string `json:"rule"`
	Note        string `json:"note"`
	File        string `json:"file"`
	ID          string `json:"id"`
	Revision    int    `json:"revision"`
	ContentHash string `json:"contentHash"`
	InstanceID  string `json:"instanceId"`
	Pictures    []struct {
		Concept string `json:"concept"`
		Label   string `json:"label"`
		Credit  string `json:"credit"`
		SVG     string `json:"svg"`
	} `json:"pictures"`
	Map [][]any `json:"map"`
}

func fixturePack(t *testing.T) pack.Pack {
	t.Helper()
	var long strings.Builder
	long.WriteString(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72"><path d="M0 0`)
	for i := range 900 {
		fmt.Fprintf(&long, " L%d %d", i%72, (i*7)%72)
	}
	long.WriteString(`" fill="none" stroke="#000000" stroke-width="2"/></svg>`)
	var m strings.Builder
	m.WriteString("language\ttarget\tsense\tconcept\tscore\tbasis\tnote\n")
	m.WriteString("zh\t苹果\t0\t1F34E\t100\tmanual\t\nzh\t水\t0\t1F4A7\t90\tname\t\nja\tj:1\t0\t1F4A7\t80\tgloss\t\nja\tみず\t1\tLONG\t75\tgloss\t\n")
	for i := 1; i <= 400; i++ {
		fmt.Fprintf(&m, "zh\t词%03d\t%d\t%s\t%d\tgloss\t\n", i, i%3, []string{"1F34E", "1F4A7", "LONG"}[i%3], 50+i%50)
	}
	return writePack(t, map[string]any{"id": "pics-fixture", "name": "Fixture pictures", "type": "images", "languages": []string{"ja", "zh"},
		"license": "CC BY-SA 4.0", "attribution": "Fixture pictures for the images package contract", "format": "images-svg"},
		map[string][]byte{
			"pictures.tsv":        []byte("concept\tfile\tlabel\tcredit\n1F34E\tpictures/1F34E.svg\tred apple\tOpenMoji, Fixture\n1F4A7\tpictures/1F4A7.svg\tdroplet\tOpenMoji, Fixture\nLONG\tpictures/LONG.svg\ta long line\tFixture & \"Co\"\nUNUSED\tpictures/UNUSED.svg\tunused\tnobody\n"),
			"pictures/1F34E.svg":  []byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72"><circle cx="36" cy="40" r="22" fill="#d22f27" stroke="#000" stroke-width="2"/></svg>`),
			"pictures/1F4A7.svg":  []byte(svgDrop),
			"pictures/LONG.svg":   []byte(long.String()),
			"pictures/UNUSED.svg": []byte(`<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>`),
			"map.tsv":             []byte(m.String()),
			"LICENSE":             []byte("Fixture licence text\n"),
		})
}

func TestImagesPackageFixture(t *testing.T) {
	ctx := context.Background()
	sqlDB := dbtest.Open(t)
	if _, err := packs.Import(ctx, sqlDB, fixturePack(t)); err != nil {
		t.Fatal(err)
	}
	specs, err := datapkg.Plan(ctx, sqlDB)
	if err != nil {
		t.Fatal(err)
	}
	b, err := datapkg.Build(ctx, sqlDB, specByID(t, specs, "images.pics-fixture"), datapkg.BuildMeta{InstanceID: instanceID, Revision: 2, Now: builtAt}, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	p := openPackage(t, b.Path)
	var fx imagesFixture
	fx.Version, fx.Rule, fx.File, fx.ID, fx.Revision, fx.ContentHash, fx.InstanceID = 1, "images/package", "package.qqpkg", "images.pics-fixture", 2, b.ContentHash, instanceID
	fx.Note = "An images package (docs/contracts/packages/README.md, type images) written by the server's builder: package.qqpkg, its catalogue values (id, revision, contentHash, instanceId; sha256 and bytes are those of the file) and the rows of its data.sqlite: pictures by concept, map rows [language, target, sense, concept, score, basis] by language, target, sense, concept. Only mapped pictures are in it (UNUSED is not). Go: server/internal/datapkg/images_fixture_test.go; web: apps/web/src/lib/packages/imagesPackage.contract.test.ts."
	rows, err := p.db.Query(`SELECT concept, label, credit, svg FROM pictures ORDER BY concept`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var pic struct {
			Concept string `json:"concept"`
			Label   string `json:"label"`
			Credit  string `json:"credit"`
			SVG     string `json:"svg"`
		}
		rows.Scan(&pic.Concept, &pic.Label, &pic.Credit, &pic.SVG)
		fx.Pictures = append(fx.Pictures, pic)
	}
	rows.Close()
	rows, err = p.db.Query(`SELECT language, target, sense, concept, score, basis FROM map ORDER BY language, target, sense, concept`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var lang, target, concept, basis string
		var sense, score int
		rows.Scan(&lang, &target, &sense, &concept, &score, &basis)
		fx.Map = append(fx.Map, []any{lang, target, float64(sense), concept, float64(score), basis})
	}
	rows.Close()
	if len(fx.Pictures) != 3 || len(fx.Map) != 404 {
		t.Fatalf("%d pictures, %d map rows", len(fx.Pictures), len(fx.Map))
	}

	jsonPath, filePath := filepath.Join(imagesFixtureDir, "package.json"), filepath.Join(imagesFixtureDir, "package.qqpkg")
	if os.Getenv("UPDATE_IMAGES_PACKAGE_FIXTURE") == "1" {
		raw, _ := json.MarshalIndent(fx, "", " ")
		if err := os.WriteFile(jsonPath, append(raw, '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
		data, _ := os.ReadFile(b.Path)
		if err := os.WriteFile(filePath, data, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	raw, err := os.ReadFile(jsonPath)
	if err != nil {
		t.Fatal(err)
	}
	var want imagesFixture
	if err := json.Unmarshal(raw, &want); err != nil {
		t.Fatal(err)
	}
	got, _ := json.Marshal(fx)
	exp, _ := json.Marshal(want)
	if string(got) != string(exp) {
		t.Errorf("package.json differs from what the builder writes (UPDATE_IMAGES_PACKAGE_FIXTURE=1 rewrites it)")
	}
	// The committed file is a package of the same content: its manifest and data.sqlite agree with package.json.
	committed := openPackage(t, filePath)
	var m datapkg.Manifest
	if err := json.Unmarshal(committed.members["manifest.json"], &m); err != nil {
		t.Fatal(err)
	}
	if m.ID != want.ID || m.Revision != want.Revision || m.ContentHash != want.ContentHash || m.InstanceID != want.InstanceID {
		t.Errorf("committed manifest %+v", m)
	}
	if got := committed.strings(t, `SELECT concept FROM pictures ORDER BY concept`); !slices.Equal(got, []string{"1F34E", "1F4A7", "LONG"}) {
		t.Errorf("committed pictures %v", got)
	}
	zr, err := zip.OpenReader(filePath)
	if err != nil {
		t.Fatal(err)
	}
	defer zr.Close()
	for _, f := range zr.File {
		if f.Name == "data.sqlite" {
			rc, _ := f.Open()
			n, _ := io.Copy(io.Discard, rc)
			rc.Close()
			if n < 3*4096 {
				t.Errorf("data.sqlite is %d bytes: too small to need interior pages", n)
			}
		}
	}
}
