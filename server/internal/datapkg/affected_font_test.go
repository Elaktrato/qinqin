package datapkg_test

import (
	"context"
	"testing"

	"qinqin/internal/datapkg"
	"qinqin/internal/dict"
)

// Font packs are served by GET /api/fonts and /fonts/{file}, never as a
// data package: an import or uninstall kicks no package build (the
// onChange hook still fires; packs_font_test.go).
func TestFontPackKicksNoPackage(t *testing.T) {
	if ids := datapkg.AffectedIDs(context.Background(), nil, dict.TypeFont, "noto-sans-sc", ""); len(ids) != 0 {
		t.Fatalf("AffectedIDs(font) = %v, want none", ids)
	}
}
