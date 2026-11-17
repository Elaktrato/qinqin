package dict_test

import (
	"strings"
	"testing"

	"qinqin/internal/dict"
)

func fontManifest() dict.Manifest {
	m := fixtureManifest
	m.ID, m.Type, m.Format = "noto-sans-sc", dict.TypeFont, dict.FormatFontSlices
	m.Language = ""
	return m
}

// A font pack teaches no language: it states neither language nor
// languages (docs/contracts/fonts/README.md).
func TestManifestAcceptsFontPacks(t *testing.T) {
	if err := fontManifest().Validate(); err != nil {
		t.Fatalf("font/font-slices: Validate = %v, want nil", err)
	}
	for name, tc := range map[string]struct {
		mutate func(*dict.Manifest)
		want   string
	}{
		"language":     {func(m *dict.Manifest) { m.Language = "zh" }, "language"},
		"languages":    {func(m *dict.Manifest) { m.Languages = []string{"zh"} }, "languages"},
		"other format": {func(m *dict.Manifest) { m.Format = dict.FormatJSON }, "font-slices"},
	} {
		m := fontManifest()
		tc.mutate(&m)
		if err := m.Validate(); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("%s: Validate = %v, want an error naming %q", name, err, tc.want)
		}
	}
	m := fixtureManifest
	m.Format = dict.FormatFontSlices
	if err := m.Validate(); err == nil || !strings.Contains(err.Error(), "font") {
		t.Errorf("dictionary with font-slices: Validate = %v, want an error naming font", err)
	}
	m = fixtureManifest
	m.Type = "nope"
	if err := m.Validate(); err == nil || !strings.Contains(err.Error(), "font") {
		t.Errorf("unknown type error = %v, want it to list font", err)
	}
}
