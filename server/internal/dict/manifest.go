// Package dict loads dictionary packs — directories or zips carrying a
// manifest plus data files — imports them into the database, and
// uninstalls them. Dictionary packs are the first data-plugin kind;
// level and sentence packs reuse the manifest and pack loading.
package dict

import (
	"errors"
	"fmt"
	"strings"

	"qinqin/internal/lang"
	"qinqin/internal/packtype"
)

// Manifest types: the import pipeline a pack flows through. The pack-type
// table (internal/packtype) is their single list; these are its names.
const (
	TypeDictionary = packtype.Dictionary
	TypeLevels     = packtype.Levels
	TypeSentences  = packtype.Sentences
	TypeFrequency  = packtype.Frequency
	TypeGrammar    = packtype.Grammar
	TypeAudio      = packtype.Audio
	TypeComponents = packtype.Components
	TypeStrokes    = packtype.Strokes
	TypeTheme      = packtype.Theme
	TypeFont       = packtype.Font
)

// Pack formats: how a dictionary pack's data files are encoded.
const (
	FormatJSON      = "json"
	FormatCedict    = "cedict"
	FormatUnihan    = "unihan"
	FormatJMdict    = "jmdict"
	FormatKanjidic2 = "kanjidic2"

	// Frequency pack formats: a Yomitan dictionary (zip or directory of
	// term_meta_bank files) and a term,reading,rank CSV.
	FormatYomitanFreq = "yomitan-freq"
	FormatFreqCSV     = "freq-csv"

	// FormatAudioIndex is an audio pack: index.tsv plus clip files.
	FormatAudioIndex = "audio-index"
	// FormatComponentsTSV is a components pack: components.tsv plus an
	// optional parts.tsv (see internal/components).
	FormatComponentsTSV = "components-tsv"
	// FormatStrokesJSONLGz is a strokes pack: strokes.jsonl.gz with one
	// {"char", "data"} line per character (see internal/strokes).
	FormatStrokesJSONLGz = "hanzi-writer-jsonl-gz"
	// FormatThemesJSON is a theme pack: themes.json (docs/contracts/themes/).
	FormatThemesJSON = "themes-json"
	// FormatFontSlices is a font pack: faces.json plus slices/<sha256>.woff2
	// (docs/contracts/fonts/).
	FormatFontSlices = "font-slices"
)

// typeList is the valid types for an error message: "a, b, or c".
func typeList() string {
	types := packtype.Types()
	return strings.Join(types[:len(types)-1], ", ") + ", or " + types[len(types)-1]
}

// manyTypes names the types that state several languages.
func manyTypes() string {
	var out []string
	for _, d := range packtype.All {
		if d.Languages == packtype.Many {
			out = append(out, d.Type)
		}
	}
	return strings.Join(out, ", ")
}

// lookupPackType reads the pack-type table (a variable so a test can add a
// type).
var lookupPackType = packtype.Lookup

// typesOfTable is the set of the pack-type table's types.
func typesOfTable() map[string]bool {
	out := map[string]bool{}
	for _, t := range packtype.Types() {
		out[t] = true
	}
	return out
}

// manifestTypes and manifestFormats are the valid enum values of a
// manifest's Type and Format fields.
var (
	manifestTypes   = typesOfTable()
	manifestFormats = map[string]bool{
		FormatJSON:      true,
		FormatCedict:    true,
		FormatUnihan:    true,
		FormatJMdict:    true,
		FormatKanjidic2: true,

		FormatYomitanFreq: true,
		FormatFreqCSV:     true,

		FormatAudioIndex:     true,
		FormatComponentsTSV:  true,
		FormatStrokesJSONLGz: true,
		FormatThemesJSON:     true,
		FormatFontSlices:     true,
	}
)

// Manifest describes one pack: its identity, the language it teaches,
// and the license terms it ships under. Every pack must carry license
// and attribution, and every content pack a language — importers reject
// packs without them. A language code without a registered code pack
// auto-registers as a data-only language when the pack imports.
//
// A strokes pack serves several languages: it states them in Languages
// (one or more codes, each a valid language code, no duplicates) and no
// Language; no other type may state Languages. A theme or font pack
// states neither. Its languages do not
// auto-register: a strokes pack adds no language to the server.
//
// Notice is optional: a caveat the Sources page shows under the pack
// (what the licence leaves open, how a list was compiled). It is plain
// text, paragraphs separated by a blank line, links written
// [text](https://...) and no other markup; see ValidateNotice.
type Manifest struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Version     string   `json:"version"`
	Type        string   `json:"type"`
	Language    string   `json:"language"`
	Languages   []string `json:"languages,omitempty"`
	License     string   `json:"license"`
	Attribution string   `json:"attribution"`
	Notice      string   `json:"notice"`
	Format      string   `json:"format"`
}

