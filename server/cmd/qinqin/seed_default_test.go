package main

import (
	"io"
	"path/filepath"
	"testing"
)

// Inside the container the sample packs live at an absolute path, so
// `qinqin seed` with no --packs must honor $QINQIN_PACKS instead of
// the repo-relative plugins/data default.
func TestSeedPacksDefaultsFromEnv(t *testing.T) {
	t.Setenv("QINQIN_PACKS", smallPacks(t))
	dir := t.TempDir()
	if err := seedCmd([]string{"--data", dir}, io.Discard); err != nil {
		t.Fatalf("seed with $QINQIN_PACKS and no --packs: %v", err)
	}
	if _, err := filepath.Glob(filepath.Join(dir, "qinqin.db")); err != nil {
		t.Fatal(err)
	}
}
