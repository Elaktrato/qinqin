package pack

import "slices"

// The manifest types (the "type" of a pack's manifest.json).
const (
	TypeDictionary = "dictionary"
	TypeFrequency  = "frequency"
	TypeLevels     = "levels"
	TypeSentences  = "sentences"
	TypeGrammar    = "grammar"
	TypeAudio      = "audio"
	// TypeComponents is a character components pack: which parts each
	// character contains, for the radical and part lookup.
	TypeComponents = "components"
	// TypeStrokes is a stroke-order data pack: one stroke JSON per
	// character. It serves several languages, so its manifest states
	// languages.
	TypeStrokes = "strokes"
	// TypeLemmaRules is a lemmatizer rule-table pack: one rules.json in the
	// format of docs/contracts/lemma/ for one language (#176).
	TypeLemmaRules = "lemma-rules"
	// TypeImages is a pictures pack (#216): SVG pictures and a word -> picture
	// mapping per language. It serves several languages, so its manifest
	// states languages. It builds no data package: the web app fetches the
	// pictures from the server (docs/contracts/images/).
	TypeImages = "images"
	// TypeTheme is a colour theme pack; it states no language.
	TypeTheme = "theme"
	// TypeFont is a hanzi/kanji font pack; it states no language.
	TypeFont = "font"
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

// Descriptor is one pack type: the data every generic loop reads. How a
// type is imported, uninstalled and summarised is its handler in
// internal/packs, one per row of All (docs/architecture/0008-pack-types.md).
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
	// Format is the type's own format, if it has one: a pack of the type
	// must use it and no other type may ("" the type uses the shared
	// formats). It must be one of Formats.
	Format string
}

// LanguageColumn is the registry column of the type's languages: language,
// languages (a JSON array) or, for a type without languages, the empty
// string literal ” (so a generic SELECT still has the column).
func (d Descriptor) LanguageColumn() string {
	switch d.Languages {
	case Many:
		return "languages"
	case None:
		return "''"
	}
	return "language"
}

// All is every pack type, in the order the admin list shows them and seed
// imports them: dictionaries first (the other packs refer to their
// entries), then frequency, levels and sentences, then the types that refer
// to no entries at import time. docs/contracts/packages/pack-types.json is
// the clients' copy (TestTableMatchesTheContract).
var All = []Descriptor{
	{Type: TypeDictionary, Registry: "dictionaries", Languages: One, Uploadable: true, Package: LexiconPackage},
	{Type: TypeFrequency, Registry: "frequency_packs", Languages: One, Uploadable: true, Package: "frequency"},
	{Type: TypeLevels, Registry: "schemes", Languages: One, Uploadable: true, Package: "levels", RequiresLexicon: true},
	{Type: TypeSentences, Registry: "sentence_packs", Languages: One, Uploadable: true, Package: "sentences", RequiresLexicon: true},
	{Type: TypeGrammar, Registry: "grammar_packs", Languages: One, Uploadable: true, Package: "grammar"},
	{Type: TypeAudio, Registry: "audio_packs", Languages: One, Uploadable: false, Package: "audio", OptionalPackage: true},
	{Type: TypeComponents, Registry: "component_packs", Languages: One, Uploadable: true, Package: "components"},
	{Type: TypeStrokes, Registry: "stroke_packs", Languages: Many, Uploadable: true, Package: "strokes"},
	{Type: TypeLemmaRules, Registry: "lemma_rule_packs", Languages: One, Uploadable: true, Package: "lemma-rules", Format: FormatRulesJSON},
	{Type: TypeTheme, Registry: "theme_packs", Languages: None, Uploadable: true, Format: FormatThemesJSON},
	{Type: TypeFont, Registry: "font_packs", Languages: None, Uploadable: true, Format: FormatFontSlices},
	{Type: TypeImages, Registry: "image_packs", Languages: Many, Uploadable: true, Package: "images", Format: FormatImagesSVG},
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

// Lexicon returns the type whose data package is the per-language lexicon
// (the dictionary).
func Lexicon() Descriptor {
	for _, d := range All {
		if d.Package == LexiconPackage {
			return d
		}
	}
	return Descriptor{}
}
