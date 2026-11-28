// Package graded holds the graded readers (#231): short stories, dialogues and informational texts written for
// qinqin at each level of a word level list (≈ HSK 1–4, ≈ N5–N3), five a level, CC BY 4.0, reviewed by agents acting
// as teachers. They are embedded project data (texts/*.json, the format in docs/contracts/graded/), served as the
// library source "graded": a text is added to a workspace's library as a one-chapter book. The level rule
// (rule.go) is what the level check (level_test.go) holds every text to.
package graded

import (
	"bytes"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"regexp"
	"slices"
	"strings"
	"sync"
	"unicode"
	"unicode/utf8"
)

// FormatVersion is the text file format of docs/contracts/graded/README.md.
const FormatVersion = 1

// License is the licence every text file carries: the project's own text (CC BY 4.0).
const License = "CC-BY-4.0"

// The kinds of text.
const (
	KindStory    = "story"
	KindDialogue = "dialogue"
	KindInfo     = "info"
)

// Limits of the format.
const (
	maxTitleRunes     = 40
	maxParagraphs     = 80
	maxParagraphRunes = 600
	maxNames          = 10
	maxNameRunes      = 20
	maxGlosses        = 8
	maxWordRunes      = 20
	maxReadingRunes   = 60
	maxMeaningRunes   = 120
	maxLevels         = 12
	maxLevelNameRunes = 20
)

// File is one language's text file.
type File struct {
	Version       int      `json:"version"`
	Language      string   `json:"language"`
	Scheme        string   `json:"scheme"`
	Levels        []string `json:"levels"`
	License       string   `json:"license"`
	Attribution   string   `json:"attribution"`
	HumanReviewed bool     `json:"humanReviewed"`
	Texts         []Text   `json:"texts"`
}

// Text is one graded text.
type Text struct {
	ID         string   `json:"id"`
	Level      int      `json:"level"`
	Kind       string   `json:"kind"`
	Title      string   `json:"title"`
	Paragraphs []string `json:"paragraphs"`
	Names      []string `json:"names"`
	Glosses    []Gloss  `json:"glosses"`
}

// Gloss is a word above the text's level, with its reading and a short English meaning.
type Gloss struct {
	Word    string `json:"word"`
	Reading string `json:"reading"`
	Meaning string `json:"meaning"`
}

var (
	languageRe = regexp.MustCompile(`^[a-z]{2,3}$`)
	idRe       = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)
)

// Parse reads and checks a text file; every refusal says what is wrong.
func Parse(raw []byte) (File, error) {
	var f File
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&f); err != nil {
		return File{}, fmt.Errorf("graded: %w", err)
	}
	if err := f.check(); err != nil {
		return File{}, fmt.Errorf("graded: %w", err)
	}
	return f, nil
}

func (f *File) check() error {
	if f.Version != FormatVersion {
		return fmt.Errorf("version %d, want %d", f.Version, FormatVersion)
	}
	if !languageRe.MatchString(f.Language) {
		return fmt.Errorf("language %q is not a language code", f.Language)
	}
	if strings.TrimSpace(f.Scheme) == "" {
		return errors.New("no scheme")
	}
	if len(f.Levels) == 0 || len(f.Levels) > maxLevels {
		return fmt.Errorf("levels: %d, want 1 to %d", len(f.Levels), maxLevels)
	}
	for i, l := range f.Levels {
		if !plain(l, maxLevelNameRunes) || slices.Contains(f.Levels[:i], l) {
			return fmt.Errorf("levels: %q is empty, too long or repeated", l)
		}
	}
	if f.License != License {
		return fmt.Errorf("license %q, want %s", f.License, License)
	}
	if strings.TrimSpace(f.Attribution) == "" {
		return errors.New("no attribution")
	}
	if len(f.Texts) == 0 {
		return errors.New("no texts")
	}
	seen := map[string]bool{}
	for i := range f.Texts {
		t := &f.Texts[i]
		if t.Names == nil {
			t.Names = []string{}
		}
		if t.Glosses == nil {
			t.Glosses = []Gloss{}
		}
		if err := f.checkText(t); err != nil {
			return fmt.Errorf("text %q: %w", t.ID, err)
		}
		if seen[t.ID] {
			return fmt.Errorf("text %q: id repeated", t.ID)
		}
		seen[t.ID] = true
	}
	return nil
}

