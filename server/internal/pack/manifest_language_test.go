package pack_test

import (
	"strings"
	"testing"
)

func TestManifestLanguageMustBeAValidCode(t *testing.T) {
	for _, ok := range []string{"es", "pt-br", "zh-hant-tw"} {
		m := fixtureManifest
		m.Language = ok
		if err := m.Validate(); err != nil {
			t.Errorf("language %q: Validate = %v, want nil", ok, err)
		}
	}
	for _, bad := range []string{"Hello!", "pt_br", "spanish", "e", "es-"} {
		m := fixtureManifest
		m.Language = bad
		if err := m.Validate(); err == nil || !strings.Contains(err.Error(), "language") {
			t.Errorf("language %q: Validate = %v, want a language error", bad, err)
		}
	}
}
