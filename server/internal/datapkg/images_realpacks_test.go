package datapkg_test

import (
	"context"
	"os"
	"strings"
	"testing"

	"qinqin/internal/datapkg"
	"qinqin/internal/dbtest"
	"qinqin/internal/pack"
	"qinqin/internal/packs"
)

// maxImagesPackageBytes is the size budget of one images package file
// (#274, plan ruling 4): the web downloads it in the background.
const maxImagesPackageBytes = 4 << 20

// TestBuiltImagesPackages builds the images packages of the packs
// scripts/prepare-images-pack.mjs built, when QINQIN_IMAGES_PACKS names their
// directories (comma separated), and holds each file to the size budget. It
// logs the sizes the plan reports; skipped without the variable.
func TestBuiltImagesPackages(t *testing.T) {
	dirs := os.Getenv("QINQIN_IMAGES_PACKS")
	if dirs == "" {
		t.Skip("QINQIN_IMAGES_PACKS is not set")
	}
	ctx := context.Background()
	sqlDB := dbtest.Open(t)
	for _, dir := range strings.Split(dirs, ",") {
		p, err := pack.LoadPack(dir)
		if err != nil {
			t.Fatalf("%s: %v", dir, err)
		}
		if _, err := packs.Import(ctx, sqlDB, p); err != nil {
			t.Fatalf("%s: %v", dir, err)
		}
	}
	specs, err := datapkg.Plan(ctx, sqlDB)
	if err != nil {
		t.Fatal(err)
	}
	for _, spec := range specs {
		if spec.Type != datapkg.TypeImages {
			continue
		}
		b, err := datapkg.Build(ctx, sqlDB, spec, datapkg.BuildMeta{InstanceID: instanceID, Revision: 1, Now: builtAt}, t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		t.Logf("%s: %d bytes", spec.ID, b.Bytes)
		if b.Bytes > maxImagesPackageBytes {
			t.Errorf("%s: %d bytes, over the %d byte budget", spec.ID, b.Bytes, maxImagesPackageBytes)
		}
	}
}
