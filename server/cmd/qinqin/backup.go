package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"qinqin/internal/backup"
	"qinqin/internal/db"
)

// backupCmd runs `qinqin backup --out <file|-> [--data <dir>] [--only
// db,books,packs,audio]`: the whole-server backup of the admin UI, for cron and
// `docker exec`. The database is opened read-only and never migrated, so it
// can run beside the server. The archive holds password hashes and sealed
// secrets: store it like QINQIN_SECRET.
func backupCmd(args []string, stdout, stderr io.Writer) error {
	fset := flag.NewFlagSet("backup", flag.ContinueOnError)
	fset.SetOutput(stderr)
	data := fset.String("data", defaultData(), "data directory (default $QINQIN_DATA or ./data)")
	out := fset.String("out", "", "file to write, or - for standard output (required)")
	only := fset.String("only", "", "comma-separated parts: db, books, packs, audio (default all)")
	if err := fset.Parse(args); err != nil {
		return err
	}
	if *out == "" {
		return fmt.Errorf("%w: backup needs --out <file> (or - for standard output)", errUsage)
	}
	var names []string
	if *only != "" {
		names = strings.Split(*only, ",")
	}
	inc, err := backup.ParseInclude(names)
	if err != nil {
		return fmt.Errorf("%w: --only: %v", errUsage, err)
	}
	sqlDB, err := db.OpenReadOnly(filepath.Join(*data, "qinqin.db"))
	if err != nil {
		return err
	}
	defer sqlDB.Close()
	ctx := context.Background()
	meta := backup.Meta{AppVersion: backup.AppVersion, SchemaVersion: backup.SchemaVersion(ctx, sqlDB), Now: time.Now()}
	if inc.DB {
		// The archive itself needs room too when it is written to the data volume.
		var extra int64
		if *out != "-" && backup.SameVolume(*data, filepath.Dir(*out)) {
			extra = backup.EstimateServerBytes(*data, inc)
		}
		if err := backup.CheckSpace(*data, extra); err != nil {
			return fmt.Errorf("backup: %w (the snapshot of the database is written to %s first)", err, filepath.Join(*data, "tmp"))
		}
	}
	if *out == "-" {
		return backup.WriteServer(ctx, sqlDB, *data, inc, stdout, meta)
	}
	dir := filepath.Dir(*out)
	tmp, err := os.CreateTemp(dir, ".qinqin-backup-*")
	if err != nil {
		return fmt.Errorf("backup: %w", err)
	}
	defer os.Remove(tmp.Name())
	if err := backup.WriteServer(ctx, sqlDB, *data, inc, tmp, meta); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmp.Name(), 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmp.Name(), *out); err != nil {
		return fmt.Errorf("backup: %w", err)
	}
	fmt.Fprintf(stderr, "wrote %s (%s)\n", *out, strings.Join(inc.Names(), ", "))
	return nil
}
