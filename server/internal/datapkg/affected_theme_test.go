package datapkg_test

import (
	"context"
	"testing"

	"qinqin/internal/datapkg"
	"qinqin/internal/pack"
)

// Theme packs are served by GET /api/themes, never as a data package: an
// import or uninstall kicks no package build.
func TestThemePackKicksNoPackage(t *testing.T) {
	if ids := datapkg.AffectedIDs(context.Background(), nil, pack.TypeTheme, "catppuccin", ""); len(ids) != 0 {
		t.Fatalf("AffectedIDs(theme) = %v, want none", ids)
	}
}
