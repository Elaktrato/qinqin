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

	"qinqin/internal/dict"
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

// defaultPacks is the --packs default: $QINQIN_PACKS (comma-separated; the
// image sets it to the sample packs it ships), or the repo's plugins/data
// followed by plugins/data-audio, then plugins/data-local, when those
// directories exist.
func defaultPacks() []string {
	if p := os.Getenv("QINQIN_PACKS"); p != "" {
		return splitRoots(p)
	}
	roots := []string{"plugins/data"}
	for _, extra := range []string{audioPacks, localPacks} {
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
	pack dict.Pack
}

// importOrder ranks pack types for seeding. Dictionaries — including the
// character data of cedict, unihan, kanjidic2, and jmdict — come first:
// frequency, level and sentence packs refer to existing entries and skip
// the unknown ones, so they must follow. Frequency packs come right after
// the dictionaries; sentences follow; grammar, audio and components packs,
// which refer to no entries at import time, come last.
var importOrder = map[string]int{
	dict.TypeDictionary: 0,
	dict.TypeFrequency:  1,
	dict.TypeLevels:     2,
	dict.TypeSentences:  3,
	dict.TypeGrammar:    4,
	dict.TypeAudio:      5,
	dict.TypeComponents: 6,
}

// seed imports every pack under the roots into sqlDB through
// packs.Import, which dispatches on each manifest's type (audio clips go to
// <dataDir>/audio). A pack is
// any directory holding a manifest.json; the walk does not descend into
// one. Packs import dictionaries first, then frequency packs, levels and
// sentences, each group in path order — so a frequency pack's priority
// (see freq.Import) is that order — and one line per pack goes to out. Imports replace a pack's own
// rows and touch nothing else, so seeding again is safe and leaves the
// counts unchanged. The first failing pack stops the seed, named in the
// error.
func seed(ctx context.Context, sqlDB *sql.DB, dataDir string, roots []string, out io.Writer) error {
	found, err := findPacks(roots)
	if err != nil {
		return err
	}
	if len(found) == 0 {
		return fmt.Errorf("seed: no packs (directories with a manifest.json) under %s", strings.Join(roots, ", "))
	}
	if err := warnEntryIDUsers(ctx, sqlDB, out); err != nil {
		return err
	}
	sort.SliceStable(found, func(i, j int) bool {
		ri, rj := importOrder[found[i].pack.Type], importOrder[found[j].pack.Type]
		if ri != rj {
			return ri < rj
		}
		return found[i].dir < found[j].dir
	})

	for _, p := range found {
		line, err := packs.Import(ctx, sqlDB, p.pack, packs.WithAudioStore(filepath.Join(dataDir, "audio")))
		if err != nil {
			return fmt.Errorf("seed pack %s (%s): %w", p.pack.ID, p.dir, err)
		}
		fmt.Fprintf(out, "%-14s %-10s %s\n", p.pack.ID, p.pack.Type, line)
	}
	return nil
}

// flashcardsPack is the plugin_data namespace of the study rows; its
// card:<id> rows (leftovers since migration 038) store an entryId.
const flashcardsPack = "qinqin-flashcards"

// warnEntryIDUsers prints a WARNING line to out when the database holds
// user edits or flashcards: both store entry ids, and a development
// database from before the dictionary rebuild (migration 017) keeps ids
// that now point at different entries — silently. Nothing is deleted.
func warnEntryIDUsers(ctx context.Context, sqlDB *sql.DB, out io.Writer) error {
	var edits, cards int
	if err := sqlDB.QueryRowContext(ctx, `SELECT COUNT(*) FROM user_edits`).Scan(&edits); err != nil {
		return fmt.Errorf("seed: count user edits: %w", err)
	}
	// Live typed cards (migration 038), plus leftover card rows the
	// migration could not read: both store an entry id.
	if err := sqlDB.QueryRowContext(ctx, `
		SELECT (SELECT COUNT(*) FROM study_cards WHERE deleted_at IS NULL) + (SELECT COUNT(*) FROM plugin_data
		WHERE pack_id = ? AND key LIKE 'card:%' AND deleted_at IS NULL)`, flashcardsPack).Scan(&cards); err != nil {
		return fmt.Errorf("seed: count flashcards: %w", err)
	}
	if edits == 0 && cards == 0 {
		return nil
	}
	fmt.Fprintf(out, "WARNING: this database has %d user edit(s) and %d flashcard(s), which refer to entries by id. "+
		"If it predates the lexicon rebuild (migration 017), those ids now point at different entries: "+
		"delete the data directory (or at least qinqin.db) and seed again.\n", edits, cards)
	return nil
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
