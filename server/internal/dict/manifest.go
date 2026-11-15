// Package dict loads dictionary packs — directories or zips carrying a
// manifest plus data files — imports them into the database, and
// uninstalls them. Dictionary packs are the first data-plugin kind;
// level and sentence packs reuse the manifest and pack loading.
package dict

import (
	"errors"
	"fmt"
	"strings"
)

// Manifest types: the import pipeline a pack flows through.
const (
	TypeDictionary = "dictionary"
	TypeLevels     = "levels"
	TypeSentences  = "sentences"
	TypeFrequency  = "frequency"
	TypeGrammar    = "grammar"
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
	}
	manifestFormats = map[string]bool{
		FormatJSON:      true,
		FormatCedict:    true,
		FormatUnihan:    true,
		FormatJMdict:    true,
		FormatKanjidic2: true,

		FormatYomitanFreq: true,
		FormatFreqCSV:     true,
	}
)

// Manifest describes one pack: its identity, the language it teaches,
// and the license terms it ships under. Every pack must carry license
// and attribution, and every content pack a language — importers reject
// packs without them. A language code without a registered code pack
// auto-registers as a data-only language when the pack imports.
//
// Notice is optional: a caveat the Sources page shows under the pack
// (what the licence leaves open, how a list was compiled). It is plain
// text, paragraphs separated by a blank line, links written
// [text](https://...) and no other markup; see ValidateNotice.
type Manifest struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Version     string `json:"version"`
	Type        string `json:"type"`
	Language    string `json:"language"`
	License     string `json:"license"`
	Attribution string `json:"attribution"`
	Notice      string `json:"notice"`
	Format      string `json:"format"`
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
	case strings.TrimSpace(m.Language) == "":
		return errors.New("manifest: language is required")
	case strings.TrimSpace(m.License) == "":
		return errors.New("manifest: license is required — packs without license terms are rejected")
	case strings.TrimSpace(m.Attribution) == "":
		return errors.New("manifest: attribution is required — packs without attribution are rejected")
	case !manifestTypes[m.Type]:
		return fmt.Errorf("manifest: unknown type %q (want dictionary, levels, sentences, frequency, or grammar)", m.Type)
	case !manifestFormats[m.Format]:
		return fmt.Errorf("manifest: unknown format %q (want json, cedict, unihan, jmdict, kanjidic2, yomitan-freq, or freq-csv)", m.Format)
	}
	if err := ValidateNotice(m.Notice); err != nil {
		return fmt.Errorf("manifest: %w", err)
	}
	return nil
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
	m.License = strings.TrimSpace(m.License)
	m.Attribution = strings.TrimSpace(m.Attribution)
	m.Notice = strings.TrimSpace(m.Notice)
	m.Format = strings.TrimSpace(m.Format)
}
