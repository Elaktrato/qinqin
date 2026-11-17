package dict_test

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"qinqin/internal/dict"
)

func strokesManifest() dict.Manifest {
	m := fixtureManifest
	m.ID, m.Type, m.Format = "hanzi-writer-strokes", dict.TypeStrokes, dict.FormatStrokesJSONLGz
	m.Language = ""
	m.Languages = []string{"zh", "ja"}
	return m
}

func TestManifestAcceptsStrokesPacks(t *testing.T) {
	if err := strokesManifest().Validate(); err != nil {
		t.Fatalf("strokes/hanzi-writer-jsonl-gz: Validate = %v, want nil", err)
	}
	// A data-only language code (no code pack) is fine, like any manifest language.
	m := strokesManifest()
	m.Languages = []string{"zh", "pt-br"}
	if err := m.Validate(); err != nil {
		t.Errorf("data-only language: Validate = %v, want nil", err)
	}
}

func TestManifestStrokesNeedsLanguages(t *testing.T) {
	for name, tc := range map[string]struct {
		mutate func(*dict.Manifest)
		want   string
	}{
		"none":            {func(m *dict.Manifest) { m.Languages = nil }, "languages"},
		"empty code":      {func(m *dict.Manifest) { m.Languages = []string{"zh", ""} }, "language"},
		"malformed code":  {func(m *dict.Manifest) { m.Languages = []string{"Chinese"} }, "language"},
		"duplicate":       {func(m *dict.Manifest) { m.Languages = []string{"zh", "zh"} }, "twice"},
		"single language": {func(m *dict.Manifest) { m.Language = "zh" }, "languages"},
	} {
		m := strokesManifest()
		tc.mutate(&m)
		if err := m.Validate(); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("%s: Validate = %v, want an error naming %q", name, err, tc.want)
		}
	}
	// languages belongs to strokes packs only.
	m := fixtureManifest
	m.Languages = []string{"zh"}
	if err := m.Validate(); err == nil || !strings.Contains(err.Error(), "languages") {
		t.Errorf("dictionary with languages: Validate = %v, want an error naming languages", err)
	}
}

func TestManifestStrokesUnknownTypeAndFormatListed(t *testing.T) {
	m := fixtureManifest
	m.Type = "nope"
	if err := m.Validate(); err == nil || !strings.Contains(err.Error(), "strokes") {
		t.Errorf("unknown type error = %v, want it to list strokes", err)
	}
	m = fixtureManifest
	m.Format = "nope"
	if err := m.Validate(); err == nil || !strings.Contains(err.Error(), "hanzi-writer-jsonl-gz") {
		t.Errorf("unknown format error = %v, want it to list hanzi-writer-jsonl-gz", err)
	}
}

// TestLoadPackNormalizesStrokesLanguages: codes are trimmed and lowercased
// like a manifest's language, and kept in the manifest's order.
func TestLoadPackNormalizesStrokesLanguages(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), []byte(`{"id":"s","name":"S","version":"1","type":"strokes",
		"languages":[" ZH ","ja"],"license":"Arphic Public License","attribution":"x","format":"hanzi-writer-jsonl-gz"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	p, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatalf("LoadPack: %v", err)
	}
	if !slices.Equal(p.Languages, []string{"zh", "ja"}) {
		t.Errorf("Languages = %q, want [zh ja]", p.Languages)
	}
}
