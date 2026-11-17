// Package themes is the colour-theme store (docs/contracts/themes/): it
// validates a theme pack's themes.json, measures contrast for the licence
// review, derives the tokens a client paints with, keeps installed theme
// packs (theme_packs, themes) and holds the built-in themes embedded in the
// binary.
package themes

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Limits of a themes.json (pinned by theme-file.json).
const (
	MaxFileBytes = 256 << 10
	MaxThemes    = 64
	MaxAccents   = 16
	maxIDBytes   = 64
	maxNameRunes = 64
)

// ColorKeys are the 13 colour tokens of a theme, in the order they are
// checked and written.
var ColorKeys = []string{"chrome", "panel", "raised", "line", "text", "muted", "good", "warn", "bad",
	"gradeAgain", "gradeHard", "gradeGood", "gradeEasy"}

// Colors are a theme's colour tokens, each "#rrggbb" in lower case.
type Colors struct {
	Chrome     string `json:"chrome"`
	Panel      string `json:"panel"`
	Raised     string `json:"raised"`
	Line       string `json:"line"`
	Text       string `json:"text"`
	Muted      string `json:"muted"`
	Good       string `json:"good"`
	Warn       string `json:"warn"`
	Bad        string `json:"bad"`
	GradeAgain string `json:"gradeAgain"`
	GradeHard  string `json:"gradeHard"`
	GradeGood  string `json:"gradeGood"`
	GradeEasy  string `json:"gradeEasy"`
}

// field returns the token named key (one of ColorKeys).
func (c *Colors) field(key string) *string {
	switch key {
	case "chrome":
		return &c.Chrome
	case "panel":
		return &c.Panel
	case "raised":
		return &c.Raised
	case "line":
		return &c.Line
	case "text":
		return &c.Text
	case "muted":
		return &c.Muted
	case "good":
		return &c.Good
	case "warn":
		return &c.Warn
	case "bad":
		return &c.Bad
	case "gradeAgain":
		return &c.GradeAgain
	case "gradeHard":
		return &c.GradeHard
	case "gradeGood":
		return &c.GradeGood
	case "gradeEasy":
		return &c.GradeEasy
	}
	return nil
}

// Get returns the token named key, "" for an unknown key.
func (c Colors) Get(key string) string {
	if p := c.field(key); p != nil {
		return *p
	}
	return ""
}

// Accent is one named accent colour.
type Accent struct{ Key, Color string }

// Theme is one validated theme. Accents keep the file's order.
type Theme struct {
	ID            string
	Name          string
	Family        string // "" when the file has none
	Scheme        string // "light" or "dark"
	Colors        Colors
	Accents       []Accent
	DefaultAccent string
}

// Accent returns the colour of the accent key.
func (t Theme) Accent(key string) (string, bool) {
	for _, a := range t.Accents {
		if a.Key == key {
			return a.Color, true
		}
	}
	return "", false
}

// MarshalJSON writes the canonical file form: members in the contract's
// order, accents as an object in file order, family left out when empty.
func (t Theme) MarshalJSON() ([]byte, error) {
	var b bytes.Buffer
	str := func(s string) { v, _ := json.Marshal(s); b.Write(v) }
	b.WriteString(`{"id":`)
	str(t.ID)
	b.WriteString(`,"name":`)
	str(t.Name)
	if t.Family != "" {
		b.WriteString(`,"family":`)
		str(t.Family)
	}
	b.WriteString(`,"scheme":`)
	str(t.Scheme)
	colors, err := json.Marshal(t.Colors)
	if err != nil {
		return nil, err
	}
	b.WriteString(`,"colors":`)
	b.Write(colors)
	b.WriteString(`,"accents":{`)
	for i, a := range t.Accents {
		if i > 0 {
			b.WriteByte(',')
		}
		str(a.Key)
		b.WriteByte(':')
		str(a.Color)
	}
	b.WriteString(`},"defaultAccent":`)
	str(t.DefaultAccent)
	b.WriteByte('}')
	return b.Bytes(), nil
}

