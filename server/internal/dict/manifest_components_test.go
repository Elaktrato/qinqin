package dict_test

import (
	"strings"
	"testing"

	"qinqin/internal/dict"
)

func TestManifestAcceptsComponentsPacks(t *testing.T) {
	m := fixtureManifest
	m.Type, m.Format = dict.TypeComponents, dict.FormatComponentsTSV
	if err := m.Validate(); err != nil {
		t.Errorf("components/components-tsv: Validate = %v, want nil", err)
	}
	m.Type = "nope"
	if err := m.Validate(); err == nil || !strings.Contains(err.Error(), "components") {
		t.Errorf("unknown type error = %v, want it to list components", err)
	}
	m = fixtureManifest
	m.Type, m.Format = dict.TypeComponents, "nope"
	if err := m.Validate(); err == nil || !strings.Contains(err.Error(), "components-tsv") {
		t.Errorf("unknown format error = %v, want it to list components-tsv", err)
	}
}
