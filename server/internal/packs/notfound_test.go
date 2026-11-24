package packs_test

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/pack"
	"qinqin/internal/packs"
)

// Every pack type's uninstall reports a pack that is not installed with an
// error that is a pack.ErrNotFound, so Uninstall needs one check (#192). The
// types come from the handler table, so a new type is checked too.
func TestEveryNotFoundErrorIsPackNotFound(t *testing.T) {
	ctx := context.Background()
	sqlDB := dbtest.Open(t)
	stores := t.TempDir()
	errs := packs.UninstallErrorsForTest(ctx, sqlDB, filepath.Join(stores, "audio"), filepath.Join(stores, "fonts"))
	if len(errs) != len(pack.All) {
		t.Errorf("%d handlers, %d types", len(errs), len(pack.All))
	}
	for typ, err := range errs {
		if !errors.Is(err, pack.ErrNotFound) {
			t.Errorf("%s: uninstall of a pack that is not installed: %v is not a pack.ErrNotFound", typ, err)
		}
		if err := packs.Uninstall(ctx, sqlDB, typ, "not-installed", packs.WithAudioStore(filepath.Join(stores, "audio")),
			packs.WithFontStore(filepath.Join(stores, "fonts"))); !errors.Is(err, packs.ErrNotFound) {
			t.Errorf("%s: Uninstall = %v, want packs.ErrNotFound", typ, err)
		}
	}
}
