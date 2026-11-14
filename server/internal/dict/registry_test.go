package dict

import "testing"

// TestRegistryTerms: the dictionaries row a pack's import writes is
// keyed and credited as the import does it — kanjidic2 and unihan
// register their built-in dictionaries, everything else its own id.
func TestRegistryTerms(t *testing.T) {
	base := Manifest{ID: "my-pack", License: "L", Attribution: "A", Type: TypeDictionary}
	cases := []struct {
		format                       string
		packID, license, attribution string
	}{
		{FormatJSON, "my-pack", "L", "A"},
		{FormatCedict, "my-pack", "L", "A"},
		{FormatJMdict, "my-pack", "L", "A"},
		{FormatUnihan, unihanPackID, "L", "A"},
		{FormatKanjidic2, kanjidic2PackID, kanjidic2License, kanjidic2Attribution},
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
