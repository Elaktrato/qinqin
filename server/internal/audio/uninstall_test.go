package audio_test

import (
	"context"
	"errors"
	"testing"

	"qinqin/internal/audio"
)

func TestUninstallRemovesRowsAndUnsharedBlobs(t *testing.T) {
	ctx, sqlDB, store := context.Background(), newDB(t), t.TempDir()
	files, index := twoRowPack(t)
	if _, err := audio.Import(ctx, sqlDB, makePack(t, "p1", "ja", "CC0", index, files), store); err != nil {
		t.Fatal(err)
	}
	res, err := audio.Uninstall(ctx, sqlDB, "p1", store)
	if err != nil || res.Clips != 2 {
		t.Fatalf("Uninstall = %+v, %v", res, err)
	}
	if got := blobs(t, store); len(got) != 0 {
		t.Errorf("blobs left: %v", got)
	}
	var n int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM audio_clips`).Scan(&n); err != nil || n != 0 {
		t.Errorf("clip rows = %d, %v", n, err)
	}
	var deleted *string
	if err := sqlDB.QueryRow(`SELECT deleted_at FROM audio_packs WHERE pack_id = 'p1'`).Scan(&deleted); err != nil || deleted == nil {
		t.Errorf("pack not soft-deleted: %v, %v", deleted, err)
	}
	if r, _ := audio.Resolve(ctx, sqlDB, "ja", "風", []string{"かぜ"}); len(r.Terms) != 0 {
		t.Errorf("uninstalled pack still resolves: %+v", r.Terms)
	}
}

func TestUninstallKeepsBlobSharedWithAnotherPack(t *testing.T) {
	ctx, sqlDB, store := context.Background(), newDB(t), t.TempDir()
	shared := []clipFile{{"s.opus", oggClip("shared")}}
	row := []string{"term\t風\tかぜ\taudio/s.opus\t\t\t"}
	for _, id := range []string{"p1", "p2"} {
		if _, err := audio.Import(ctx, sqlDB, makePack(t, id, "ja", "CC0", row, shared), store); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := audio.Uninstall(ctx, sqlDB, "p1", store); err != nil {
		t.Fatal(err)
	}
	if got := blobs(t, store); len(got) != 1 {
		t.Fatalf("blobs = %v, want the shared one kept", got)
	}
	if r, _ := audio.Resolve(ctx, sqlDB, "ja", "風", []string{"かぜ"}); len(r.Terms) != 1 || r.Terms[0].PackID != "p2" {
		t.Errorf("terms = %+v, want p2's clip", r.Terms)
	}
	if _, err := audio.Uninstall(ctx, sqlDB, "p2", store); err != nil {
		t.Fatal(err)
	}
	if got := blobs(t, store); len(got) != 0 {
		t.Errorf("blobs after the last pack: %v", got)
	}
}

func TestUninstallUnknownOrAlreadyRemovedPack(t *testing.T) {
	ctx, sqlDB, store := context.Background(), newDB(t), t.TempDir()
	if _, err := audio.Uninstall(ctx, sqlDB, "nope", store); !errors.Is(err, audio.ErrPackNotFound) {
		t.Errorf("unknown pack err = %v, want ErrPackNotFound", err)
	}
	files, index := twoRowPack(t)
	if _, err := audio.Import(ctx, sqlDB, makePack(t, "p1", "ja", "CC0", index, files), store); err != nil {
		t.Fatal(err)
	}
	if _, err := audio.Uninstall(ctx, sqlDB, "p1", store); err != nil {
		t.Fatal(err)
	}
	if _, err := audio.Uninstall(ctx, sqlDB, "p1", store); !errors.Is(err, audio.ErrPackNotFound) {
		t.Errorf("second uninstall err = %v, want ErrPackNotFound", err)
	}
}

func TestReimportRevivesAnUninstalledPack(t *testing.T) {
	ctx, sqlDB, store := context.Background(), newDB(t), t.TempDir()
	files, index := twoRowPack(t)
	p := makePack(t, "p1", "ja", "CC0", index, files)
	if _, err := audio.Import(ctx, sqlDB, p, store); err != nil {
		t.Fatal(err)
	}
	if _, err := audio.Uninstall(ctx, sqlDB, "p1", store); err != nil {
		t.Fatal(err)
	}
	if _, err := audio.Import(ctx, sqlDB, p, store); err != nil {
		t.Fatal(err)
	}
	if r, _ := audio.Resolve(ctx, sqlDB, "ja", "風", []string{"かぜ"}); len(r.Terms) != 1 {
		t.Errorf("revived pack does not resolve: %+v", r.Terms)
	}
	if got := blobs(t, store); len(got) != 2 {
		t.Errorf("blobs = %v, want 2", got)
	}
}