// Validate reports whether m is a complete manifest: the identity,
// language, and license fields are present, and Type and Format are
// known enum values, and the optional notice is valid (ValidateNotice).
func (m Manifest) Validate() error {
	switch {
	case strings.TrimSpace(m.ID) == "":
		return errors.New("manifest: id is required")
	case strings.TrimSpace(m.Name) == "":
		return errors.New("manifest: name is required")
	case strings.TrimSpace(m.Version) == "":
		return errors.New("manifest: version is required")
	case strings.TrimSpace(m.License) == "":
		return errors.New("manifest: license is required — packs without license terms are rejected")
	case strings.TrimSpace(m.Attribution) == "":
		return errors.New("manifest: attribution is required — packs without attribution are rejected")
	case !manifestTypes[m.Type]:
		return fmt.Errorf("manifest: unknown type %q (want %s)", m.Type, typeList())
	case !manifestFormats[m.Format]:
		return fmt.Errorf("manifest: unknown format %q (want json, cedict, unihan, jmdict, kanjidic2, yomitan-freq, freq-csv, audio-index, components-tsv, hanzi-writer-jsonl-gz, themes-json, or font-slices)", m.Format)
	case (m.Type == TypeTheme) != (m.Format == FormatThemesJSON):
		return fmt.Errorf("manifest: a theme pack has the format themes-json, and themes-json is for theme packs only (type %s, format %s)", m.Type, m.Format)
	case (m.Type == TypeFont) != (m.Format == FormatFontSlices):
		return fmt.Errorf("manifest: a font pack has the format font-slices, and font-slices is for font packs only (type %s, format %s)", m.Type, m.Format)
	}
	if err := m.validateLanguages(); err != nil {
		return err
	}
	if err := ValidateNotice(m.Notice); err != nil {
		return fmt.Errorf("manifest: %w", err)
	}
	return nil
}

// validateLanguages checks the languages by the type's language shape in
// the pack-type table: one Language, several Languages (strokes), or
// neither (theme, font).
func (m Manifest) validateLanguages() error {
	d, _ := lookupPackType(m.Type)
	switch d.Languages {
	case packtype.None:
		if strings.TrimSpace(m.Language) != "" || len(m.Languages) > 0 {
			return fmt.Errorf("manifest: a %s pack states no language and no languages", m.Type)
		}
		return nil
	case packtype.Many:
	default:
		switch {
		case len(m.Languages) > 0:
			return fmt.Errorf("manifest: languages is for packs that serve several languages (%s); a %s pack states one language", manyTypes(), m.Type)
		case strings.TrimSpace(m.Language) == "":
			return errors.New("manifest: language is required")
		case !validLanguage(m.Language):
			return fmt.Errorf("manifest: language %q must be a code like es or pt-br", m.Language)
		}
		return nil
	}
	switch {
	case strings.TrimSpace(m.Language) != "":
		return fmt.Errorf("manifest: a %s pack states its languages in languages, not language", m.Type)
	case len(m.Languages) == 0:
		return fmt.Errorf("manifest: languages is required for a %s pack", m.Type)
	}
	seen := map[string]bool{}
	for _, code := range m.Languages {
		if !validLanguage(code) {
			return fmt.Errorf("manifest: language %q must be a code like es or pt-br", code)
		}
		if seen[code] {
			return fmt.Errorf("manifest: languages names %q twice", code)
		}
		seen[code] = true
	}
	return nil
}

// validLanguage reports whether code is already in the normalized
// language code form (lowercase, "-" separators, e.g. es or pt-br).
func validLanguage(code string) bool {
	norm, ok := lang.ValidCode(code)
	return ok && norm == strings.ToLower(strings.TrimSpace(code))
}

// normalize trims every field and lowercases the language code, so one
// pack always validates, keys, and stores identically however its
// manifest was written.
func (m *Manifest) normalize() {
	m.ID = strings.TrimSpace(m.ID)
	m.Name = strings.TrimSpace(m.Name)
	m.Version = strings.TrimSpace(m.Version)
	m.Type = strings.TrimSpace(m.Type)
	m.Language = strings.ToLower(strings.TrimSpace(m.Language))
	if m.Languages != nil {
		langs := make([]string, len(m.Languages))
		for i, code := range m.Languages {
			langs[i] = strings.ToLower(strings.TrimSpace(code))
		}
		m.Languages = langs
	}
	m.License = strings.TrimSpace(m.License)
	m.Attribution = strings.TrimSpace(m.Attribution)
	m.Notice = strings.TrimSpace(m.Notice)
	m.Format = strings.TrimSpace(m.Format)
}