// FileError is the first problem of a theme file: a stable code and the
// JSON path of the value it is about (theme-file.json).
type FileError struct{ Code, Path string }

func (e *FileError) Error() string { return e.Code + " at " + e.Path }

func fail(code, path string) error { return &FileError{Code: code, Path: path} }

var (
	idPattern        = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)
	accentKeyPattern = regexp.MustCompile(`^[a-z][a-z0-9-]{0,31}$`)
	colorPattern     = regexp.MustCompile(`^#[0-9a-f]{6}$`)
)

// ValidID reports whether id is a theme id.
func ValidID(id string) bool { return len(id) <= maxIDBytes && idPattern.MatchString(id) }

// ValidAccentKey reports whether key is an accent key.
func ValidAccentKey(key string) bool { return accentKeyPattern.MatchString(key) }

// ValidColor reports whether c is "#rrggbb" in lower case.
func ValidColor(c string) bool { return colorPattern.MatchString(c) }

// themeMembers are the members of a theme in the order a missing one is
// reported; family is optional.
var themeMembers = []string{"id", "name", "family", "scheme", "colors", "accents", "defaultAccent"}

// ParseFile validates a themes.json and returns its themes in file order.
// Errors are *FileError; the first problem in the contract's order wins.
func ParseFile(data []byte) ([]Theme, error) {
	if len(data) > MaxFileBytes {
		return nil, fail("too-large", "$")
	}
	if !json.Valid(data) {
		return nil, fail("bad-json", "$")
	}
	if trimmed := bytes.TrimLeft(data, " \t\r\n"); len(trimmed) == 0 || trimmed[0] != '[' {
		return nil, fail("not-an-array", "$")
	}
	var items []json.RawMessage
	if err := json.Unmarshal(data, &items); err != nil {
		return nil, fail("not-an-array", "$")
	}
	switch {
	case len(items) == 0:
		return nil, fail("no-themes", "$")
	case len(items) > MaxThemes:
		return nil, fail("too-many-themes", "$")
	}
	out := make([]Theme, 0, len(items))
	seen := map[string]bool{}
	for i, raw := range items {
		path := fmt.Sprintf("$[%d]", i)
		t, err := parseTheme(raw, path, seen)
		if err != nil {
			return nil, err
		}
		seen[t.ID] = true
		out = append(out, t)
	}
	return out, nil
}

// ParseTheme validates one theme object (as stored or as served).
func ParseTheme(raw []byte) (Theme, error) {
	if !json.Valid(raw) {
		return Theme{}, fail("bad-json", "$")
	}
	return parseTheme(raw, "$", map[string]bool{})
}

func parseTheme(raw json.RawMessage, path string, seen map[string]bool) (Theme, error) {
	members, err := readObject(raw, path)
	if err != nil {
		return Theme{}, err
	}
	known := map[string]bool{}
	for _, k := range themeMembers {
		known[k] = true
	}
	for _, m := range members {
		if !known[m.key] {
			return Theme{}, fail("unknown-member", path+"."+m.key)
		}
	}
	byKey := map[string]json.RawMessage{}
	for _, m := range members {
		byKey[m.key] = m.raw
	}
	for _, k := range themeMembers {
		if _, ok := byKey[k]; !ok && k != "family" {
			return Theme{}, fail("missing-member", path+"."+k)
		}
	}
	var t Theme
	var ok bool
	if t.ID, ok = jsonString(byKey["id"]); !ok || !ValidID(t.ID) {
		return Theme{}, fail("bad-id", path+".id")
	}
	if seen[t.ID] {
		return Theme{}, fail("duplicate-id", path+".id")
	}
	if t.Name, ok = jsonString(byKey["name"]); !ok || !validName(t.Name) {
		return Theme{}, fail("bad-name", path+".name")
	}
	if raw, present := byKey["family"]; present {
		if t.Family, ok = jsonString(raw); !ok || !validName(t.Family) {
			return Theme{}, fail("bad-family", path+".family")
		}
	}
	if t.Scheme, ok = jsonString(byKey["scheme"]); !ok || (t.Scheme != "light" && t.Scheme != "dark") {
		return Theme{}, fail("bad-scheme", path+".scheme")
	}
	if t.Colors, err = parseColors(byKey["colors"], path+".colors"); err != nil {
		return Theme{}, err
	}
	if t.Accents, err = parseAccents(byKey["accents"], path+".accents"); err != nil {
		return Theme{}, err
	}
	t.DefaultAccent, ok = jsonString(byKey["defaultAccent"])
	if _, found := t.Accent(t.DefaultAccent); !ok || !found {
		return Theme{}, fail("bad-default-accent", path+".defaultAccent")
	}
	return t, nil
}

