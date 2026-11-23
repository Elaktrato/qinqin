package main

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"qinqin/internal/datapkg"
	"qinqin/internal/lemma"
	"qinqin/internal/lemmapack"
	"qinqin/internal/packs"
)

func lemmaTable(language, version string) string {
	return `{"format": 2, "language": "` + language + `", "version": "` + version + `", "maxDepth": 1,
 "classes": {"w": {"any": true}}, "hints": {},
 "rules": [{"from": "aba", "to": "ar", "reason": "past", "out": "w"}]}`
}

// writeLemmaPack writes a lemma-rules pack under root/<id>.
func writeLemmaPack(t *testing.T, root, id, language, rules string) {
	t.Helper()
	dir := filepath.Join(root, id)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	m, _ := json.Marshal(map[string]any{"id": id, "name": "Rules " + id, "version": "1", "type": "lemma-rules",
		"language": language, "license": "CC0-1.0", "attribution": "Qinqin test fixtures", "format": "rules-json"})
	for name, body := range map[string]string{"manifest.json": string(m), "rules.json": rules, "LICENSE": "CC0\n"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

// At start, a bundled lemma-rules pack is installed when no row of it exists
// and its language has no live pack, refreshed when the stored table differs
// from the bundled one, and left alone after an administrator uninstalled it.
func TestSyncBundledLemmaPacks(t *testing.T) {
	t.Cleanup(func() { lemma.SetInstalled(nil) })
	ctx := context.Background()
	sqlDB, _ := openTestDB(t)
	root := t.TempDir()
	writeLemmaPack(t, root, "xa-lemma", "xa", lemmaTable("xa", "1"))
	missing := filepath.Join(t.TempDir(), "absent")

	var rec logRecorder
	if err := syncBundledLemmaPacks(ctx, sqlDB, []string{missing, root}, rec.logf); err != nil {
		t.Fatal(err)
	}
	if len(rec.lines) != 1 || !strings.Contains(rec.lines[0], "installed") || !strings.Contains(rec.lines[0], "xa-lemma") {
		t.Fatalf("log %q, want one install line", rec.lines)
	}
	if tb := lemma.For("xa"); tb == nil || tb.Version != "1" {
		t.Fatalf("For(xa) = %+v", tb)
	}
	if texts, err := packs.Texts(ctx, sqlDB, "lemma-rules", "xa-lemma"); err != nil || len(texts) != 1 {
		t.Errorf("licence texts %+v, %v", texts, err)
	}

	// Unchanged: nothing to do.
	rec.lines = nil
	if err := syncBundledLemmaPacks(ctx, sqlDB, []string{root}, rec.logf); err != nil || len(rec.lines) != 0 {
		t.Fatalf("unchanged: %v %q", err, rec.lines)
	}

	// An upgraded bundled table replaces the stored one.
	writeLemmaPack(t, root, "xa-lemma", "xa", lemmaTable("xa", "2"))
	if err := syncBundledLemmaPacks(ctx, sqlDB, []string{root}, rec.logf); err != nil {
		t.Fatal(err)
	}
	if len(rec.lines) != 1 || !strings.Contains(rec.lines[0], "updated") {
		t.Errorf("log %q, want one update line", rec.lines)
	}
	if lemma.For("xa").Version != "2" {
		t.Errorf("table after the refresh = %+v", lemma.For("xa"))
	}

	// After an administrator's uninstall it stays uninstalled.
	if err := packs.Uninstall(ctx, sqlDB, "lemma-rules", "xa-lemma"); err != nil {
		t.Fatal(err)
	}
	rec.lines = nil
	if err := syncBundledLemmaPacks(ctx, sqlDB, []string{root}, rec.logf); err != nil || len(rec.lines) != 0 {
		t.Fatalf("after uninstall: %v %q", err, rec.lines)
	}
	if lemma.For("xa") != nil {
		t.Fatal("the sync reinstalled an uninstalled pack")
	}

	// Another live pack of the language: the bundled one is not installed.
	other := t.TempDir()
	writeLemmaPack(t, other, "xb-mine", "xb", lemmaTable("xb", "mine"))
	writeLemmaPack(t, root, "xb-lemma", "xb", lemmaTable("xb", "bundled"))
	if err := syncBundledLemmaPacks(ctx, sqlDB, []string{other}, rec.logf); err != nil {
		t.Fatal(err)
	}
	rec.lines = nil
	if err := syncBundledLemmaPacks(ctx, sqlDB, []string{root}, rec.logf); err != nil {
		t.Fatal(err)
	}
	if lemma.For("xb").Version != "mine" || len(rec.lines) != 0 {
		t.Errorf("xb = %q, log %q: the administrator's pack must stay", lemma.For("xb").Version, rec.lines)
	}
}

// serve loads the installed tables before it listens: a pack installed in
// an earlier run is in effect at once.
func TestLoadLemmaTablesAtStart(t *testing.T) {
	t.Cleanup(func() { lemma.SetInstalled(nil) })
	ctx := context.Background()
	sqlDB, _ := openTestDB(t)
	root := t.TempDir()
	writeLemmaPack(t, root, "xc-lemma", "xc", lemmaTable("xc", "1"))
	if err := syncBundledLemmaPacks(ctx, sqlDB, []string{root}, (&logRecorder{}).logf); err != nil {
		t.Fatal(err)
	}
	lemma.SetInstalled(nil) // a new process
	var rec logRecorder
	loadLemmaTables(ctx, sqlDB, nil, rec.logf)
	if lemma.For("xc") == nil {
		t.Fatalf("installed table not loaded at start (log %q)", rec.lines)
	}
}

// The repository's plugins/data ships the Japanese table as the ja-lemma
// pack, byte for byte the built-in table, and a fresh server installs it.
func TestBundledJapaneseLemmaPack(t *testing.T) {
	t.Cleanup(func() { lemma.SetInstalled(nil) })
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "plugins", "data", "ja-lemma", "rules.json"))
	if err != nil {
		t.Fatal(err)
	}
	builtin, err := lemma.BuiltinFile("ja")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(raw, builtin) {
		t.Fatal("plugins/data/ja-lemma/rules.json differs from server/internal/lemma/tables/ja.json: copy the table")
	}
	ctx := context.Background()
	sqlDB, _ := openTestDB(t)
	root := filepath.Join(t.TempDir(), "data")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	copyDir(t, filepath.Join("..", "..", "..", "plugins", "data", "ja-lemma"), filepath.Join(root, "ja-lemma"))
	if err := syncBundledLemmaPacks(ctx, sqlDB, []string{root}, (&logRecorder{}).logf); err != nil {
		t.Fatal(err)
	}
	hash, found, live, err := lemmapack.Stored(ctx, sqlDB, "ja-lemma")
	if err != nil || !found || !live || hash != lemmapack.Hash(builtin) {
		t.Fatalf("ja-lemma stored %s %v %v %v", hash, found, live, err)
	}
	if lemma.For("ja") == lemma.Builtin("ja") || lemma.For("ja").Version != lemma.Builtin("ja").Version {
		t.Error("ja-lemma not in effect, or not the built-in table's version")
	}
}

