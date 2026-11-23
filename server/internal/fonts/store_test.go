package fonts_test

import (
	"context"
	"errors"
	"os"
	"slices"
	"strings"
	"testing"

	"qinqin/internal/dict"
	"qinqin/internal/fonts"
)

var (
	sliceA = woff2("a")
	sliceB = woff2("b")
	sliceC = woff2("c")
)

func sansHans(weight string, s ...sliceSpec) faceSpec {
	return faceSpec{face: "sans", script: "Hans", weight: weight, slices: s}
}

func TestImportStoresSlicesAndRows(t *testing.T) {
	ctx := context.Background()
	sqlDB, store := newDB(t), t.TempDir()
	p := writePack(t, "test-sans",
		sansHans("200 900", sliceSpec{data: sliceA, rng: "U+20-7E"}, sliceSpec{data: sliceB, rng: "U+4E00-4E3F"}),
		faceSpec{face: "kai", script: "Jpan", weight: "400", slices: []sliceSpec{{data: sliceC, rng: "U+3040-30FF"}}})
	r, err := fonts.Import(ctx, sqlDB, p, store)
	if err != nil {
		t.Fatal(err)
	}
	if r.Faces != 2 || r.Slices != 3 {
		t.Errorf("result = %+v", r)
	}
	want := []string{blobName(sliceA), blobName(sliceB), blobName(sliceC)}
	slices.Sort(want)
	if got := blobs(t, store); !slices.Equal(got, want) {
		t.Errorf("blobs = %v, want %v", got, want)
	}
	got, err := os.ReadFile(fonts.BlobPath(store, shaOf(sliceB)))
	if err != nil || string(got) != string(sliceB) {
		t.Errorf("blob B = %q, %v", got, err)
	}
	for _, sha := range []string{shaOf(sliceA), shaOf(sliceC)} {
		if ok, err := fonts.Installed(ctx, sqlDB, sha); !ok || err != nil {
			t.Errorf("Installed(%s) = %v, %v", sha, ok, err)
		}
	}
	if ok, _ := fonts.Installed(ctx, sqlDB, shaOf(woff2("other"))); ok {
		t.Error("an unknown sha is installed")
	}

	// An update of the same pack drops slice B: its file goes, A stays.
	p2 := writePack(t, "test-sans", sansHans("200 900", sliceSpec{data: sliceA, rng: "U+20-7E,U+4E00-4E3F"}))
	if _, err := fonts.Import(ctx, sqlDB, p2, store); err != nil {
		t.Fatal(err)
	}
	if got := blobs(t, store); !slices.Equal(got, []string{blobName(sliceA)}) {
		t.Errorf("after the update blobs = %v", got)
	}
	faces, err := fonts.Faces(ctx, sqlDB)
	if err != nil || len(faces) != 1 || faces[0].Slices[0].UnicodeRange != "U+20-7E,U+4E00-4E3F" {
		t.Fatalf("faces after the update = %+v, %v", faces, err)
	}
}

func TestImportRefusesBadPacks(t *testing.T) {
	ctx := context.Background()
	symlink := func(path string, data []byte) {
		target := path + ".real"
		os.WriteFile(target, data, 0o644)
		if err := os.Symlink(target, path); err != nil {
			t.Skip("no symlinks here")
		}
	}
	for name, tc := range map[string]struct {
		pack func(t *testing.T) dict.Pack
		want string
	}{
		"overlapping ranges": {func(t *testing.T) dict.Pack {
			return writePack(t, "x", sansHans("400", sliceSpec{data: sliceA, rng: "U+20-7E"}, sliceSpec{data: sliceB, rng: "U+7E"}))
		}, "faces.json: overlapping-range at $.faces[0].slices[1].unicodeRange"},
		"not WOFF2": {func(t *testing.T) dict.Pack {
			return writePack(t, "x", sansHans("400", sliceSpec{data: []byte("OTTO-not-woff2"), rng: "U+41"}))
		}, "does not start with wOF2"},
		"wrong hash": {func(t *testing.T) dict.Pack {
			return writePack(t, "x", sansHans("400", sliceSpec{data: sliceA, rng: "U+41", write: func(path string, _ []byte) {
				os.WriteFile(path, sliceB, 0o644)
			}}))
		}, "sha256 does not match"},
		"symlink": {func(t *testing.T) dict.Pack {
			return writePack(t, "x", sansHans("400", sliceSpec{data: sliceA, rng: "U+41", write: symlink}))
		}, "not a regular file"},
		"oversize": {func(t *testing.T) dict.Pack {
			return writePack(t, "x", sansHans("400", sliceSpec{data: append(woff2(""), make([]byte, fonts.MaxSliceBytes)...), rng: "U+41"}))
		}, "exceeds"},
		"missing file": {func(t *testing.T) dict.Pack {
			return writePack(t, "x", sansHans("400", sliceSpec{data: sliceA, rng: "U+41", write: func(string, []byte) {}}))
		}, "no such file"},
	} {
		t.Run(name, func(t *testing.T) {
			sqlDB, store := newDB(t), t.TempDir()
			_, err := fonts.Import(ctx, sqlDB, tc.pack(t), store)
			if !errors.Is(err, dict.ErrInvalidPack) || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("err = %v, want ErrInvalidPack naming %q", err, tc.want)
			}
			if got := blobs(t, store); len(got) != 0 {
				t.Errorf("blobs written: %v", got)
			}
			if faces, _ := fonts.Faces(ctx, sqlDB); len(faces) != 0 {
				t.Errorf("rows written: %+v", faces)
			}
		})
	}
}

