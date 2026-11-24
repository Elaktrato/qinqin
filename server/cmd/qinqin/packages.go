package main

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"path/filepath"
	"strings"

	"qinqin/internal/datapkg"
)

// packageBuilder is the data package builder of a data directory: files in
// <data>/packages, audio clips read from <data>/audio.
func packageBuilder(sqlDB *sql.DB, dataDir string, logf func(string, ...any)) *datapkg.Builder {
	return datapkg.NewBuilder(datapkg.Registry{
		DB:       sqlDB,
		Dir:      filepath.Join(dataDir, "packages"),
		AudioDir: filepath.Join(dataDir, "audio"),
	}, logf)
}

// startPackages starts the builder for serve and queues the startup
// reconcile (stray .tmp files, expired revisions, tombstones, and builds
// of what is missing or stale); serve does not wait for it. prepare, if
// set, runs first, before the builder builds anything: the startup imports
// that kick packages (the bundled lemma-rules sync) go there, so no build
// sees an import half done (its rows committed, its licence texts not yet)
// and no package gets two revisions at one start; its kicks run after the
// reconcile. done is closed once the builder stopped after ctx ended (a
// build in progress is abandoned: its row keeps its last state and the
// next start's reconcile removes the .tmp file and builds again).
func startPackages(ctx context.Context, sqlDB *sql.DB, dataDir string, logf func(string, ...any), prepare func(*datapkg.Builder)) (b *datapkg.Builder, done <-chan struct{}) {
	b = packageBuilder(sqlDB, dataDir, logf)
	if prepare != nil {
		prepare(b)
	}
	stopped := make(chan struct{})
	go func() {
		b.Run(ctx)
		close(stopped)
	}()
	b.KickReconcile()
	return b, stopped
}

// buildPackages runs the builder until its queue (the kicks of the seeded
// packs and one reconcile) is drained and fails when a package's last build
// failed, with one line per failure. Success prints nothing: seed's output
// stays one line per pack.
func buildPackages(ctx context.Context, b *datapkg.Builder, out io.Writer) error {
	b.KickReconcile()
	runCtx, stop := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() { b.Run(runCtx); close(done) }()
	err := b.Wait(ctx)
	stop()
	<-done
	if err != nil {
		return fmt.Errorf("seed: build data packages: %w", err)
	}
	cat, err := b.Registry().Catalogue(ctx, []string{datapkg.AllLanguages}, true)
	if err != nil {
		return fmt.Errorf("seed: read data packages: %w", err)
	}
	var failed []string
	for _, p := range cat.Packages {
		if p.State != "deleted" && p.Error != "" {
			fmt.Fprintf(out, "package %s: build failed: %s\n", p.ID, p.Error)
			failed = append(failed, p.ID)
		}
	}
	if len(failed) > 0 {
		return fmt.Errorf("seed: data packages failed to build: %s (see the lines above)", strings.Join(failed, ", "))
	}
	return nil
}
