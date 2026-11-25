package pack_test

import (
	"strings"
	"testing"

	"qinqin/internal/pack"
)

func themeManifest() pack.Manifest {
	m := fixtureManifest
	m.ID, m.Type, m.Format = "catppuccin", pack.TypeTheme, pack.FormatThemesJSON
	m.Language = ""
	return m
}

// A theme pack teaches no language: it states neither language nor
// languages (docs/contracts/themes/README.md).
func TestManifestAcceptsThemePacks(t *testing.T) {
	if err := themeManifest().Validate(); err != nil {
		t.Fatalf("theme/themes-json: Validate = %v, want nil", err)
	}
	for name, tc := range map[string]struct {
		mutate func(*pack.Manifest)
		want   string
	}{
		"language":     {func(m *pack.Manifest) { m.Language = "zh" }, "language"},
		"languages":    {func(m *pack.Manifest) { m.Languages = []string{"zh"} }, "languages"},
		"other format": {func(m *pack.Manifest) { m.Format = pack.FormatJSON }, "themes-json"},
	} {
		m := themeManifest()
		tc.mutate(&m)
		if err := m.Validate(); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("%s: Validate = %v, want an error naming %q", name, err, tc.want)
		}
	}
	// themes-json belongs to theme packs only.
	m := fixtureManifest
	m.Format = pack.FormatThemesJSON
	if err := m.Validate(); err == nil || !strings.Contains(err.Error(), "theme") {
		t.Errorf("dictionary with themes-json: Validate = %v, want an error naming theme", err)
	}
	m = fixtureManifest
	m.Type = "nope"
	if err := m.Validate(); err == nil || !strings.Contains(err.Error(), "theme") {
		t.Errorf("unknown type error = %v, want it to list theme", err)
	}
}
