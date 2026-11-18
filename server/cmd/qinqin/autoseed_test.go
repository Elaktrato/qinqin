package main

import (
	"context"
	"database/sql"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/packs"
)

// autoSeedRoot builds a pack root with the real-pack stand-ins ja-mini and
// zh-mini, the demo es-demo and a strokes pack.
func autoSeedRoot(t *testing.T) string {
	t.Helper()
	root := smallPacks(t) // es-demo, ja-mini, zh-mini, hsk-mini, jlpt-mini
	writeStrokesPack(t, root)
	return root
}

func installedIDs(t *testing.T, sqlDB *sql.DB) map[string]bool {
	t.Helper()
	list, err := packs.List(context.Background(), sqlDB)
	if err != nil {
		t.Fatal(err)
	}
	ids := map[string]bool{}
	for _, p := range list {
		ids[p.PackID] = true
	}
	return ids
}

func noEnv(string) string { return "" }

func TestAutoSeedFreshInstanceSkipsDemos(t *testing.T) {
	ctx := context.Background()
	sqlDB, dir := openTestDB(t)
	root := autoSeedRoot(t)
	var rec logRecorder
	if err := autoSeed(ctx, sqlDB, dir, []string{root}, noEnv, rec.logf); err != nil {
		t.Fatalf("autoSeed: %v", err)
	}
	ids := installedIDs(t, sqlDB)
	for _, want := range []string{"ja-mini", "zh-mini", "hsk-mini", "jlpt-mini", "hw-strokes"} {
		if !ids[want] {
			t.Errorf("%s not installed: %v", want, ids)
		}
	}
	for _, demo := range []string{"es-demo", "zh-grammar-demo"} {
		if ids[demo] {
			t.Errorf("demo pack %s installed", demo)
		}
	}
	// start line, one line per pack (5), end line
	if len(rec.lines) != 7 || !strings.Contains(rec.lines[0], "auto-seed") || !strings.Contains(rec.lines[len(rec.lines)-1], "auto-seed") {
		t.Errorf("log lines %q", rec.lines)
	}
	if done, _ := autoSeedDone(ctx, sqlDB); !done {
		t.Error("marker not set")
	}
}

func TestAutoSeedRunsOnce(t *testing.T) {
	ctx := context.Background()
	sqlDB, dir := openTestDB(t)
	root := autoSeedRoot(t)
	if err := autoSeed(ctx, sqlDB, dir, []string{root}, noEnv, func(string, ...any) {}); err != nil {
		t.Fatal(err)
	}
	// Uninstall everything on purpose: the instance looks fresh, must stay empty.
	list, _ := packs.List(ctx, sqlDB)
	for _, p := range list {
		if err := packs.Uninstall(ctx, sqlDB, p.Type, p.PackID); err != nil {
			t.Fatalf("uninstall %s: %v", p.PackID, err)
		}
	}
	var rec logRecorder
	if err := autoSeed(ctx, sqlDB, dir, []string{root}, noEnv, rec.logf); err != nil || len(rec.lines) != 0 {
		t.Fatalf("second run: %v %q", err, rec.lines)
	}
	if ids := installedIDs(t, sqlDB); len(ids) != 0 {
		t.Fatalf("reinstalled %v", ids)
	}
}

func TestAutoSeedLeavesAnExistingInstanceAlone(t *testing.T) {
	ctx := context.Background()
	sqlDB, dir := openTestDB(t)
	root := autoSeedRoot(t)
	one := filepath.Join(t.TempDir(), "x")
	copyTree(t, filepath.Join(root, "es-demo"), one)
	if err := seed(ctx, sqlDB, dir, []string{one}, io.Discard); err != nil {
		t.Fatal(err)
	}
	var rec logRecorder
	if err := autoSeed(ctx, sqlDB, dir, []string{root}, noEnv, rec.logf); err != nil {
		t.Fatal(err)
	}
	if ids := installedIDs(t, sqlDB); len(ids) != 1 || !ids["es-demo"] {
		t.Fatalf("installed %v, want only es-demo", ids)
	}
	if done, _ := autoSeedDone(ctx, sqlDB); !done {
		t.Error("marker not set after skipping")
	}
}

func TestAutoSeedOptOut(t *testing.T) {
	for _, v := range []string{"0", "false", "OFF", "Off"} {
		ctx := context.Background()
		sqlDB, dir := openTestDB(t)
		var rec logRecorder
		getenv := func(k string) string {
			if k == "QINQIN_AUTO_SEED" {
				return v
			}
			return ""
		}
		if err := autoSeed(ctx, sqlDB, dir, []string{autoSeedRoot(t)}, getenv, rec.logf); err != nil {
			t.Fatal(err)
		}
		if ids := installedIDs(t, sqlDB); len(ids) != 0 || len(rec.lines) != 0 {
			t.Errorf("QINQIN_AUTO_SEED=%s: installed %v, log %q", v, ids, rec.lines)
		}
		if done, _ := autoSeedDone(ctx, sqlDB); done {
			t.Errorf("QINQIN_AUTO_SEED=%s set the marker", v)
		}
	}
}

func TestAutoSeedFailureKeepsMarkerUnset(t *testing.T) {
	ctx := context.Background()
	sqlDB, dir := openTestDB(t)
	root := t.TempDir()
	bad := filepath.Join(root, "no-license")
	if err := os.MkdirAll(bad, 0o755); err != nil {
		t.Fatal(err)
	}
	m := `{"id":"no-license","name":"x","version":"1","type":"dictionary","language":"es","format":"json"}`
	if err := os.WriteFile(filepath.Join(bad, "manifest.json"), []byte(m), 0o644); err != nil {
		t.Fatal(err)
	}
	var rec logRecorder
	err := autoSeed(ctx, sqlDB, dir, []string{root}, noEnv, rec.logf)
	if err == nil || !strings.Contains(err.Error(), "no-license") {
		t.Fatalf("err = %v, want one naming no-license", err)
	}
	if done, _ := autoSeedDone(ctx, sqlDB); done {
		t.Error("marker set after a failure")
	}
}

func TestAutoSeedWithoutPacksIsSilent(t *testing.T) {
	ctx := context.Background()
	sqlDB, dir := openTestDB(t)
	var rec logRecorder
	roots := []string{filepath.Join(t.TempDir(), "absent"), t.TempDir()}
	if err := autoSeed(ctx, sqlDB, dir, roots, noEnv, rec.logf); err != nil || len(rec.lines) != 0 {
		t.Fatalf("%v %q", err, rec.lines)
	}
	if done, _ := autoSeedDone(ctx, sqlDB); done {
		t.Error("marker set although nothing was found")
	}
}

func TestManualSeedStillImportsDemos(t *testing.T) {
	sqlDB, dir := openTestDB(t)
	if err := seed(context.Background(), sqlDB, dir, []string{smallPacks(t)}, io.Discard); err != nil {
		t.Fatal(err)
	}
	if !installedIDs(t, sqlDB)["es-demo"] {
		t.Fatal("seed skipped es-demo")
	}
}