func TestImportRefusesAFaceAnotherPackProvides(t *testing.T) {
	ctx := context.Background()
	sqlDB, store := newDB(t), t.TempDir()
	if _, err := fonts.Import(ctx, sqlDB, writePack(t, "first", sansHans("200 900", sliceSpec{data: sliceA, rng: "U+41"})), store); err != nil {
		t.Fatal(err)
	}
	_, err := fonts.Import(ctx, sqlDB, writePack(t, "second", sansHans("400", sliceSpec{data: sliceB, rng: "U+41"})), store)
	if !errors.Is(err, dict.ErrInvalidPack) || !strings.Contains(err.Error(), `"first"`) || !strings.Contains(err.Error(), "sans/Hans 400 normal") {
		t.Fatalf("err = %v, want a refusal naming the face and the pack first", err)
	}
	if got := blobs(t, store); !slices.Equal(got, []string{blobName(sliceA)}) {
		t.Errorf("blobs = %v", got)
	}
	// Another script, or a weight that does not overlap, is a different face.
	if _, err := fonts.Import(ctx, sqlDB, writePack(t, "third", faceSpec{face: "sans", script: "Hant", weight: "400",
		slices: []sliceSpec{{data: sliceB, rng: "U+41"}}}), store); err != nil {
		t.Errorf("another script: %v", err)
	}
	// After an uninstall the face is free again.
	if err := fonts.Uninstall(ctx, sqlDB, "first", store); err != nil {
		t.Fatal(err)
	}
	if _, err := fonts.Import(ctx, sqlDB, writePack(t, "second", sansHans("400", sliceSpec{data: sliceC, rng: "U+41"})), store); err != nil {
		t.Errorf("after uninstalling first: %v", err)
	}
}

func TestUninstallRemovesRowsAndUnsharedBlobs(t *testing.T) {
	ctx := context.Background()
	sqlDB, store := newDB(t), t.TempDir()
	// Two packs share slice A (the same bytes in two faces).
	if _, err := fonts.Import(ctx, sqlDB, writePack(t, "one", sansHans("400", sliceSpec{data: sliceA, rng: "U+41"}, sliceSpec{data: sliceB, rng: "U+42"})), store); err != nil {
		t.Fatal(err)
	}
	if _, err := fonts.Import(ctx, sqlDB, writePack(t, "two", faceSpec{face: "serif", script: "Hans", weight: "400",
		slices: []sliceSpec{{data: sliceA, rng: "U+41"}}}), store); err != nil {
		t.Fatal(err)
	}
	if err := fonts.Uninstall(ctx, sqlDB, "one", store); err != nil {
		t.Fatal(err)
	}
	if got := blobs(t, store); !slices.Equal(got, []string{blobName(sliceA)}) {
		t.Errorf("blobs = %v, want only the shared one", got)
	}
	faces, _ := fonts.Faces(ctx, sqlDB)
	if len(faces) != 1 || faces[0].PackID != "two" {
		t.Errorf("faces = %+v", faces)
	}
	packs, _ := fonts.Packs(ctx, sqlDB)
	if len(packs) != 1 || packs[0].PackID != "two" {
		t.Errorf("packs = %+v", packs)
	}
	if err := fonts.Uninstall(ctx, sqlDB, "one", store); !errors.Is(err, fonts.ErrNotFound) {
		t.Errorf("second uninstall = %v", err)
	}
	if err := fonts.Uninstall(ctx, sqlDB, "two", store); err != nil {
		t.Fatal(err)
	}
	if got := blobs(t, store); len(got) != 0 {
		t.Errorf("blobs after the last uninstall = %v", got)
	}
	// A soft-deleted pack revives on a re-import.
	if _, err := fonts.Import(ctx, sqlDB, writePack(t, "two", sansHans("400", sliceSpec{data: sliceC, rng: "U+41"})), store); err != nil {
		t.Fatal(err)
	}
	if packs, _ := fonts.Packs(ctx, sqlDB); len(packs) != 1 || packs[0].PackID != "two" {
		t.Errorf("revived packs = %+v", packs)
	}
}

