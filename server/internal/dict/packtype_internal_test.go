package dict

import (
	"maps"
	"slices"
	"strings"
	"testing"

	"qinqin/internal/packtype"
)

// The valid manifest types are exactly the pack-type table's (#172).
func TestManifestTypesFollowThePackTypeTable(t *testing.T) {
	got := slices.Sorted(maps.Keys(manifestTypes))
	want := packtype.Types()
	slices.Sort(want)
	if !slices.Equal(got, want) {
		t.Errorf("manifest types %v, table %v", got, want)
	}
	err := Manifest{ID: "x", Name: "x", Version: "1", License: "x", Attribution: "x", Type: "nope", Format: FormatJSON}.Validate()
	for _, typ := range packtype.Types() {
		if err == nil || !strings.Contains(err.Error(), typ) {
			t.Errorf("unknown type error %v does not list %s", err, typ)
		}
	}
}

// A new type validates its languages by the table's language shape, not
// by its name (#172): a None type states neither, a Many type languages.
func TestLanguagesFollowTheTableShape(t *testing.T) {
	old := lookupPackType
	t.Cleanup(func() { lookupPackType = old })
	lookupPackType = func(typ string) (packtype.Descriptor, bool) {
		switch typ {
		case "new-none":
			return packtype.Descriptor{Type: typ, Languages: packtype.None}, true
		case "new-many":
			return packtype.Descriptor{Type: typ, Languages: packtype.Many}, true
		case "new-one":
			return packtype.Descriptor{Type: typ, Languages: packtype.One}, true
		}
		return old(typ)
	}
	for _, c := range []struct {
		name string
		m    Manifest
		ok   bool
	}{
		{"none, nothing", Manifest{Type: "new-none"}, true},
		{"none, a language", Manifest{Type: "new-none", Language: "ja"}, false},
		{"none, languages", Manifest{Type: "new-none", Languages: []string{"ja"}}, false},
		{"many, languages", Manifest{Type: "new-many", Languages: []string{"ja", "zh"}}, true},
		{"many, a language", Manifest{Type: "new-many", Language: "ja"}, false},
		{"many, nothing", Manifest{Type: "new-many"}, false},
		{"one, a language", Manifest{Type: "new-one", Language: "ja"}, true},
		{"one, languages", Manifest{Type: "new-one", Languages: []string{"ja"}}, false},
	} {
		if err := c.m.validateLanguages(); (err == nil) != c.ok {
			t.Errorf("%s: %v", c.name, err)
		}
	}
}
