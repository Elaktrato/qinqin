package main

import (
	"context"
	"database/sql"
	"fmt"
	"os"

	"qinqin/internal/dict"
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
