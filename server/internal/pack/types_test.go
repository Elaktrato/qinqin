package pack_test

import (
	"regexp"
	"testing"

	"qinqin/internal/pack"
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
	if len(pack.All) == 0 {
		t.Fatal("empty table")
	}
	seenType, seenRegistry, seenPackage := map[string]bool{}, map[string]bool{}, map[string]bool{}
	for i, d := range pack.All {
		if !typeName.MatchString(d.Type) || seenType[d.Type] {
			t.Errorf("row %d: type %q empty, malformed or repeated", i, d.Type)
		}
		seenType[d.Type] = true
		if !ident.MatchString(d.Registry) || seenRegistry[d.Registry] {
			t.Errorf("%s: registry %q empty, malformed or shared", d.Type, d.Registry)
		}
		seenRegistry[d.Registry] = true
		switch d.Languages {
		case pack.One, pack.Many, pack.None:
		default:
			t.Errorf("%s: unknown language shape %d", d.Type, d.Languages)
		}
		if d.Package != "" {
			if seenPackage[d.Package] {
				t.Errorf("%s: package type %q built from two pack types", d.Type, d.Package)
			}
			seenPackage[d.Package] = true
			if d.Languages == pack.None {
				t.Errorf("%s: a package needs languages", d.Type)
			}
		} else if d.RequiresLexicon || d.OptionalPackage {
			t.Errorf("%s: package flags without a package", d.Type)
		}
		if d.RequiresLexicon && d.Languages != pack.One {
			t.Errorf("%s: requiring lexicon.<lang> needs one language", d.Type)
		}
		if got, ok := pack.Lookup(d.Type); !ok || got != d {
			t.Errorf("Lookup(%q) = %+v, %v", d.Type, got, ok)
		}
		if pack.Index(d.Type) != i {
			t.Errorf("Index(%q) = %d, want %d", d.Type, pack.Index(d.Type), i)
		}
	}
	if _, ok := pack.Lookup("nope"); ok || pack.Index("nope") != -1 {
		t.Error("an unknown type is found")
	}
	types := pack.Types()
	if len(types) != len(pack.All) || types[0] != pack.All[0].Type {
		t.Errorf("Types() = %v", types)
	}
	types[0] = "changed"
	if pack.Types()[0] == "changed" {
		t.Error("Types() shares its slice")
	}
}

// The dictionary is the one pack type whose package is per language
// (lexicon.<lang>, every dictionary of the language), and the only type
// whose package others require.
func TestLexiconIsTheDictionaryPackage(t *testing.T) {
	d, ok := pack.Lookup(pack.TypeDictionary)
	if !ok || d.Package != pack.LexiconPackage {
		t.Fatalf("dictionary row %+v", d)
	}
}