func (f *File) checkText(t *Text) error {
	if len(t.ID) > 40 || !idRe.MatchString(t.ID) || !strings.HasPrefix(t.ID, f.Language+"-") {
		return fmt.Errorf("id must be %s- and lowercase letters, digits and hyphens (at most 40)", f.Language)
	}
	if t.Level < 0 || t.Level >= len(f.Levels) {
		return fmt.Errorf("level %d is not one of the %d levels", t.Level, len(f.Levels))
	}
	switch t.Kind {
	case KindStory, KindDialogue, KindInfo:
	default:
		return fmt.Errorf("kind %q is not story, dialogue or info", t.Kind)
	}
	if !plain(t.Title, maxTitleRunes) {
		return fmt.Errorf("title must be 1 to %d characters without control characters", maxTitleRunes)
	}
	if len(t.Paragraphs) == 0 || len(t.Paragraphs) > maxParagraphs {
		return fmt.Errorf("paragraphs: %d, want 1 to %d", len(t.Paragraphs), maxParagraphs)
	}
	for _, p := range t.Paragraphs {
		if strings.TrimSpace(p) != p || p == "" || utf8.RuneCountInString(p) > maxParagraphRunes {
			return fmt.Errorf("paragraph %q is empty, padded or longer than %d characters", short(p), maxParagraphRunes)
		}
		for _, r := range p {
			if unicode.IsControl(r) {
				return fmt.Errorf("paragraph %q has a control character", short(p))
			}
			if r < utf8.RuneSelf && (unicode.IsLetter(r) || unicode.IsDigit(r)) {
				return fmt.Errorf("paragraph %q has Latin letters or digits", short(p))
			}
		}
	}
	body := Body(t.Paragraphs)
	if len(t.Names) > maxNames {
		return fmt.Errorf("names: %d, at most %d", len(t.Names), maxNames)
	}
	for _, n := range t.Names {
		if !plain(n, maxNameRunes) || !strings.Contains(body, n) {
			return fmt.Errorf("name %q is empty, too long or not in the text", n)
		}
	}
	if len(t.Glosses) > maxGlosses {
		return fmt.Errorf("gloss: %d glosses, at most %d", len(t.Glosses), maxGlosses)
	}
	words := map[string]bool{}
	for _, g := range t.Glosses {
		if !plain(g.Word, maxWordRunes) || !plain(g.Reading, maxReadingRunes) || !plain(g.Meaning, maxMeaningRunes) {
			return fmt.Errorf("gloss %q needs a word, a reading and a meaning (at most %d, %d and %d characters)",
				g.Word, maxWordRunes, maxReadingRunes, maxMeaningRunes)
		}
		if words[g.Word] {
			return fmt.Errorf("gloss %q repeated", g.Word)
		}
		words[g.Word] = true
	}
	return nil
}

// plain: not empty, not padded, at most n runes, no control characters.
func plain(s string, n int) bool {
	if s == "" || strings.TrimSpace(s) != s || utf8.RuneCountInString(s) > n {
		return false
	}
	return !strings.ContainsFunc(s, unicode.IsControl)
}

func short(s string) string {
	r := []rune(s)
	if len(r) > 12 {
		return string(r[:12]) + "…"
	}
	return s
}

// Length is the number of letters of a text's paragraphs (Han, kana; punctuation and spaces not counted).
func Length(t Text) int {
	n := 0
	for _, p := range t.Paragraphs {
		for _, r := range p {
			if unicode.IsLetter(r) {
				n++
			}
		}
	}
	return n
}

//go:embed texts/*.json
var embedded embed.FS

var (
	loadOnce sync.Once
	files    []File
	loadErr  error
)

// Files returns the embedded text files, in language order (ja, zh). A file that does not parse is a build bug;
// the tests parse every one.
func Files() ([]File, error) {
	loadOnce.Do(func() {
		names, err := fs.Glob(embedded, "texts/*.json")
		if err != nil {
			loadErr = err
			return
		}
		slices.Sort(names)
		for _, n := range names {
			raw, err := embedded.ReadFile(n)
			if err != nil {
				loadErr = err
				return
			}
			f, err := Parse(raw)
			if err != nil {
				loadErr = fmt.Errorf("%s: %w", n, err)
				return
			}
			files = append(files, f)
		}
	})
	return files, loadErr
}
