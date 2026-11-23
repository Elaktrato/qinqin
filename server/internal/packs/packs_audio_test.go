package packs_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/dict"
	"qinqin/internal/packs"
)

// audioPack writes a generated two-clip audio pack (synthetic Ogg-magic bytes).
func audioPack(t *testing.T, id string) dict.Pack {
	t.Helper()
	dir := t.TempDir()
	files := map[string]string{
		"manifest.json": `{"id":"` + id + `","name":"Audio test","version":"1","type":"audio","language":"ja","license":"CC0","attribution":"Tester","notice":"N.","format":"audio-index"}`,
		"index.tsv":     "kind\tform\treading\tfile\tlicense\tattribution\tsource\nterm\t風\tかぜ\taudio/a.opus\t\t\t\nterm\t水\tみず\taudio/b.ogg\t\t\t\n",
		"audio/a.opus":  "OggS-one",
		"audio/b.ogg":   "OggS-two",
	}
	for name, body := range files {
		p := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	p, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func blobCount(t *testing.T, store string) int {
	t.Helper()
	n := 0
	_ = filepath.WalkDir(store, func(p string, d os.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			n++
		}
		return nil
	})
	return n
}

func TestAudioPacksImportListUninstall(t *testing.T) {
	ctx, sqlDB, store := context.Background(), dbtest.Open(t), t.TempDir()
	if !packs.Supported(dict.TypeAudio) {
		t.Fatal("audio is not a supported pack type")
	}
	if packs.Installable(dict.TypeAudio) {
		t.Error("audio packs must not be installable by upload (limits; see the plan)")
	}
	if !packs.Installable(dict.TypeDictionary) {
		t.Error("dictionaries stay installable")
	}

	line, err := packs.Import(ctx, sqlDB, audioPack(t, "audio-test"), packs.WithAudioStore(store))
	if err != nil || line != "2 clips" {
		t.Fatalf("Import = %q, %v", line, err)
	}
	if blobCount(t, store) != 2 {
		t.Errorf("blobs = %d, want 2", blobCount(t, store))
	}
	all, err := packs.List(ctx, sqlDB)
	if err != nil || len(all) != 1 || all[0].Type != "audio" || all[0].PackID != "audio-test" ||
		all[0].License != "CC0" || all[0].Attribution != "Tester" || all[0].Notice != "N." || all[0].UpdatedAt == "" {
		t.Fatalf("List = %+v, %v", all, err)
	}
	if got, err := packs.Find(ctx, sqlDB, dict.TypeAudio, "audio-test"); err != nil || got.Name != "Audio test" {
		t.Errorf("Find = %+v, %v", got, err)
	}

	if err := packs.Uninstall(ctx, sqlDB, dict.TypeAudio, "audio-test", packs.WithAudioStore(store)); err != nil {
		t.Fatalf("Uninstall: %v", err)
	}
	if blobCount(t, store) != 0 {
		t.Errorf("blobs after uninstall = %d", blobCount(t, store))
	}
	if all, _ := packs.List(ctx, sqlDB); len(all) != 0 {
		t.Errorf("List after uninstall = %+v", all)
	}
	if err := packs.Uninstall(ctx, sqlDB, dict.TypeAudio, "audio-test", packs.WithAudioStore(store)); !errors.Is(err, packs.ErrNotFound) {
		t.Errorf("second uninstall = %v, want ErrNotFound", err)
	}
}

func TestAudioNeedsAStoreDirectory(t *testing.T) {
	ctx, sqlDB := context.Background(), dbtest.Open(t)
	if _, err := packs.Import(ctx, sqlDB, audioPack(t, "audio-test")); err == nil || !strings.Contains(err.Error(), "store") {
		t.Errorf("Import without a store = %v, want an error naming the store", err)
	}
	if err := packs.Uninstall(ctx, sqlDB, dict.TypeAudio, "x"); err == nil || errors.Is(err, packs.ErrNotFound) {
		t.Errorf("Uninstall without a store = %v, want a configuration error", err)
	}
}
