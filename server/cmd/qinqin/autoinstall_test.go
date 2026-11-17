package main

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/packs"
	"qinqin/internal/strokes"
)

// serve installs the bundled strokes pack once: from the first root that has
// one, with its licence texts, one log line; never while a strokes pack is
// live and never after an administrator uninstalled one.
func TestAutoInstallStrokes(t *testing.T) {
	ctx := context.Background()
	sqlDB, _ := openTestDB(t)
	empty, root := t.TempDir(), t.TempDir()
	writeStrokesPack(t, root)
	missing := filepath.Join(t.TempDir(), "absent")

	var rec logRecorder
	if err := autoInstallStrokes(ctx, sqlDB, []string{missing, empty, root}, rec.logf); err != nil {
		t.Fatalf("auto-install: %v", err)
	}
	if len(rec.lines) != 1 || !strings.Contains(rec.lines[0], "hw-strokes") {
		t.Fatalf("log %q, want one line naming the pack", rec.lines)
	}
	if _, ok, err := strokes.Lookup(ctx, sqlDB, "好"); !ok || err != nil {
		t.Fatalf("Lookup after auto-install = %v, %v", ok, err)
	}
	if texts, err := packs.Texts(ctx, sqlDB, "strokes", "hw-strokes"); err != nil || len(texts) != 1 || texts[0].Name != "LICENSE" {
		t.Fatalf("licence texts %+v, %v", texts, err)
	}

	// A live pack: nothing to do, nothing logged.
	rec.lines = nil
	if err := autoInstallStrokes(ctx, sqlDB, []string{root}, rec.logf); err != nil || len(rec.lines) != 0 {
		t.Fatalf("second start: %v %q", err, rec.lines)
	}

	// After an administrator's uninstall it stays uninstalled.
	if err := packs.Uninstall(ctx, sqlDB, "strokes", "hw-strokes"); err != nil {
		t.Fatal(err)
	}
	if err := autoInstallStrokes(ctx, sqlDB, []string{root}, rec.logf); err != nil || len(rec.lines) != 0 {
		t.Fatalf("after uninstall: %v %q", err, rec.lines)
	}
	if live, _ := strokes.Live(ctx, sqlDB); live {
		t.Fatal("auto-install reinstalled an uninstalled pack")
	}

	// No strokes pack in the roots: silent.
	fresh, _ := openTestDB(t)
	if err := autoInstallStrokes(ctx, fresh, []string{empty, missing}, rec.logf); err != nil || len(rec.lines) != 0 {
		t.Fatalf("no pack: %v %q", err, rec.lines)
	}
}
