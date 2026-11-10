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

	"qinqin/internal/dict"
	"qinqin/internal/levels"
	"qinqin/internal/sentences"
)

// seedCmd runs `qinqin seed --data <dir> --packs <dir>`.
func seedCmd(args []string, out io.Writer) error {
	fset := flag.NewFlagSet("seed", flag.ContinueOnError)
	data := fset.String("data", defaultData(), "data directory holding the SQLite database (default $QINQIN_DATA or ./data)")
	packs := fset.String("packs", "plugins/data", "directory of seed packs to import")
	if err := fset.Parse(args); err != nil {
		return err
	}
	registerLanguages()
	sqlDB, err := openData(*data)
	if err != nil {
		return err
	}
	defer sqlDB.Close()
	return seed(context.Background(), sqlDB, *packs, out)
}

// seedPack is one pack found under the packs directory.
type seedPack struct {
	dir  string
	pack dict.Pack
}

// importOrder ranks pack types for seeding. Dictionaries — including the
// character data of cedict, unihan, kanjidic2, and jmdict — come first:
// level and sentence packs resolve their forms against existing entries
// and skip the unknown ones, so they must follow. Sentences come last.
var importOrder = map[string]int{
	dict.TypeDictionary: 0,
	dict.TypeLevels:     1,
	dict.TypeSentences:  2,
}

// seed imports every pack under packsDir into sqlDB, dispatching on each
// manifest's type: dictionary to dict.Import, levels to levels.Import,
// sentences to sentences.ImportPack. A pack is any directory holding a
// manifest.json; the walk does not descend into one. Packs import
// dictionaries first, then levels, then sentences, each group in path
// order, and one line per pack goes to out. Imports replace a pack's own
// rows and touch nothing else, so seeding again is safe and leaves the
// counts unchanged. The first failing pack stops the seed, named in the
// error.
func seed(ctx context.Context, sqlDB *sql.DB, packsDir string, out io.Writer) error {
	found, err := findPacks(packsDir)
	if err != nil {
		return err
	}
	if len(found) == 0 {
		return fmt.Errorf("seed: no packs (directories with a manifest.json) under %s", packsDir)
	}
	sort.SliceStable(found, func(i, j int) bool {
		ri, rj := importOrder[found[i].pack.Type], importOrder[found[j].pack.Type]
		if ri != rj {
			return ri < rj
		}
		return found[i].dir < found[j].dir
	})

	for _, p := range found {
		line, err := importPack(ctx, sqlDB, p.pack)
		if err != nil {
			return fmt.Errorf("seed pack %s (%s): %w", p.pack.ID, p.dir, err)
		}
		fmt.Fprintf(out, "%-14s %-10s %s\n", p.pack.ID, p.pack.Type, line)
	}
	return nil
}

// findPacks loads every pack directory under root.
func findPacks(root string) ([]seedPack, error) {
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
		pack, err := dict.LoadPack(path)
		if err != nil {
			return fmt.Errorf("load pack %s: %w", path, err)
		}
		found = append(found, seedPack{dir: path, pack: pack})
		return filepath.SkipDir
	})
	if err != nil {
		return nil, fmt.Errorf("seed: walk %s: %w", root, err)
	}
	return found, nil
}

// importPack dispatches one pack on its manifest type and returns its
// one-line summary.
func importPack(ctx context.Context, sqlDB *sql.DB, pack dict.Pack) (string, error) {
	switch pack.Type {
	case dict.TypeDictionary:
		r, err := dict.Import(ctx, sqlDB, pack)
		if err != nil {
			return "", err
		}
		line := fmt.Sprintf("%d entries, %d senses", r.Entries, r.Senses)
		if r.Skipped > 0 || r.Unconverted > 0 {
			line += fmt.Sprintf(" (skipped %d malformed lines, %d pinyin unconverted)", r.Skipped, r.Unconverted)
		}
		return line, nil
	case dict.TypeLevels:
		r, err := levels.Import(ctx, sqlDB, pack)
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("%d unknown forms skipped", len(r.Skipped)), nil
	case dict.TypeSentences:
		r, err := sentences.ImportPack(ctx, sqlDB, pack)
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("%d unknown words skipped", len(r.Skipped)), nil
	}
	return "", fmt.Errorf("unsupported pack type %q", pack.Type)
}
