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
)

// Manifest types: the import pipeline a pack flows through.
const (
	TypeDictionary = "dictionary"
	TypeLevels     = "levels"
	TypeSentences  = "sentences"
	TypeFrequency  = "frequency"
	TypeGrammar    = "grammar"
	TypeAudio      = "audio"
	// TypeComponents is a character components pack: which parts each
	// character contains, for the radical and part lookup.
	TypeComponents = "components"
	// TypeStrokes is a stroke-order data pack (internal/strokes): one
	// stroke JSON per character for the stroke player. It serves several
	// languages, so its manifest states languages instead of language.
	TypeStrokes = "strokes"
	// TypeTheme is a colour theme pack (internal/themes): a themes.json of
	// one or more themes. It teaches no language: its manifest states
	// neither language nor languages.
	TypeTheme = "theme"
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
)

// manifestTypes and manifestFormats are the valid enum values of a
// manifest's Type and Format fields.
var (
	manifestTypes = map[string]bool{
		TypeDictionary: true,
		TypeLevels:     true,
		TypeSentences:  true,
		TypeFrequency:  true,
		TypeGrammar:    true,
		TypeAudio:      true,
		TypeComponents: true,
		TypeStrokes:    true,
		TypeTheme:      true,
	}
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
// Language; no other type may state Languages. A theme pack states
// neither. Its languages do not
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
		return fmt.Errorf("manifest: unknown type %q (want dictionary, levels, sentences, frequency, grammar, audio, components, strokes, or theme)", m.Type)
	case !manifestFormats[m.Format]:
		return fmt.Errorf("manifest: unknown format %q (want json, cedict, unihan, jmdict, kanjidic2, yomitan-freq, freq-csv, audio-index, components-tsv, hanzi-writer-jsonl-gz, or themes-json)", m.Format)
	case (m.Type == TypeTheme) != (m.Format == FormatThemesJSON):
		return fmt.Errorf("manifest: a theme pack has the format themes-json, and themes-json is for theme packs only (type %s, format %s)", m.Type, m.Format)
	}
	if err := m.validateLanguages(); err != nil {
		return err
	}
	if err := ValidateNotice(m.Notice); err != nil {
		return fmt.Errorf("manifest: %w", err)
	}
	return nil
}

// validateLanguages checks Language, or Languages for a strokes pack; a
// theme pack states neither.
func (m Manifest) validateLanguages() error {
	if m.Type == TypeTheme {
		if strings.TrimSpace(m.Language) != "" || len(m.Languages) > 0 {
			return errors.New("manifest: a theme pack states no language and no languages")
		}
		return nil
	}
	if m.Type != TypeStrokes {
		switch {
		case len(m.Languages) > 0:
			return fmt.Errorf("manifest: languages is for strokes packs only; a %s pack states one language", m.Type)
		case strings.TrimSpace(m.Language) == "":
			return errors.New("manifest: language is required")
		case !validLanguage(m.Language):
			return fmt.Errorf("manifest: language %q must be a code like es or pt-br", m.Language)
		}
		return nil
	}
	switch {
	case strings.TrimSpace(m.Language) != "":
		return errors.New("manifest: a strokes pack states its languages in languages, not language")
	case len(m.Languages) == 0:
		return errors.New("manifest: languages is required for a strokes pack")
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
