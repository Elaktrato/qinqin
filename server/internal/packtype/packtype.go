// Package packtype is the one table of data pack types (#172): every
// manifest type the server imports, with where its live packs are
// registered, which languages it states, whether an admin upload may install
// it, the data package it builds and whether GET /api/plugins still lists
// it. Every place that lists or switches over pack types derives from All or
// is checked against it by a test, so a new type is one row here plus the
// per-type code those tests ask for (docs/contracts/packages/pack-types.json
// is the shared copy for the clients).
//
// It imports nothing of the application, so any package can use it.
package packtype

import "slices"

// The manifest types (the "type" of a pack's manifest.json).
const (
	Dictionary = "dictionary"
	Frequency  = "frequency"
	Levels     = "levels"
	Sentences  = "sentences"
	Grammar    = "grammar"
	Audio      = "audio"
	// Components is a character components pack: which parts each
	// character contains, for the radical and part lookup.
	Components = "components"
	// Strokes is a stroke-order data pack: one stroke JSON per character.
	// It serves several languages, so its manifest states languages.
	Strokes = "strokes"
	// LemmaRules is a lemmatizer rule-table pack: one rules.json in the
	// format of docs/contracts/lemma/ for one language (#176).
	LemmaRules = "lemma-rules"
	// Theme is a colour theme pack; it states no language.
	Theme = "theme"
	// Font is a hanzi/kanji font pack; it states no language.
	Font = "font"
)

// LexiconPackage is the data package type built from the dictionaries: one
// per language, from every live dictionary of it.
const LexiconPackage = "lexicon"

// Languages is how a pack type states its languages: the manifest field
// and the registry column.
type Languages int

const (
	// One: manifest "language", registry column language.
	One Languages = iota + 1
	// Many: manifest "languages", registry column languages (a JSON array).
	Many
	// None: the type teaches no language (themes, fonts).
	None
)

// Descriptor is one pack type.
type Descriptor struct {
	// Type is the manifest type.
	Type string
	// Registry is the table of the type's packs, one row per pack with at
	// least pack_id, name, version, license, attribution, notice,
	// updated_at, deleted_at and the language column of Languages.
	Registry string
	// Languages is the language shape.
	Languages Languages
	// Uploadable: an administrator may install it by an upload (audio
	// packs are too large and are seeded instead).
	Uploadable bool
	// Package is the data package type built from each live pack of the
	// type ("" none). The dictionary's is LexiconPackage, built per language.
	Package string
	// RequiresLexicon: the package requires lexicon.<language>.
	RequiresLexicon bool
	// OptionalPackage: clients ask before downloading the package.
	OptionalPackage bool
}

// All is every pack type, in the order the admin list shows them and seed
// imports them: dictionaries first (the other packs refer to their
// entries), then frequency, levels and sentences, then the types that refer
// to no entries at import time.
var All = []Descriptor{
	{Type: Dictionary, Registry: "dictionaries", Languages: One, Uploadable: true, Package: LexiconPackage},
	{Type: Frequency, Registry: "frequency_packs", Languages: One, Uploadable: true, Package: "frequency"},
	{Type: Levels, Registry: "schemes", Languages: One, Uploadable: true, Package: "levels", RequiresLexicon: true},
	{Type: Sentences, Registry: "sentence_packs", Languages: One, Uploadable: true, Package: "sentences", RequiresLexicon: true},
	{Type: Grammar, Registry: "grammar_packs", Languages: One, Uploadable: true, Package: "grammar"},
	{Type: Audio, Registry: "audio_packs", Languages: One, Uploadable: false, Package: "audio", OptionalPackage: true},
	{Type: Components, Registry: "component_packs", Languages: One, Uploadable: true, Package: "components"},
	{Type: Strokes, Registry: "stroke_packs", Languages: Many, Uploadable: true, Package: "strokes"},
	{Type: LemmaRules, Registry: "lemma_rule_packs", Languages: One, Uploadable: true, Package: "lemma-rules"},
	{Type: Theme, Registry: "theme_packs", Languages: None, Uploadable: true},
	{Type: Font, Registry: "font_packs", Languages: None, Uploadable: true},
}

// Index is the position of typ in All, -1 for an unknown type.
func Index(typ string) int {
	return slices.IndexFunc(All, func(d Descriptor) bool { return d.Type == typ })
}

// Lookup returns the descriptor of typ.
func Lookup(typ string) (Descriptor, bool) {
	if i := Index(typ); i >= 0 {
		return All[i], true
	}
	return Descriptor{}, false
}

// Types returns every manifest type in table order (a fresh slice).
func Types() []string {
	out := make([]string, len(All))
	for i, d := range All {
		out[i] = d.Type
	}
	return out
}
