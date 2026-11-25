package pack

import (
	"errors"
	"fmt"
	"slices"
	"strings"

	"qinqin/internal/lang"
)

// typeList is the valid types for an error message: "a, b, or c".
func typeList() string { return orList(Types()) }

// formatList is the valid formats for an error message.
func formatList() string { return orList(Formats) }

func orList(items []string) string {
	return strings.Join(items[:len(items)-1], ", ") + ", or " + items[len(items)-1]
}

// manyTypes names the types that state several languages.
func manyTypes() string {
	var out []string
	for _, d := range All {
		if d.Languages == Many {
			out = append(out, d.Type)
		}
	}
	return strings.Join(out, ", ")
}

// lookupPackType reads the pack-type table (a variable so a test can add a
// type).
var lookupPackType = Lookup

// known reports whether typ is a type of the table.
func known(typ string) bool {
	_, ok := lookupPackType(typ)
	return ok
}

func ownFormatError(d Descriptor, m Manifest) error {
	return fmt.Errorf("manifest: a %s pack has the format %s, and %s is for %s packs only (type %s, format %s)",
		d.Type, d.Format, d.Format, d.Type, m.Type, m.Format)
}

// ownFormat returns the type that has format as its own format (Descriptor.Format).
func ownFormat(format string) (Descriptor, bool) {
	for _, d := range All {
		if d.Format != "" && d.Format == format {
			return d, true
		}
	}
	return Descriptor{}, false
}

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
	case !known(m.Type):
		return fmt.Errorf("manifest: unknown type %q (want %s)", m.Type, typeList())
	case !slices.Contains(Formats, m.Format):
		return fmt.Errorf("manifest: unknown format %q (want %s)", m.Format, formatList())
	}
	// A type with a format of its own uses only it, and no other type uses
	// it; the manifest's type is checked first.
	if d, _ := lookupPackType(m.Type); d.Format != "" && m.Format != d.Format {
		return ownFormatError(d, m)
	}
	if d, ok := ownFormat(m.Format); ok && d.Type != m.Type {
		return ownFormatError(d, m)
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
	case None:
		if strings.TrimSpace(m.Language) != "" || len(m.Languages) > 0 {
			return fmt.Errorf("manifest: a %s pack states no language and no languages", m.Type)
		}
		return nil
	case Many:
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

// Normalize trims every field and lowercases the language code, so one
// pack always validates, keys, and stores identically however its
// manifest was written.
func (m *Manifest) Normalize() {
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
