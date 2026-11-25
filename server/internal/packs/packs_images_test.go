package packs_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"qinqin/internal/pack"
)

const (
	imagesApple = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72"><path fill="none" stroke="#000" d="M1 2h3"/></svg>`
	imagesDog   = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72"><circle cx="5" cy="5" r="2"/></svg>`
)

// imagesPack is a small valid images pack: two pictures, three mappings.
func imagesPack(t *testing.T) pack.Pack {
	t.Helper()
	dir := t.TempDir()
	m, _ := json.Marshal(map[string]any{
		"id": "images-test", "name": "Test pictures", "version": "1.0", "type": "images",
		"languages": []string{"zh", "ja"}, "license": "CC BY-SA 4.0",
		"attribution": "Qinqin test fixtures", "format": "images-svg", "notice": "A notice.",
	})
	if err := os.MkdirAll(filepath.Join(dir, "pictures"), 0o755); err != nil {
		t.Fatal(err)
	}
	for name, body := range map[string]string{
		"manifest.json":        string(m),
		"LICENSE":              "CC BY-SA 4.0 (test stand-in)\n",
		"pictures.tsv":         "concept\tfile\tlabel\tcredit\n1F34E\tpictures/1F34E.svg\tred apple\tOpenMoji, Liz Bravo\n1F415\tpictures/1F415.svg\tdog\tOpenMoji\n",
		"pictures/1F34E.svg":   imagesApple,
		"pictures/1F415.svg":   imagesDog,
		"map.tsv":              "language\ttarget\tsense\tconcept\tscore\tbasis\tnote\nzh\t苹果\t0\t1F34E\t100\tmanual\t\nzh\t狗\t1\t1F415\t100\tname+gloss\tgou3\nja\t犬\t0\t1F415\t90\tname\t\n",
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
