package courses

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"unicode"
	"unicode/utf8"

	"qinqin/internal/topics"
)

// Format limits of course.json (docs/contracts/courses/README.md "The pack").
const (
	// MaxFileBytes caps course.json.
	MaxFileBytes   = 2 << 20
	maxSections    = 50
	maxUnits       = 1000
	maxTopics      = 8
	maxGrammar     = 6
	maxCharacters  = 60
	maxTitleBytes  = 200
	maxTextBytes   = 8000
	maxIDBytes     = 64
	maxQuestions   = 200
	maxEstimate    = 100000
	defaultUnit    = 80
	defaultSection = 75
)

var (
	idPattern      = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)
	languageRe     = regexp.MustCompile(`^[a-z]{2,3}$`)
	packIDPattern  = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)
	pointPattern   = regexp.MustCompile(`^[A-Za-z0-9._-]{1,128}:[a-z0-9]+(-[a-z0-9]+)*$`)
	titleLanguage  = regexp.MustCompile(`^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$`)
	focusValues    = []string{"listening", "speaking"}
	errNoEnglish   = errors.New("no English title")
	errEmptyTitle  = errors.New("an empty title")
	errLongTitle   = errors.New("a title longer than 200 bytes")
	errTitleLocale = errors.New("a title in an unknown language")
)

// Title is a text in the interface languages, keyed by language code; "en" is required.
type Title map[string]string

// Course is a parsed course.json: the skeleton the project writes. It names no level-list words.
type Course struct {
	Version     int         `json:"version"`
	Language    string      `json:"language"`
	Title       Title       `json:"title"`
	Levels      *Levels     `json:"levels,omitempty"`
	Checkpoints Checkpoints `json:"checkpoints"`
	Sections    []Section   `json:"sections"`
}

// Levels names where the words come from: the levels pack (Scheme, a pack id) and, when it is not installed, the
// frequency estimate: Estimate[i] is the largest frequency rank of level i+1.
type Levels struct {
	Scheme   string `json:"scheme,omitempty"`
	Estimate []int  `json:"estimate,omitempty"`
}

// Checkpoint is one checkpoint rule: the number of questions and, for tests and exams, the pass mark in percent.
type Checkpoint struct {
	Questions   int `json:"questions"`
	PassPercent int `json:"passPercent,omitempty"`
}

// Checkpoints are the lesson check, the unit test and the section exam.
type Checkpoints struct {
	Lesson  Checkpoint `json:"lesson"`
	Unit    Checkpoint `json:"unit"`
	Section Checkpoint `json:"section"`
}

// Section is one section: a target level (a 1-based position in the course's level scheme; nil for a start
// section, which gets no words) and its units.
type Section struct {
	ID    string `json:"id"`
	Level *int   `json:"level"`
	Title Title  `json:"title"`
	Units []Unit `json:"units"`
}

// Unit is one unit of a section. Its id is stable: progress is kept by it.
type Unit struct {
	ID         string   `json:"id"`
	Title      Title    `json:"title"`
	Topics     []string `json:"topics,omitempty"`
	Grammar    []string `json:"grammar,omitempty"`
	Characters []string `json:"characters,omitempty"`
	Text       *Text    `json:"text,omitempty"`
	Focus      string   `json:"focus,omitempty"`
	// Test is whether a unit test closes the unit (default true).
	Test *bool `json:"test,omitempty"`
}

// HasTest reports whether a unit test closes the unit.
func (u Unit) HasTest() bool { return u.Test == nil || *u.Test }

// Text is a unit's reading text, in the course's language, with optional translations.
type Text struct {
	Title       string `json:"title"`
	Body        string `json:"body"`
	Translation Title  `json:"translation,omitempty"`
}

