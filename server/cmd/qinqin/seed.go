package main

import (
	"context"
	"database/sql"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"qinqin/internal/pack"
	"qinqin/internal/packs"
)

// seedCmd runs `qinqin seed --data <dir> --packs <dir>[,<dir>...]`.
func seedCmd(args []string, out io.Writer) error {
	fset := flag.NewFlagSet("seed", flag.ContinueOnError)
	data := fset.String("data", defaultData(), "data directory holding the SQLite database (default $QINQIN_DATA or ./data)")
	packs := rootsFlag{roots: defaultPacks()}
	fset.Var(&packs, "packs", "directories of seed packs to import: comma-separated and/or repeated (default $QINQIN_PACKS, or plugins/data, plugins/data-audio and plugins/data-local when those exist)")
	if err := fset.Parse(args); err != nil {
		return err
	}
	registerLanguages()
	sqlDB, err := openDataForSeed(*data)
	if err != nil {
		return err
	}
	defer sqlDB.Close()
	return seed(context.Background(), sqlDB, *data, packs.roots, out)
}

// localPacks is the second default pack root, for packs that stay out of
// the repo (the root .gitignore lists it); it is used only when it exists.
const localPacks = "plugins/data-local"

// audioPacks is the default root of redistributable audio fetched by the
// maintainer scripts (gitignored for size); it is used only when it exists.
const audioPacks = "plugins/data-audio"

// strokePacks is the default root of the stroke-order data pack built by
// scripts/prepare-strokes-pack.mjs (gitignored for size); it is used only
// when it exists.
const strokePacks = "plugins/data-strokes"

// imagePacks is the default root of the images packs built by
// scripts/prepare-images-pack.mjs (CC BY-SA 4.0 pictures, gitignored for
// size, never embedded in the binary); it is used only when it exists.
const imagePacks = "plugins/data-images"

// defaultPacks is the --packs default: $QINQIN_PACKS (comma-separated; the
// image sets it to the packs it ships), or the repo's plugins/data followed
// by plugins/data-audio, plugins/data-strokes, plugins/data-images, then
// plugins/data-local, when those directories exist.
func defaultPacks() []string {
	if p := os.Getenv("QINQIN_PACKS"); p != "" {
		return splitRoots(p)
	}
	roots := []string{"plugins/data"}
	for _, extra := range []string{audioPacks, strokePacks, imagePacks, localPacks} {
		if info, err := os.Stat(extra); err == nil && info.IsDir() {
			roots = append(roots, extra)
		}
	}
	return roots
}

func splitRoots(s string) []string {
	var roots []string
	for _, r := range strings.Split(s, ",") {
		if r = strings.TrimSpace(r); r != "" {
			roots = append(roots, r)
		}
	}
	return roots
}

// rootsFlag is the --packs flag: every use adds its comma-separated
// directories, and the first use replaces the default roots.
type rootsFlag struct {
	roots []string
	set   bool
}

func (f *rootsFlag) String() string { return strings.Join(f.roots, ",") }

func (f *rootsFlag) Set(v string) error {
	if !f.set {
		f.roots, f.set = nil, true
	}
	f.roots = append(f.roots, splitRoots(v)...)
	return nil
}

// seedPack is one pack found under the packs directory.
type seedPack struct {
	dir  string
	pack pack.Pack
}

// importRank ranks pack types for seeding: the pack-type table's order
// (internal/pack). Dictionaries — including the character data of
// cedict, unihan, kanjidic2, and jmdict — come first: frequency, level and
// sentence packs refer to existing entries and skip the unknown ones, so
// they must follow; the types that refer to no entries at import time come
// last.
func importRank(typ string) int { return pack.Index(typ) }

// seed imports every pack under the roots into sqlDB through
// packs.Import, which dispatches on each manifest's type (audio clips go to
// <dataDir>/audio). A pack is
// any directory holding a manifest.json; the walk does not descend into
// one. Packs import dictionaries first, then frequency packs, levels and
// sentences, each group in path order — so a frequency pack's priority
// (see freq.Import) is that order — and one line per pack goes to out. Imports replace a pack's own
// rows and touch nothing else, so seeding again is safe and leaves the
// counts unchanged. The first failing pack stops the seed, named in the
// error. Then the data packages of the seeded packs are built (and any
// other package a reconcile finds missing or stale) before seed returns.
func seed(ctx context.Context, sqlDB *sql.DB, dataDir string, roots []string, out io.Writer) error {
	found, err := findPacks(roots)
	if err != nil {
		return err
	}
	if len(found) == 0 {
		return fmt.Errorf("seed: no packs (directories with a manifest.json) under %s", strings.Join(roots, ", "))
	}
	return seedPacks(ctx, sqlDB, dataDir, found, out)
}

// seedPacks imports the found packs in seed's order (see seed) and builds
// the data packages afterwards. The caller decides which packs are in
// found.
func seedPacks(ctx context.Context, sqlDB *sql.DB, dataDir string, found []seedPack, out io.Writer) error {
	sort.SliceStable(found, func(i, j int) bool {
		ri, rj := importRank(found[i].pack.Type), importRank(found[j].pack.Type)
		if ri != rj {
			return ri < rj
		}
		return found[i].dir < found[j].dir
	})

	// Every import kicks its data packages; they build once, after the
	// imports (kicks of one id coalesce), and seed waits for them.
	builder := packageBuilder(sqlDB, dataDir, func(format string, args ...any) { fmt.Fprintf(out, format+"\n", args...) })
	for _, p := range found {
		line, err := packs.Import(ctx, sqlDB, p.pack, packs.WithAudioStore(filepath.Join(dataDir, "audio")), packs.WithFontStore(filepath.Join(dataDir, "fonts")),
			packs.WithOnChange(builder.PackChanged))
		if err != nil {
			return fmt.Errorf("seed pack %s (%s): %w", p.pack.ID, p.dir, err)
		}
		fmt.Fprintf(out, "%-14s %-10s %s\n", p.pack.ID, p.pack.Type, line)
	}
	return buildPackages(ctx, builder, out)
}

// findPacks loads every pack directory under each of roots; a root that
// does not exist is an error.
func findPacks(roots []string) ([]seedPack, error) {
	var found []seedPack
	for _, root := range roots {
		packs, err := findPacksIn(root)
		if err != nil {
			return nil, err
		}
		found = append(found, packs...)
	}
	return found, nil
}

func findPacksIn(root string) ([]seedPack, error) {
	var found []seedPack
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !d.IsDir() {
			return nil
		}
		if _, err := os.Stat(filepath.Join(path, "manifest.json")); err != nil {
			return nil // not a pack; keep walking
		}
		pk, err := pack.LoadPack(path)
		if err != nil {
			return fmt.Errorf("load pack %s: %w", path, err)
		}
		found = append(found, seedPack{dir: path, pack: pk})
		return filepath.SkipDir
	})
	if err != nil {
		return nil, fmt.Errorf("seed: walk %s: %w", root, err)
	}
	return found, nil
}
