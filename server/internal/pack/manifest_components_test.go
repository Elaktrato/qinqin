package pack_test

import (
	"strings"
	"testing"

	"qinqin/internal/pack"
)

func TestManifestAcceptsComponentsPacks(t *testing.T) {
	m := fixtureManifest
	m.Type, m.Format = pack.TypeComponents, pack.FormatComponentsTSV
	if err := m.Validate(); err != nil {
		t.Errorf("components/components-tsv: Validate = %v, want nil", err)
	}
	m.Type = "nope"
	if err := m.Validate(); err == nil || !strings.Contains(err.Error(), "components") {
		t.Errorf("unknown type error = %v, want it to list components", err)
	}
	m = fixtureManifest
	m.Type, m.Format = pack.TypeComponents, "nope"
	if err := m.Validate(); err == nil || !strings.Contains(err.Error(), "components-tsv") {
		t.Errorf("unknown format error = %v, want it to list components-tsv", err)
	}
}