// Parse decodes and checks a course.json. Every refusal names what is wrong ("course: …").
func Parse(raw []byte) (*Course, error) {
	if len(raw) > MaxFileBytes {
		return nil, errors.New("course: course.json is larger than 2 MiB")
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	var c Course
	if err := dec.Decode(&c); err != nil {
		return nil, fmt.Errorf("course: %v", err)
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return nil, errors.New("course: data after the course")
	}
	if err := c.check(); err != nil {
		return nil, fmt.Errorf("course: %w", err)
	}
	if c.Checkpoints.Unit.PassPercent == 0 {
		c.Checkpoints.Unit.PassPercent = defaultUnit
	}
	if c.Checkpoints.Section.PassPercent == 0 {
		c.Checkpoints.Section.PassPercent = defaultSection
	}
	return &c, nil
}

func (c *Course) check() error {
	if c.Version != 1 {
		return fmt.Errorf("version %d, want 1", c.Version)
	}
	if !languageRe.MatchString(c.Language) {
		return fmt.Errorf("language %q", c.Language)
	}
	if err := c.Title.check(); err != nil {
		return fmt.Errorf("course title: %w", err)
	}
	if err := c.Levels.check(); err != nil {
		return err
	}
	if err := c.Checkpoints.check(); err != nil {
		return err
	}
	if len(c.Sections) == 0 {
		return errors.New("no sections")
	}
	if len(c.Sections) > maxSections {
		return fmt.Errorf("%d sections, at most %d", len(c.Sections), maxSections)
	}
	ids := map[string]bool{}
	chars := map[string]string{}
	units, last := 0, 0
	for _, s := range c.Sections {
		if err := checkID(s.ID, ids); err != nil {
			return fmt.Errorf("section id %q%w", s.ID, err)
		}
		if err := s.Title.check(); err != nil {
			return fmt.Errorf("section %s: %w", s.ID, err)
		}
		if s.Level != nil {
			if *s.Level < 1 {
				return fmt.Errorf("section %s: level %d, levels count from 1", s.ID, *s.Level)
			}
			if *s.Level <= last {
				return fmt.Errorf("section %s: level %d after level %d, levels rise from section to section", s.ID, *s.Level, last)
			}
			last = *s.Level
		}
		if len(s.Units) == 0 {
			return fmt.Errorf("section %s has no units", s.ID)
		}
		for _, u := range s.Units {
			units++
			if err := checkID(u.ID, ids); err != nil {
				return fmt.Errorf("unit id %q%w", u.ID, err)
			}
			if err := u.check(chars); err != nil {
				return fmt.Errorf("unit %s: %w", u.ID, err)
			}
		}
	}
	if units > maxUnits {
		return fmt.Errorf("%d units, at most %d", units, maxUnits)
	}
	return nil
}

var errTwice = errors.New(" twice")

func checkID(id string, seen map[string]bool) error {
	if len(id) > maxIDBytes || !idPattern.MatchString(id) {
		return errors.New(": an id is lower-case letters and digits joined by single hyphens, at most 64 bytes")
	}
	if seen[id] {
		return errTwice
	}
	seen[id] = true
	return nil
}

func (t Title) check() error {
	if t["en"] == "" {
		if _, ok := t["en"]; ok {
			return errEmptyTitle
		}
		return errNoEnglish
	}
	for k, v := range t {
		if !titleLanguage.MatchString(k) {
			return errTitleLocale
		}
		if v == "" {
			return errEmptyTitle
		}
		if len(v) > maxTitleBytes || !utf8.ValidString(v) {
			return errLongTitle
		}
	}
	return nil
}

func (l *Levels) check() error {
	if l == nil {
		return nil
	}
	if l.Scheme != "" && (len(l.Scheme) > 128 || !packIDPattern.MatchString(l.Scheme)) {
		return fmt.Errorf("levels: scheme %q is not a pack id", l.Scheme)
	}
	prev := 0
	for _, r := range l.Estimate {
		if r <= prev || r > maxEstimate {
			return fmt.Errorf("levels: the estimate %v must rise, from 1 to %d", l.Estimate, maxEstimate)
		}
		prev = r
	}
	return nil
}

func (c Checkpoints) check() error {
	for _, p := range []struct {
		name string
		cp   Checkpoint
		mark bool
	}{{"lesson", c.Lesson, false}, {"unit", c.Unit, true}, {"section", c.Section, true}} {
		if p.cp.Questions < 0 || p.cp.Questions > maxQuestions {
			return fmt.Errorf("checkpoints: %s questions %d, 0 to %d", p.name, p.cp.Questions, maxQuestions)
		}
		if !p.mark && p.cp.PassPercent != 0 {
			return fmt.Errorf("checkpoints: a lesson check has no passPercent")
		}
		if p.mark && p.cp.PassPercent != 0 && (p.cp.PassPercent < 50 || p.cp.PassPercent > 100) {
			return fmt.Errorf("checkpoints: %s passPercent %d, 50 to 100", p.name, p.cp.PassPercent)
		}
	}
	return nil
}

func (u Unit) check(chars map[string]string) error {
	if err := u.Title.check(); err != nil {
		return err
	}
	if len(u.Topics) > maxTopics {
		return fmt.Errorf("%d topics, at most %d", len(u.Topics), maxTopics)
	}
	for i, t := range u.Topics {
		if !topics.Known(t) {
			return fmt.Errorf("unknown topic %q", t)
		}
		for _, o := range u.Topics[:i] {
			if o == t {
				return fmt.Errorf("topic %q twice", t)
			}
		}
	}
	if len(u.Grammar) > maxGrammar {
		return fmt.Errorf("%d grammar points, at most %d", len(u.Grammar), maxGrammar)
	}
	lessons := map[string]bool{}
	for _, g := range u.Grammar {
		if !pointPattern.MatchString(g) {
			return fmt.Errorf("grammar point %q is not <packId>:<lessonId>", g)
		}
		id := grammarLessonID(g)
		if lessons[id] {
			return fmt.Errorf("grammar lesson %q twice", id)
		}
		lessons[id] = true
	}
	if len(u.Characters) > maxCharacters {
		return fmt.Errorf("%d characters, at most %d", len(u.Characters), maxCharacters)
	}
	for _, ch := range u.Characters {
		r, size := utf8.DecodeRuneInString(ch)
		if size != len(ch) || !unicode.Is(unicode.Han, r) || r == '々' {
			return fmt.Errorf("character %q is not one Han character", ch)
		}
		if other, ok := chars[ch]; ok {
			return fmt.Errorf("character %s twice in the course (also in unit %s)", ch, other)
		}
		chars[ch] = u.ID
	}
	if u.Text != nil {
		if u.Text.Body == "" {
			return errors.New("the text has no body")
		}
		if u.Text.Title == "" || len(u.Text.Title) > maxTitleBytes {
			return errors.New("the text has no title or a title longer than 200 bytes")
		}
		if len(u.Text.Body) > maxTextBytes {
			return fmt.Errorf("the text is longer than %d bytes", maxTextBytes)
		}
		if u.Text.Translation != nil {
			if err := u.Text.Translation.check(); err != nil {
				return fmt.Errorf("the text's translation: %w", err)
			}
		}
	}
	if u.Focus != "" && u.Focus != focusValues[0] && u.Focus != focusValues[1] {
		return fmt.Errorf("focus %q, want listening or speaking", u.Focus)
	}
	return nil
}

// grammarLessonID is the lesson part of a grammar point.
func grammarLessonID(point string) string {
	for i := len(point) - 1; i >= 0; i-- {
		if point[i] == ':' {
			return point[i+1:]
		}
	}
	return point
}