func copyDir(t *testing.T, from, to string) {
	t.Helper()
	if err := os.MkdirAll(to, 0o755); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(from)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		b, err := os.ReadFile(filepath.Join(from, e.Name()))
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(to, e.Name()), b, 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

// A startup refresh of a bundled table tells the package builder: the
// lemma-rules package gets a new revision with the new content, as it would
// after an upload (the reconcile alone compares only the manifest terms).
func TestStartupRefreshRebuildsThePackage(t *testing.T) {
	t.Cleanup(func() { lemma.SetInstalled(nil) })
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	sqlDB, _ := openTestDB(t)
	root := t.TempDir()
	writeLemmaPack(t, root, "xa-lemma", "xa", lemmaTable("xa", "1"))
	b, _ := startPackages(ctx, sqlDB, t.TempDir(), t.Logf)
	row := func() datapkg.Row {
		t.Helper()
		wctx, wcancel := context.WithTimeout(ctx, time.Minute)
		defer wcancel()
		if err := b.Wait(wctx); err != nil {
			t.Fatal(err)
		}
		cat, err := b.Registry().Catalogue(ctx, []string{datapkg.AllLanguages}, true)
		if err != nil {
			t.Fatal(err)
		}
		for _, r := range cat.Packages {
			if r.ID == "lemma-rules.xa-lemma" {
				return r
			}
		}
		t.Fatalf("no lemma-rules.xa-lemma in %+v", cat.Packages)
		return datapkg.Row{}
	}
	logf := (&logRecorder{}).logf
	loadLemmaTables(ctx, sqlDB, []string{root}, logf, packs.WithOnChange(b.PackChanged))
	first := row()
	writeLemmaPack(t, root, "xa-lemma", "xa", lemmaTable("xa", "2")) // an upgraded image, same manifest
	loadLemmaTables(ctx, sqlDB, []string{root}, logf, packs.WithOnChange(b.PackChanged))
	second := row()
	if second.Revision != first.Revision+1 || second.ContentHash == first.ContentHash || second.State != "ready" {
		t.Errorf("after the refresh: r%d -> r%d, hash changed %v, %s", first.Revision, second.Revision, second.ContentHash != first.ContentHash, second.State)
	}
}