// Faces are listed by face (sans, serif, kai), script (Hans, Hant, Jpan),
// style, the lower weight bound, then pack id; slices in file order.
func TestFacesOrder(t *testing.T) {
	ctx := context.Background()
	sqlDB, store := newDB(t), t.TempDir()
	if _, err := fonts.Import(ctx, sqlDB, writePack(t, "b-pack",
		faceSpec{face: "kai", script: "Jpan", weight: "400", slices: []sliceSpec{{data: woff2("1"), rng: "U+41"}}},
		sansHans("700", sliceSpec{data: woff2("2"), rng: "U+42"}, sliceSpec{data: woff2("3"), rng: "U+41"}),
		faceSpec{face: "sans", script: "Jpan", weight: "400", slices: []sliceSpec{{data: woff2("4"), rng: "U+41"}}},
	), store); err != nil {
		t.Fatal(err)
	}
	if _, err := fonts.Import(ctx, sqlDB, writePack(t, "a-pack",
		sansHans("400", sliceSpec{data: woff2("5"), rng: "U+41"}),
		faceSpec{face: "serif", script: "Hans", weight: "400", slices: []sliceSpec{{data: woff2("6"), rng: "U+41"}}},
	), store); err != nil {
		t.Fatal(err)
	}
	faces, err := fonts.Faces(ctx, sqlDB)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, f := range faces {
		got = append(got, f.PackID+":"+f.Key())
	}
	want := []string{"a-pack:sans/Hans 400 normal", "b-pack:sans/Hans 700 normal", "b-pack:sans/Jpan 400 normal",
		"a-pack:serif/Hans 400 normal", "b-pack:kai/Jpan 400 normal"}
	if !slices.Equal(got, want) {
		t.Errorf("order = %v\nwant %v", got, want)
	}
	if s := faces[1].Slices; len(s) != 2 || s[0].Sha != shaOf(woff2("2")) || s[1].Sha != shaOf(woff2("3")) {
		t.Errorf("slice order = %+v", s)
	}
	if faces[0].License != "OFL-1.1" || faces[0].Attribution != "Test faces" || faces[0].Original != "Test sans" {
		t.Errorf("face credits = %+v", faces[0])
	}
	packs, _ := fonts.Packs(ctx, sqlDB)
	if len(packs) != 2 || packs[0].PackID != "a-pack" || packs[0].Notice != "modified" || packs[0].Version != "1" {
		t.Errorf("packs = %+v", packs)
	}
}

func TestCheckPackRefusesOtherTypes(t *testing.T) {
	p := writePack(t, "x", sansHans("400", sliceSpec{data: sliceA, rng: "U+41"}))
	p.Manifest.Type, p.Manifest.Format = dict.TypeTheme, dict.FormatThemesJSON
	if _, err := fonts.CheckPack(p); !errors.Is(err, dict.ErrInvalidPack) {
		t.Errorf("CheckPack(theme) = %v", err)
	}
}

// An import cancelled after its slices were stored (a shutdown, #170)
// leaves no slice behind that no installed pack references.
func TestCancelledImportLeavesNoSlices(t *testing.T) {
	sqlDB, store := newDB(t), t.TempDir()
	ctx, cancel := context.WithCancel(context.Background())
	defer fonts.SetAfterStoreHookForTest(cancel)()
	p := writePack(t, "test-sans", sansHans("200 900", sliceSpec{data: sliceA, rng: "U+20-7E"}, sliceSpec{data: sliceB, rng: "U+4E00-4E3F"}))
	if _, err := fonts.Import(ctx, sqlDB, p, store); err == nil {
		t.Fatal("the cancelled import succeeded")
	}
	if got := blobs(t, store); len(got) != 0 {
		t.Errorf("slices left behind: %v", got)
	}
	if faces, _ := fonts.Faces(context.Background(), sqlDB); len(faces) != 0 {
		t.Errorf("faces registered: %+v", faces)
	}
}
