// Package grammar stores grammar packs: lessons by level, each with a
// pattern, an explanation and example sentences, imported from
// lessons.json and served read-only. Practice progress lives in
// workspace plugin data, not here.
package grammar

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"

	"qinqin/internal/pack"
)

// lessonsFile is the data file of a grammar pack.
const lessonsFile = "lessons.json"

// SchemeLevel relates a pack level to a level of an installed levels
// pack; it only adds a badge and never fails an import.
type SchemeLevel struct {
	Scheme string `json:"scheme"`
	Level  string `json:"level"`
}

// Level is one difficulty step of a pack, in difficulty order.
type Level struct {
	ID           string        `json:"id"`
	Name         string        `json:"name"`
	SchemeLevels []SchemeLevel `json:"schemeLevels"`
}

// Example is one example sentence of a lesson. Focus is the grammar word
// in Text; with at least two Distractors the example also yields a
// fill-the-gap exercise. NoOrder skips the word-order exercise for a
// sentence whose tokens have a second legal order.
type Example struct {
	ID          string   `json:"id"`
	Text        string   `json:"text"`
	Reading     string   `json:"reading"`
	Translation string   `json:"translation"`
	Focus       string   `json:"focus"`
	Distractors []string `json:"distractors"`
	NoOrder     bool     `json:"noOrder,omitempty"`
}

// Lesson is one grammar lesson. All text is plain text.
type Lesson struct {
	ID       string    `json:"id"`
	Level    string    `json:"level"`
	Title    string    `json:"title"`
	Summary  string    `json:"summary"`
	Pattern  []string  `json:"pattern"`
	Body     []string  `json:"body"`
	Examples []Example `json:"examples"`
}

// Data is the decoded lessons.json.
type Data struct {
	Levels  []Level  `json:"levels"`
	Lessons []Lesson `json:"lessons"`
}

// Validation limits; lengths count Unicode code points.
const (
	maxLevels       = 50
	maxLessons      = 500
	maxTitle        = 120
	maxSummary      = 300
	maxPatternLines = 5
	maxPatternLine  = 120
	maxBody         = 20
	maxParagraph    = 2000
	maxExamples     = 20
	maxExampleText  = 500
	maxDistractors  = 4
	maxDistractor   = 120
	maxFileBytes    = 4 << 20
)

var idPattern = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

// ReadData reads and validates the lessons.json in dir. The whole pack
// is rejected on the first violation; the error wraps pack.ErrInvalidPack
// and names the JSON path.
func ReadData(dir string) (Data, error) {
	raw, err := os.ReadFile(filepath.Join(dir, lessonsFile))
	if err != nil {
		return Data{}, fmt.Errorf("%w: read %s of %s: %v", pack.ErrInvalidPack, lessonsFile, dir, err)
	}
	if len(raw) > maxFileBytes {
		return Data{}, fmt.Errorf("%w: %s of %s is too large (%d bytes, at most %d)", pack.ErrInvalidPack, lessonsFile, dir, len(raw), maxFileBytes)
	}
	var d Data
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&d); err != nil {
		return Data{}, fmt.Errorf("%w: parse %s of %s: %v", pack.ErrInvalidPack, lessonsFile, dir, err)
	}
	// Anything but whitespace after the document is a mistake (two
	// concatenated files, a stray brace), not something to ignore.
	if _, err := dec.Token(); err != io.EOF {
		return Data{}, fmt.Errorf("%w: parse %s of %s: trailing data after the JSON document", pack.ErrInvalidPack, lessonsFile, dir)
	}
	if err := d.validate(); err != nil {
		return Data{}, fmt.Errorf("%w: %s of %s: %v", pack.ErrInvalidPack, lessonsFile, dir, err)
	}
	d.normalize()
	return d, nil
}

// normalize turns absent lists into empty ones, so every consumer (the
// stored JSON and the API) sees arrays, never null.
func (d *Data) normalize() {
	for i := range d.Levels {
		if d.Levels[i].SchemeLevels == nil {
			d.Levels[i].SchemeLevels = []SchemeLevel{}
		}
	}
	for i := range d.Lessons {
		l := &d.Lessons[i]
		if l.Pattern == nil {
			l.Pattern = []string{}
		}
		for j := range l.Examples {
			if l.Examples[j].Distractors == nil {
				l.Examples[j].Distractors = []string{}
			}
		}
	}
}

func runes(s string) int { return utf8.RuneCountInString(s) }

// text checks a required (or optional) bounded plain-text field.
func text(path, s string, required bool, max int) error {
	if required && strings.TrimSpace(s) == "" {
		return fmt.Errorf("%s: is required", path)
	}
	if n := runes(s); n > max {
		return fmt.Errorf("%s: %d characters, at most %d", path, n, max)
	}
	return nil
}

func checkID(path, id string) error {
	if !idPattern.MatchString(id) {
		return fmt.Errorf("%s: %q is not a valid id (lowercase letters, digits and single hyphens)", path, id)
	}
	return nil
}

