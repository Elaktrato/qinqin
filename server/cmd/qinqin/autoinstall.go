package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"

	"qinqin/internal/dict"
	"qinqin/internal/lemmapack"
	"qinqin/internal/packs"
	"qinqin/internal/strokes"
)

// autoInstallStrokes installs the bundled strokes pack at serve start: v0.3
// shipped stroke data unconditionally, so an upgraded install must not lose
// stroke animation until an administrator seeds. It does nothing while any
// strokes pack is installed or after an administrator uninstalled one
// (strokes.AutoInstallOff). The first strokes pack found in the roots (in
// root order, then path order) is imported through packs.Import, licence
// texts included, and one line is logged; the startup reconcile then builds
// its data package. Roots that do not exist are skipped.
func autoInstallStrokes(ctx context.Context, sqlDB *sql.DB, roots []string, logf func(string, ...any)) error {
	if live, err := strokes.Live(ctx, sqlDB); err != nil || live {
		return err
	}
	if off, err := strokes.AutoInstallOff(ctx, sqlDB); err != nil || off {
		return err
	}
	for _, root := range roots {
		if info, err := os.Stat(root); err != nil || !info.IsDir() {
			continue
		}
		found, err := findPacksIn(root)
		if err != nil {
			return fmt.Errorf("strokes auto-install: %w", err)
		}
		for _, p := range found {
			if p.pack.Type != dict.TypeStrokes {
				continue
			}
			line, err := packs.Import(ctx, sqlDB, p.pack)
			if err != nil {
				return fmt.Errorf("strokes auto-install of %s (%s): %w", p.pack.ID, p.dir, err)
			}
			logf("strokes: installed the bundled stroke data %s from %s (%s)", p.pack.ID, p.dir, line)
			return nil
		}
	}
	return nil
}

// syncBundledLemmaPacks keeps the bundled lemma-rules packs (#176) in step
// with the binary's seed roots at serve start. For every lemma-rules pack in
// the roots: when no row of its id exists (live or uninstalled) and no other
// live pack covers its language, it is installed; when its id is live and
// the stored table differs from the bundled rules.json (an upgraded image),
// it is re-imported; an uninstalled one stays uninstalled. Without the
// refresh an upgraded instance would keep a stale Japanese table that masks
// every fix in the binary. Each change is logged in one line; a pack that
// fails is returned as an error after the others ran.
func syncBundledLemmaPacks(ctx context.Context, sqlDB *sql.DB, roots []string, logf func(string, ...any), opts ...packs.Option) error {
	var errs []error
	for _, root := range roots {
		if info, err := os.Stat(root); err != nil || !info.IsDir() {
			continue
		}
		found, err := findPacksIn(root)
		if err != nil {
			errs = append(errs, fmt.Errorf("lemma-rules sync: %w", err))
			continue
		}
		for _, p := range found {
			if p.pack.Type != dict.TypeLemmaRules {
				continue
			}
			if err := syncBundledLemmaPack(ctx, sqlDB, p, logf, opts); err != nil {
				errs = append(errs, fmt.Errorf("lemma-rules sync of %s (%s): %w", p.pack.ID, p.dir, err))
			}
		}
	}
	return errors.Join(errs...)
}

func syncBundledLemmaPack(ctx context.Context, sqlDB *sql.DB, p seedPack, logf func(string, ...any), opts []packs.Option) error {
	raw, _, err := lemmapack.LoadFile(p.pack.Dir)
	if err != nil {
		return err
	}
	hash, found, live, err := lemmapack.Stored(ctx, sqlDB, p.pack.ID)
	switch {
	case err != nil:
		return err
	case found && (!live || hash == lemmapack.Hash(raw)):
		return nil // uninstalled by an administrator, or up to date
	case !found:
		if err := lemmapack.CheckLanguage(ctx, sqlDB, p.pack.ID, p.pack.Language); errors.Is(err, dict.ErrInvalidPack) {
			return nil // the language has another live pack: the administrator's choice stands
		} else if err != nil {
			return err
		}
	}
	line, err := packs.Import(ctx, sqlDB, p.pack, opts...)
	if err != nil {
		return err
	}
	verb := "installed"
	if found {
		verb = "updated"
	}
	logf("lemma-rules: %s the bundled rule table %s from %s (%s)", verb, p.pack.ID, p.dir, line)
	return nil
}

// loadLemmaTables brings the lemmatizer rule tables up at serve start: the
// bundled packs are synced (syncBundledLemmaPacks), then the overlay of
// every live lemma-rules pack is loaded (lemmapack.Reload). opts reach
// packs.Import: serve passes the package builder's hook, so a refreshed
// table also gets a new package revision (the reconcile compares only the
// manifest terms). Failures are logged; the built-in tables keep working.
func loadLemmaTables(ctx context.Context, sqlDB *sql.DB, roots []string, logf func(string, ...any), opts ...packs.Option) {
	if err := syncBundledLemmaPacks(ctx, sqlDB, roots, logf, opts...); err != nil {
		logf("%v", err)
	}
	if err := lemmapack.Reload(ctx, sqlDB); err != nil {
		logf("lemma-rules: loading the installed rule tables: %v (the built-in tables apply)", err)
	}
}
