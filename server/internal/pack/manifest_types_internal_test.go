package pack

import (
	"strings"
	"testing"
)

// The valid manifest types are exactly the pack-type table's (#172).
func TestManifestTypesFollowThePackTypeTable(t *testing.T) {
	for _, typ := range Types() {
		if !known(typ) {
			t.Errorf("%s is not a manifest type", typ)
		}
	}
	if known("nope") || known("lexicon") {
		t.Error("an unknown type is a manifest type")
	}
	err := Manifest{ID: "x", Name: "x", Version: "1", License: "x", Attribution: "x", Type: "nope", Format: FormatJSON}.Validate()
	for _, typ := range Types() {
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
	lookupPackType = func(typ string) (Descriptor, bool) {
		switch typ {
		case "new-none":
			return Descriptor{Type: typ, Languages: None}, true
		case "new-many":
			return Descriptor{Type: typ, Languages: Many}, true
		case "new-one":
			return Descriptor{Type: typ, Languages: One}, true
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