func (d Data) validate() error {
	if n := len(d.Levels); n < 1 || n > maxLevels {
		return fmt.Errorf("levels: %d levels, want 1 to %d", n, maxLevels)
	}
	levelIDs := map[string]bool{}
	for i, l := range d.Levels {
		p := fmt.Sprintf("levels[%d]", i)
		if err := checkID(p+".id", l.ID); err != nil {
			return err
		}
		if levelIDs[l.ID] {
			return fmt.Errorf("%s.id: %q is used twice", p, l.ID)
		}
		levelIDs[l.ID] = true
		if err := text(p+".name", l.Name, true, maxTitle); err != nil {
			return err
		}
		for j, sl := range l.SchemeLevels {
			q := fmt.Sprintf("%s.schemeLevels[%d]", p, j)
			if strings.TrimSpace(sl.Scheme) == "" {
				return fmt.Errorf("%s.scheme: is required", q)
			}
			if strings.TrimSpace(sl.Level) == "" {
				return fmt.Errorf("%s.level: is required", q)
			}
		}
	}
	if n := len(d.Lessons); n < 1 || n > maxLessons {
		return fmt.Errorf("lessons: %d lessons, want 1 to %d", n, maxLessons)
	}
	lessonIDs, exampleIDs := map[string]bool{}, map[string]bool{}
	for i, l := range d.Lessons {
		if err := l.validate(fmt.Sprintf("lessons[%d]", i), levelIDs, lessonIDs, exampleIDs); err != nil {
			return err
		}
	}
	return nil
}

func (l Lesson) validate(p string, levelIDs, lessonIDs, exampleIDs map[string]bool) error {
	if err := checkID(p+".id", l.ID); err != nil {
		return err
	}
	if lessonIDs[l.ID] {
		return fmt.Errorf("%s.id: %q is used twice", p, l.ID)
	}
	lessonIDs[l.ID] = true
	if !levelIDs[l.Level] {
		return fmt.Errorf("%s.level: %q is not one of levels", p, l.Level)
	}
	if err := text(p+".title", l.Title, true, maxTitle); err != nil {
		return err
	}
	if err := text(p+".summary", l.Summary, true, maxSummary); err != nil {
		return err
	}
	if len(l.Pattern) > maxPatternLines {
		return fmt.Errorf("%s.pattern: %d lines, at most %d", p, len(l.Pattern), maxPatternLines)
	}
	for i, s := range l.Pattern {
		if err := text(fmt.Sprintf("%s.pattern[%d]", p, i), s, true, maxPatternLine); err != nil {
			return err
		}
	}
	if n := len(l.Body); n < 1 || n > maxBody {
		return fmt.Errorf("%s.body: %d paragraphs, want 1 to %d", p, n, maxBody)
	}
	for i, s := range l.Body {
		if err := text(fmt.Sprintf("%s.body[%d]", p, i), s, true, maxParagraph); err != nil {
			return err
		}
	}
	if n := len(l.Examples); n < 1 || n > maxExamples {
		return fmt.Errorf("%s.examples: %d examples, want 1 to %d", p, n, maxExamples)
	}
	for i, e := range l.Examples {
		if err := e.validate(fmt.Sprintf("%s.examples[%d]", p, i), exampleIDs); err != nil {
			return err
		}
	}
	return nil
}

func (e Example) validate(p string, exampleIDs map[string]bool) error {
	if err := checkID(p+".id", e.ID); err != nil {
		return err
	}
	if exampleIDs[e.ID] {
		return fmt.Errorf("%s.id: %q is used twice", p, e.ID)
	}
	exampleIDs[e.ID] = true
	if err := text(p+".text", e.Text, true, maxExampleText); err != nil {
		return err
	}
	if err := text(p+".reading", e.Reading, false, maxExampleText); err != nil {
		return err
	}
	if err := text(p+".translation", e.Translation, true, maxExampleText); err != nil {
		return err
	}
	if e.Focus != "" && !strings.Contains(e.Text, e.Focus) {
		return fmt.Errorf("%s.focus: %q does not occur in text", p, e.Focus)
	}
	if len(e.Distractors) > maxDistractors {
		return fmt.Errorf("%s.distractors: %d distractors, at most %d", p, len(e.Distractors), maxDistractors)
	}
	seen := map[string]bool{}
	for i, s := range e.Distractors {
		q := fmt.Sprintf("%s.distractors[%d]", p, i)
		switch {
		case strings.TrimSpace(s) == "":
			return fmt.Errorf("%s: must not be empty", q)
		case runes(s) > maxDistractor:
			return fmt.Errorf("%s: %d characters, at most %d", q, runes(s), maxDistractor)
		case s == e.Focus:
			return fmt.Errorf("%s: %q equals focus", q, s)
		case seen[s]:
			return fmt.Errorf("%s: %q is listed twice", q, s)
		}
		seen[s] = true
	}
	return nil
}