func parseColors(raw json.RawMessage, path string) (Colors, error) {
	members, err := readObject(raw, path)
	if err != nil {
		return Colors{}, err
	}
	var c Colors
	byKey := map[string]json.RawMessage{}
	for _, m := range members {
		if c.field(m.key) == nil {
			return Colors{}, fail("unknown-member", path+"."+m.key)
		}
		byKey[m.key] = m.raw
	}
	for _, k := range ColorKeys {
		v, present := byKey[k]
		if !present {
			return Colors{}, fail("missing-member", path+"."+k)
		}
		s, ok := jsonString(v)
		if !ok || !ValidColor(s) {
			return Colors{}, fail("bad-colour", path+"."+k)
		}
		*c.field(k) = s
	}
	return c, nil
}

func parseAccents(raw json.RawMessage, path string) ([]Accent, error) {
	members, err := readObject(raw, path)
	if err != nil {
		return nil, err
	}
	switch {
	case len(members) == 0:
		return nil, fail("no-accents", path)
	case len(members) > MaxAccents:
		return nil, fail("too-many-accents", path)
	}
	out := make([]Accent, 0, len(members))
	for _, m := range members {
		if !ValidAccentKey(m.key) {
			return nil, fail("bad-accent-key", path+"."+m.key)
		}
		s, ok := jsonString(m.raw)
		if !ok || !ValidColor(s) {
			return nil, fail("bad-colour", path+"."+m.key)
		}
		out = append(out, Accent{Key: m.key, Color: s})
	}
	return out, nil
}

// validName: 1..64 code points, no control character, no surrounding space.
func validName(s string) bool {
	n := utf8.RuneCountInString(s)
	if n == 0 || n > maxNameRunes || strings.TrimSpace(s) != s {
		return false
	}
	for _, r := range s {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}

// jsonString decodes raw as a JSON string.
func jsonString(raw json.RawMessage) (string, bool) {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || raw[0] != '"' {
		return "", false
	}
	var s string
	if json.Unmarshal(raw, &s) != nil {
		return "", false
	}
	return s, true
}

type member struct {
	key string
	raw json.RawMessage
}

// readObject reads a JSON object's members in file order, refusing a
// repeated member. raw is valid JSON (checked by the caller).
func readObject(raw json.RawMessage, path string) ([]member, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	tok, err := dec.Token()
	if err != nil || tok != json.Delim('{') {
		return nil, fail("not-an-object", path)
	}
	var out []member
	seen := map[string]bool{}
	for dec.More() {
		tok, err := dec.Token()
		if err != nil {
			return nil, fail("bad-json", path)
		}
		key, _ := tok.(string)
		var v json.RawMessage
		if err := dec.Decode(&v); err != nil {
			return nil, fail("bad-json", path)
		}
		if seen[key] {
			return nil, fail("duplicate-member", path+"."+key)
		}
		seen[key] = true
		out = append(out, member{key, v})
	}
	if _, err := dec.Token(); err != nil && err != io.EOF {
		return nil, fail("bad-json", path)
	}
	return out, nil
}
