package packtype_test

import (
	"regexp"
	"testing"

	"qinqin/internal/packtype"
)

// ident is a registry table name; typeName a manifest type (lowercase
// words joined by hyphens: lemma-rules).
var (
	ident    = regexp.MustCompile(`^[a-z][a-z_]*$`)
	typeName = regexp.MustCompile(`^[a-z]+(-[a-z]+)*$`)
)

// The table's own invariants: every row names a distinct manifest type, a
// registry table and a language shape, and the package fields agree.
func TestTableInvariants(t *testing.T) {
	if len(packtype.All) == 0 {
		t.Fatal("empty table")
	}
	seenType, seenRegistry, seenPackage := map[string]bool{}, map[string]bool{}, map[string]bool{}
	for i, d := range packtype.All {
		if !typeName.MatchString(d.Type) || seenType[d.Type] {
			t.Errorf("row %d: type %q empty, malformed or repeated", i, d.Type)
		}
		seenType[d.Type] = true
		if !ident.MatchString(d.Registry) || seenRegistry[d.Registry] {
			t.Errorf("%s: registry %q empty, malformed or shared", d.Type, d.Registry)
		}
		seenRegistry[d.Registry] = true
		switch d.Languages {
		case packtype.One, packtype.Many, packtype.None:
		default:
			t.Errorf("%s: unknown language shape %d", d.Type, d.Languages)
		}
		if d.Package != "" {
			if seenPackage[d.Package] {
				t.Errorf("%s: package type %q built from two pack types", d.Type, d.Package)
			}
			seenPackage[d.Package] = true
			if d.Languages == packtype.None {
				t.Errorf("%s: a package needs languages", d.Type)
			}
		} else if d.RequiresLexicon || d.OptionalPackage {
			t.Errorf("%s: package flags without a package", d.Type)
		}
		if d.RequiresLexicon && d.Languages != packtype.One {
			t.Errorf("%s: requiring lexicon.<lang> needs one language", d.Type)
		}
		if got, ok := packtype.Lookup(d.Type); !ok || got != d {
			t.Errorf("Lookup(%q) = %+v, %v", d.Type, got, ok)
		}
		if packtype.Index(d.Type) != i {
			t.Errorf("Index(%q) = %d, want %d", d.Type, packtype.Index(d.Type), i)
		}
	}
	if _, ok := packtype.Lookup("nope"); ok || packtype.Index("nope") != -1 {
		t.Error("an unknown type is found")
	}
	types := packtype.Types()
	if len(types) != len(packtype.All) || types[0] != packtype.All[0].Type {
		t.Errorf("Types() = %v", types)
	}
	types[0] = "changed"
	if packtype.Types()[0] == "changed" {
		t.Error("Types() shares its slice")
	}
}

// The dictionary is the one pack type whose package is per language
// (lexicon.<lang>, every dictionary of the language), and the only type
// whose package others require.
func TestLexiconIsTheDictionaryPackage(t *testing.T) {
	d, ok := packtype.Lookup(packtype.Dictionary)
	if !ok || d.Package != packtype.LexiconPackage {
		t.Fatalf("dictionary row %+v", d)
	}
}
