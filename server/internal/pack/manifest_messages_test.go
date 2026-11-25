package pack_test

import (
	"testing"

	"qinqin/internal/pack"
)

// The validation messages reach administrators (the seed CLI, the upload's
// pack_invalid detail), so moving the manifest code (#192) must not change
// one of them. Every rule of Validate is pinned here with its exact text.
func TestManifestMessagesArePinned(t *testing.T) {
	ok := pack.Manifest{ID: "x", Name: "X", Version: "1", Type: "dictionary", Language: "es", License: "L", Attribution: "A", Format: "json"}
	strokes := func(m *pack.Manifest) { m.Type, m.Format, m.Language = "strokes", "hanzi-writer-jsonl-gz", "" }
	for _, c := range []struct {
		name string
		edit func(*pack.Manifest)
		want string
	}{
		{"valid", func(*pack.Manifest) {}, "<nil>"},
		{"no id", func(m *pack.Manifest) { m.ID = " " }, "manifest: id is required"},
		{"no name", func(m *pack.Manifest) { m.Name = "" }, "manifest: name is required"},
		{"no version", func(m *pack.Manifest) { m.Version = "" }, "manifest: version is required"},
		{"no license", func(m *pack.Manifest) { m.License = "" }, "manifest: license is required — packs without license terms are rejected"},
		{"no attribution", func(m *pack.Manifest) { m.Attribution = "" }, "manifest: attribution is required — packs without attribution are rejected"},
		{"unknown type", func(m *pack.Manifest) { m.Type = "bogus" }, "manifest: unknown type \"bogus\" (want dictionary, frequency, levels, sentences, grammar, audio, components, strokes, lemma-rules, theme, or font)"},
		{"unknown format", func(m *pack.Manifest) { m.Format = "bogus" }, "manifest: unknown format \"bogus\" (want json, cedict, unihan, jmdict, kanjidic2, yomitan-freq, freq-csv, audio-index, components-tsv, hanzi-writer-jsonl-gz, themes-json, font-slices, or rules-json)"},
		{"theme with json", func(m *pack.Manifest) { m.Type, m.Language = "theme", "" }, "manifest: a theme pack has the format themes-json, and themes-json is for theme packs only (type theme, format json)"},
		{"dictionary with themes-json", func(m *pack.Manifest) { m.Format = "themes-json" }, "manifest: a theme pack has the format themes-json, and themes-json is for theme packs only (type dictionary, format themes-json)"},
		{"font with json", func(m *pack.Manifest) { m.Type, m.Language = "font", "" }, "manifest: a font pack has the format font-slices, and font-slices is for font packs only (type font, format json)"},
		{"dictionary with font-slices", func(m *pack.Manifest) { m.Format = "font-slices" }, "manifest: a font pack has the format font-slices, and font-slices is for font packs only (type dictionary, format font-slices)"},
		{"lemma-rules with json", func(m *pack.Manifest) { m.Type = "lemma-rules" }, "manifest: a lemma-rules pack has the format rules-json, and rules-json is for lemma-rules packs only (type lemma-rules, format json)"},
		{"dictionary with rules-json", func(m *pack.Manifest) { m.Format = "rules-json" }, "manifest: a lemma-rules pack has the format rules-json, and rules-json is for lemma-rules packs only (type dictionary, format rules-json)"},
		// A type with a format of its own and another type's own format
		// break two rules; the message names the manifest's type (#192:
		// before, a fixed theme, font, lemma-rules precedence chose).
		{"theme with rules-json", func(m *pack.Manifest) { m.Type, m.Format, m.Language = "theme", "rules-json", "" },
			"manifest: a theme pack has the format themes-json, and themes-json is for theme packs only (type theme, format rules-json)"},
		{"lemma-rules with themes-json", func(m *pack.Manifest) { m.Type, m.Format = "lemma-rules", "themes-json" },
			"manifest: a lemma-rules pack has the format rules-json, and rules-json is for lemma-rules packs only (type lemma-rules, format themes-json)"},
		{"theme with a language", func(m *pack.Manifest) { m.Type, m.Format = "theme", "themes-json" }, "manifest: a theme pack states no language and no languages"},
		{"font with languages", func(m *pack.Manifest) {
			m.Type, m.Format, m.Language, m.Languages = "font", "font-slices", "", []string{"zh"}
		}, "manifest: a font pack states no language and no languages"},
		{"one language with languages", func(m *pack.Manifest) { m.Languages = []string{"es"} }, "manifest: languages is for packs that serve several languages (strokes); a dictionary pack states one language"},
		{"one language missing", func(m *pack.Manifest) { m.Language = "" }, "manifest: language is required"},
		{"one language malformed", func(m *pack.Manifest) { m.Language = "Spanish!" }, "manifest: language \"Spanish!\" must be a code like es or pt-br"},
		{"many with language", func(m *pack.Manifest) { strokes(m); m.Language = "zh" }, "manifest: a strokes pack states its languages in languages, not language"},
		{"many missing", strokes, "manifest: languages is required for a strokes pack"},
		{"many malformed", func(m *pack.Manifest) { strokes(m); m.Languages = []string{"zh", "ZH x"} }, "manifest: language \"ZH x\" must be a code like es or pt-br"},
		{"many repeated", func(m *pack.Manifest) { strokes(m); m.Languages = []string{"zh", "zh"} }, "manifest: languages names \"zh\" twice"},
		{"many valid", func(m *pack.Manifest) { strokes(m); m.Languages = []string{"zh", "ja"} }, "<nil>"},
		{"bad notice", func(m *pack.Manifest) { m.Notice = "see [x](http://a.example)" }, "manifest: notice link [x](http://a.example): only https:// links are allowed"},
	} {
		m := ok
		m.Languages = nil
		c.edit(&m)
		got := "<nil>"
		if err := m.Validate(); err != nil {
			got = err.Error()
		}
		if got != c.want {
			t.Errorf("%s:\n got %q\nwant %q", c.name, got, c.want)
		}
	}
}
