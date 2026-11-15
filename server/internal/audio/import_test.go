package audio_test

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/audio"
)

func twoRowPack(t *testing.T) (dictPackFiles []clipFile, index []string) {
	return []clipFile{{"a.opus", oggClip("a")}, {"b.mp3", mp3Clip("b")}},
		[]string{"term\t風\tカゼ\taudio/a.opus\t\t\t", "term\t水\tみず\taudio/b.mp3\tCC0\tOther\thttps://x"}
}

func TestImportCopiesBlobsAndRows(t *testing.T) {
	ctx, sqlDB, store := context.Background(), newDB(t), t.TempDir()
	files, index := twoRowPack(t)
	res, err := audio.Import(ctx, sqlDB, makePack(t, "p1", "ja", "CC BY 4.0", index, files), store)
	if err != nil || res.Clips != 2 {
		t.Fatalf("Import = %+v, %v", res, err)
	}
	if got := blobs(t, store); len(got) != 2 {
		t.Fatalf("blobs = %v, want 2", got)
	}
	var sha, ext, lic, key string
	var n int
	if err := sqlDB.QueryRow(`SELECT sha256, ext, license, reading_key, bytes FROM audio_clips WHERE form = '風'`).Scan(&sha, &ext, &lic, &key, &n); err != nil {
		t.Fatal(err)
	}
	if ext != "opus" || lic != "CC BY 4.0" || key != "かぜ" || n != len(oggClip("a")) {
		t.Errorf("row = %s %s %s %d", ext, lic, key, n)
	}
	data, err := os.ReadFile(audio.BlobPath(store, sha, ext))
	if err != nil || !bytes.Equal(data, oggClip("a")) {
		t.Errorf("blob = %q, %v", data, err)
	}
	if want := filepath.Join(store, sha[:2], sha+".opus"); audio.BlobPath(store, sha, ext) != want {
		t.Errorf("BlobPath = %s, want %s", audio.BlobPath(store, sha, ext), want)
	}
	var license string
	if err := sqlDB.QueryRow(`SELECT license FROM audio_clips WHERE form = '水'`).Scan(&license); err != nil || license != "CC0" {
		t.Errorf("per-row licence = %q, %v", license, err)
	}
}

func TestImportSameFileTwiceStoresOneBlob(t *testing.T) {
	ctx, sqlDB, store := context.Background(), newDB(t), t.TempDir()
	p := makePack(t, "p1", "ja", "CC0",
		[]string{"term\t風\tかぜ\taudio/a.opus\t\t\t", "term\t風邪\tかぜ\taudio/b.opus\t\t\t"},
		[]clipFile{{"a.opus", oggClip("same")}, {"b.opus", oggClip("same")}})
	if _, err := audio.Import(ctx, sqlDB, p, store); err != nil {
		t.Fatal(err)
	}
	if got := blobs(t, store); len(got) != 1 {
		t.Errorf("blobs = %v, want 1", got)
	}
}

func TestImportRejectsBadFiles(t *testing.T) {
	cases := map[string]clipFile{
		"magic":     {"a.ogg", mp3Clip("x")},
		"mp3 magic": {"a.mp3", oggClip("x")},
		"size":      {"a.ogg", append(oggClip("x"), make([]byte, 2<<20)...)},
	}
	for name, f := range cases {
		store := t.TempDir()
		p := makePack(t, "p1", "ja", "CC0", []string{"term\t風\tかぜ\taudio/" + f.name + "\t\t\t"}, []clipFile{f})
		if _, err := audio.Import(context.Background(), newDB(t), p, store); err == nil {
			t.Errorf("%s: Import succeeded", name)
		}
		if got := blobs(t, store); len(got) != 0 {
			t.Errorf("%s: wrote %v", name, got)
		}
	}
	p := makePack(t, "p1", "ja", "CC0", []string{"term\t風\tかぜ\taudio/missing.ogg\t\t\t"}, nil)
	if _, err := audio.Import(context.Background(), newDB(t), p, t.TempDir()); err == nil {
		t.Error("missing file: Import succeeded")
	}
}

func TestImportReimportDeletesDroppedBlob(t *testing.T) {
	ctx, sqlDB, store := context.Background(), newDB(t), t.TempDir()
	files, index := twoRowPack(t)
	if _, err := audio.Import(ctx, sqlDB, makePack(t, "p1", "ja", "CC0", index, files), store); err != nil {
		t.Fatal(err)
	}
	if _, err := audio.Import(ctx, sqlDB, makePack(t, "p1", "ja", "CC0", index[:1], files[:1]), store); err != nil {
		t.Fatal(err)
	}
	if got := blobs(t, store); len(got) != 1 || !strings.HasSuffix(got[0], ".opus") {
		t.Errorf("blobs = %v, want only the opus", got)
	}
	var n int
	_ = sqlDB.QueryRow(`SELECT COUNT(*) FROM audio_clips`).Scan(&n)
	if n != 1 {
		t.Errorf("rows = %d, want 1", n)
	}
}

func TestImportKeepsBlobSharedWithAnotherPack(t *testing.T) {
	ctx, sqlDB, store := context.Background(), newDB(t), t.TempDir()
	shared := []clipFile{{"s.opus", oggClip("shared")}}
	row := []string{"term\t風\tかぜ\taudio/s.opus\t\t\t"}
	if _, err := audio.Import(ctx, sqlDB, makePack(t, "p1", "ja", "CC0", row, shared), store); err != nil {
		t.Fatal(err)
	}
	if _, err := audio.Import(ctx, sqlDB, makePack(t, "p2", "ja", "CC0", row, shared), store); err != nil {
		t.Fatal(err)
	}
	// p1 drops the clip; p2 still uses it.
	other := []clipFile{{"o.opus", oggClip("other")}}
	if _, err := audio.Import(ctx, sqlDB, makePack(t, "p1", "ja", "CC0", []string{"term\t水\tみず\taudio/o.opus\t\t\t"}, other), store); err != nil {
		t.Fatal(err)
	}
	if got := blobs(t, store); len(got) != 2 {
		t.Errorf("blobs = %v, want the shared and the new one", got)
	}
}

func TestImportLeavesNoPartialBlobOnCopyError(t *testing.T) {
	store := t.TempDir()
	audio.SetBlobFault(func() error { return os.ErrInvalid })
	defer audio.SetBlobFault(nil)
	files, index := twoRowPack(t)
	if _, err := audio.Import(context.Background(), newDB(t), makePack(t, "p1", "ja", "CC0", index, files), store); err == nil {
		t.Fatal("Import succeeded despite the injected error")
	}
	if got := blobs(t, store); len(got) != 0 {
		t.Errorf("left %v", got)
	}
}

func TestImportSkipsUnkeyableZhTerm(t *testing.T) {
	p := makePack(t, "z", "zh", "CC0", []string{"term\t好\txyz\taudio/a.ogg\t\t\t", "term\t好\thǎo\taudio/b.ogg\t\t\t"},
		[]clipFile{{"a.ogg", oggClip("a")}, {"b.ogg", oggClip("b")}})
	res, err := audio.Import(context.Background(), newDB(t), p, t.TempDir())
	if err != nil || res.Clips != 1 || res.Skipped != 1 {
		t.Errorf("Import = %+v, %v", res, err)
	}
}
