package images_test

import (
	"context"
	"os"
	"strings"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/images"
	"qinqin/internal/pack"
)

// TestBuiltPacks imports the packs scripts/prepare-images-pack.mjs built, when
// QINQIN_IMAGES_PACKS names their directories (comma separated): every real
// OpenMoji and Mulberry picture must pass CheckSVG, and every pack imports.
// It is skipped without the variable (the packs are built, not committed).
func TestBuiltPacks(t *testing.T) {
	dirs := os.Getenv("QINQIN_IMAGES_PACKS")
	if dirs == "" {
		t.Skip("QINQIN_IMAGES_PACKS is not set")
	}
	sqlDB := dbtest.Open(t)
	for _, dir := range strings.Split(dirs, ",") {
		p, err := pack.LoadPack(dir)
		if err != nil {
			t.Fatalf("%s: %v", dir, err)
		}
		r, err := images.Import(context.Background(), sqlDB, p)
		if err != nil {
			t.Fatalf("%s: %v", dir, err)
		}
		t.Logf("%s: %d pictures, %d mappings", p.ID, r.Pictures, r.Mappings)
	}
}
