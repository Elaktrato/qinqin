package main

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"qinqin/internal/datapkg"
)

// TestSeedBuildsDataPackages: seed builds the packages of the seeded packs
// before it returns, one line each; a second seed of the same packs makes
// no new revision.
func TestSeedBuildsDataPackages(t *testing.T) {
	ctx := context.Background()
	sqlDB, _ := openTestDB(t)
	data := t.TempDir()
	root := smallPacks(t)
	var out bytes.Buffer
	if err := seed(ctx, sqlDB, data, []string{root}, &out); err != nil {
		t.Fatalf("seed: %v\n%s", err, out.String())
	}
	if strings.Contains(out.String(), "package ") {
		t.Fatalf("seed printed package lines on success:\n%s", out.String())
	}
	want := []string{"levels.hsk-mini", "levels.jlpt-mini", "lexicon.es", "lexicon.ja", "lexicon.zh"}
	ents, err := os.ReadDir(filepath.Join(data, "packages"))
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, e := range ents {
		if !e.IsDir() {
			if e.Name() != ".lock" { // the registry lock (datapkg/lock.go) is the only file
				t.Errorf("stray file %s", e.Name())
			}
			continue
		}
		got = append(got, e.Name())
		if _, err := os.Stat(filepath.Join(data, "packages", e.Name(), "r1.qqpkg")); err != nil {
			t.Errorf("package file of %s: %v", e.Name(), err)
		}
	}
	if !slices.Equal(got, want) {
		t.Fatalf("package directories %v, want %v", got, want)
	}
	out.Reset()
	if err := seed(ctx, sqlDB, data, []string{root}, &out); err != nil {
		t.Fatalf("second seed: %v", err)
	}
	if _, err := os.Stat(filepath.Join(data, "packages", "lexicon.zh", "r2.qqpkg")); err == nil {
		t.Fatal("an equal re-seed made a new revision")
	}
}

// TestServeStartsPackagesInTheBackground: the builder serve starts
// reconciles on its own; the catalogue says building until it is done.
func TestServeStartsPackagesInTheBackground(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	sqlDB, _ := openTestDB(t)
	root := smallPacks(t)
	if err := seed(ctx, sqlDB, t.TempDir(), []string{root}, &bytes.Buffer{}); err != nil {
		t.Fatal(err)
	}
	data := t.TempDir() // no package files yet: the reconcile builds them
	b := startPackages(ctx, sqlDB, data, t.Logf)
	wctx, wcancel := context.WithTimeout(ctx, time.Minute)
	defer wcancel()
	if err := b.Wait(wctx); err != nil {
		t.Fatal(err)
	}
	cat, err := b.Registry().Catalogue(ctx, []string{datapkg.AllLanguages}, false)
	if err != nil {
		t.Fatal(err)
	}
	if cat.Building || len(cat.Packages) != 5 {
		t.Fatalf("catalogue after the startup reconcile: building %v, %d packages", cat.Building, len(cat.Packages))
	}
	if _, err := os.Stat(filepath.Join(data, "packages", "lexicon.zh", "r1.qqpkg")); err != nil {
		t.Fatal(err)
	}
}

// TestSeedFailsOnAFailedPackageBuild: a package that does not build fails
// seed, naming it (here every build fails: <data>/packages is a file).
func TestSeedFailsOnAFailedPackageBuild(t *testing.T) {
	sqlDB, _ := openTestDB(t)
	root := smallPacks(t)
	data := t.TempDir()
	if err := os.WriteFile(filepath.Join(data, "packages"), []byte("not a directory"), 0o644); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	err := seed(context.Background(), sqlDB, data, []string{root}, &out)
	if err == nil || !strings.Contains(err.Error(), "lexicon.ja") || !strings.Contains(out.String(), "package lexicon.ja: build failed: ") {
		t.Fatalf("seed = %v\n%s", err, out.String())
	}
}
