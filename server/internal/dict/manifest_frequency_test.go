package dict_test

import (
	"strings"
	"testing"

	"qinqin/internal/dict"
)

func TestManifestAcceptsFrequencyPacks(t *testing.T) {
	for _, format := range []string{"yomitan-freq", "freq-csv"} {
		m := fixtureManifest
		m.Type, m.Format = "frequency", format
		if err := m.Validate(); err != nil {
			t.Errorf("frequency/%s: Validate = %v, want nil", format, err)
		}
		for name, mutate := range map[string]func(*dict.Manifest){
			"language":    func(m *dict.Manifest) { m.Language = "" },
			"license":     func(m *dict.Manifest) { m.License = "" },
			"attribution": func(m *dict.Manifest) { m.Attribution = "" },
		} {
			bad := m
			mutate(&bad)
			if err := bad.Validate(); err == nil || !strings.Contains(err.Error(), name) {
				t.Errorf("frequency/%s without %s: Validate = %v, want an error naming it", format, name, err)
			}
		}
	}
}

func TestManifestEnumErrorsListEveryValue(t *testing.T) {
	m := fixtureManifest
	m.Type = "nope"
	err := m.Validate()
	if err == nil || !strings.Contains(err.Error(), "frequency") {
		t.Errorf("unknown type error = %v, want it to list frequency", err)
	}
	m = fixtureManifest
	m.Format = "nope"
	err = m.Validate()
	if err == nil || !strings.Contains(err.Error(), "yomitan-freq") || !strings.Contains(err.Error(), "freq-csv") {
		t.Errorf("unknown format error = %v, want it to list yomitan-freq and freq-csv", err)
	}
}
