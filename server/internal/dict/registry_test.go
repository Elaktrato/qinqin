package dict

import (
	"testing"

	"qinqin/internal/pack"
)

// TestRegistryTerms: the dictionaries row a pack's import writes is
// keyed and credited as the import does it — kanjidic2 and unihan
// register their built-in dictionaries, everything else its own id.
func TestRegistryTerms(t *testing.T) {
	base := pack.Manifest{ID: "my-pack", License: "L", Attribution: "A", Type: pack.TypeDictionary}
	cases := []struct {
		format                       string
		packID, license, attribution string
	}{
		{pack.FormatJSON, "my-pack", "L", "A"},
		{pack.FormatCedict, "my-pack", "L", "A"},
		{pack.FormatJMdict, "my-pack", "L", "A"},
		{pack.FormatUnihan, unihanPackID, "L", "A"},
		{pack.FormatKanjidic2, kanjidic2PackID, kanjidic2License, kanjidic2Attribution},
	}
	for _, c := range cases {
		m := base
		m.Format = c.format
		id, lic, attr := RegistryTerms(m)
		if id != c.packID || lic != c.license || attr != c.attribution {
			t.Errorf("%s: RegistryTerms = %q, %q, %q; want %q, %q, %q", c.format, id, lic, attr, c.packID, c.license, c.attribution)
		}
	}
}
