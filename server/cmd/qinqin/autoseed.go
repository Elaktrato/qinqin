package main

import (
	"bytes"
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"
	"time"

	"qinqin/internal/packs"
)

// demoPacks are the example packs of plugins/data: `qinqin seed` imports
// them, the first-start auto-seed does not.
var demoPacks = map[string]bool{"es-demo": true}

// autoSeedKey is the server_meta key whose value "done" stops serve from
// auto-seeding again on this database.
const autoSeedKey = "packs_auto_seed"

// autoSeedDone reports whether the one-time auto-seed has run (or decided to
// skip) on this database.
func autoSeedDone(ctx context.Context, sqlDB *sql.DB) (bool, error) {
	var v string
	err := sqlDB.QueryRowContext(ctx, `SELECT value FROM server_meta WHERE key = ?`, autoSeedKey).Scan(&v)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("auto-seed: marker: %w", err)
	}
	return v == "done", nil
}

func markAutoSeedDone(ctx context.Context, sqlDB *sql.DB) error {
	if _, err := sqlDB.ExecContext(ctx, `
		INSERT INTO server_meta (key, value) VALUES (?, 'done') ON CONFLICT (key) DO UPDATE SET value = 'done'`, autoSeedKey); err != nil {
		return fmt.Errorf("auto-seed: set marker: %w", err)
	}
	return nil
}

// autoSeedDisabled reports whether QINQIN_AUTO_SEED is 0, false or off.
func autoSeedDisabled(getenv func(string) string) bool {
	switch strings.ToLower(strings.TrimSpace(getenv("QINQIN_AUTO_SEED"))) {
	case "0", "false", "off":
		return true
	}
	return false
}

// autoSeed installs the bundled packs, except the demo packs, at the first
// serve of a fresh instance, so no one has to run `qinqin seed` by hand. It
// runs synchronously before the server listens (nothing else writes then).
//
// "Fresh" means no pack of any type is installed (packs.List is empty) and
// the marker autoSeedKey in server_meta is unset. The marker is set once the
// seed finished, or when an installed pack shows the instance is not fresh,
// so an upgraded or curated instance is never touched and an administrator
// who uninstalled everything is not given the packs back. Nothing is done
// (and no marker set) when QINQIN_AUTO_SEED is 0/false/off or when the roots
// hold no pack.
//
// A failing pack returns an error, with the marker unset: the caller logs it
// and starts the server anyway; the next start retries (imports are
// idempotent), and `qinqin seed` can be run by hand meanwhile. Roots that do
// not exist are skipped.
func autoSeed(ctx context.Context, sqlDB *sql.DB, dataDir string, roots []string, getenv func(string) string, logf func(string, ...any)) error {
	if autoSeedDisabled(getenv) {
		return nil
	}
	if done, err := autoSeedDone(ctx, sqlDB); err != nil || done {
		return err
	}
	installed, err := packs.List(ctx, sqlDB)
	if err != nil {
		return fmt.Errorf("auto-seed: %w", err)
	}
	if len(installed) > 0 {
		return markAutoSeedDone(ctx, sqlDB)
	}
	var found []seedPack
	for _, root := range roots {
		if info, err := os.Stat(root); err != nil || !info.IsDir() {
			continue
		}
		in, err := findPacksIn(root)
		if err != nil {
			return fmt.Errorf("auto-seed: %w", err)
		}
		for _, p := range in {
			if !demoPacks[p.pack.ID] {
				found = append(found, p)
			}
		}
	}
	if len(found) == 0 {
		return nil
	}
	start := time.Now()
	logf("auto-seed: fresh instance, installing %d bundled packs (demo packs excluded; QINQIN_AUTO_SEED=0 turns this off)", len(found))
	if err := seedPacks(ctx, sqlDB, dataDir, found, lineLogger{logf}); err != nil {
		return fmt.Errorf("auto-seed failed (will retry at the next start; or run `qinqin seed`): %w", err)
	}
	if err := markAutoSeedDone(ctx, sqlDB); err != nil {
		return err
	}
	logf("auto-seed: done in %s", time.Since(start).Round(100*time.Millisecond))
	return nil
}

// lineLogger is an io.Writer that logs each line written to it.
type lineLogger struct{ logf func(string, ...any) }

func (l lineLogger) Write(p []byte) (int, error) {
	for _, line := range strings.Split(string(bytes.TrimRight(p, "\n")), "\n") {
		l.logf("auto-seed: %s", line)
	}
	return len(p), nil
}
