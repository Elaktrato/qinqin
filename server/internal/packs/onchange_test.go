package packs_test

import (
	"context"
	"errors"
	"slices"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/packs"
)

// TestOnChangeAfterCommit: WithOnChange hears (type, registry id, language)
// after an import or an uninstall commits, and nothing after a failure.
func TestOnChangeAfterCommit(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	var got []string
	hear := packs.WithOnChange(func(typ, packID, language string) {
		got = append(got, typ+"/"+packID+"/"+language)
	})

	if _, err := packs.Import(ctx, sqlDB, dictPack(t), hear); err != nil {
		t.Fatal(err)
	}
	if _, err := packs.Import(ctx, sqlDB, levelsPack(t), hear); err != nil {
		t.Fatal(err)
	}
	if err := packs.Uninstall(ctx, sqlDB, "levels", "es-levels", hear); err != nil {
		t.Fatal(err)
	}
	if err := packs.Uninstall(ctx, sqlDB, "levels", "es-levels", hear); !errors.Is(err, packs.ErrNotFound) {
		t.Fatalf("second uninstall: %v", err)
	}
	if err := packs.Uninstall(ctx, sqlDB, "dictionary", "es-test", hear); err != nil {
		t.Fatal(err)
	}
	want := []string{"dictionary/es-test/es", "levels/es-levels/es", "levels/es-levels/es", "dictionary/es-test/es"}
	if !slices.Equal(got, want) {
		t.Fatalf("heard %q, want %q", got, want)
	}
}
