// Package topics holds the fixed topic list and the topic labels of words (#220): which themes (food, family,
// travel …) a word belongs to, so a course can fill its units by theme (#221). The labels are written for this
// project and released under CC BY 4.0 (LICENSING.md): suggested by an agent, reviewed by agents acting as
// native-language teachers, or taken from the group of the word's OpenMoji picture; the owner reviews them later
// (`humanReviewed`). The files are built by scripts/build-topic-labels.mjs and embedded here.
//
// Format and rules: docs/contracts/topics/README.md; fixtures topics.json and labels.json.
package topics

import (
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"math"
	"regexp"
	"slices"
	"sort"
	"unicode"
)

//go:embed topics.json
var listJSON []byte

//go:embed labels/*.json
var embedded embed.FS

// Limits of a labels file.
const (
	// MaxTopics is the most topics a label gives a word.
	MaxTopics    = 3
	maxSense     = 99
	maxTextBytes = 100
	maxNoteBytes = 2000
	maxLabels    = 50000
)

var (
	idPattern       = regexp.MustCompile(`^[a-z][a-z0-9]{1,23}$`)
	languagePattern = regexp.MustCompile(`^[a-z]{2,3}$`)
	reviewerPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,39}$`)
	bases           = []string{"agent", "picture", "owner"}
	reviews         = []string{"confirmed", "changed", "adjudicated", "disputed", "picture", "owner"}
)

// Topic is one entry of the topic list. Scope says in English what belongs to it, for the people and agents who
// label words; the name a learner sees is the message `topics.name.<id>`.
type Topic struct {
	ID    string `json:"id"`
	Scope string `json:"scope"`
}

var list = func() []Topic {
	var doc struct {
		Topics []Topic `json:"topics"`
	}
	if err := json.Unmarshal(listJSON, &doc); err != nil {
		panic(fmt.Sprintf("topics.json: %v", err))
	}
	return doc.Topics
}()

// List returns the topics in list order.
func List() []Topic { return slices.Clone(list) }

// ListJSON returns the embedded topic list file (the contract fixture's copy).
func ListJSON() []byte { return slices.Clone(listJSON) }

// Known reports whether id is a topic of the list.
func Known(id string) bool {
	return slices.ContainsFunc(list, func(t Topic) bool { return t.ID == id })
}

// Reviewer is one labeller or reviewer a file names (an agent, until the owner's review).
type Reviewer struct {
	ID    string `json:"id"`
	Kind  string `json:"kind"`
	Stage string `json:"stage"`
	Role  string `json:"role"`
}

// Label gives a word, or one sense of it, its topics, best first.
type Label struct {
	// Key is the dictionary entry key (zh: the simplified form; ja: `j:<ent_seq>`).
	Key string `json:"key"`
	// Form and Reading are the word as a level list writes it; Reading is optional.
	Form    string `json:"form"`
	Reading string `json:"reading,omitempty"`
	// Sense is 0 for the whole word, else the 1-based sense of the entry as the importer numbers it.
	Sense      int      `json:"sense,omitempty"`
	Topics     []string `json:"topics"`
	Confidence float64  `json:"confidence"`
	// Basis: agent, picture or owner. Review: confirmed, changed, adjudicated, disputed (agent labels), picture, owner.
	Basis  string   `json:"basis"`
	Review string   `json:"review"`
	By     []string `json:"by,omitempty"`
	Note   string   `json:"note,omitempty"`
}

// File is one language's labels file.
type File struct {
	Version       int        `json:"version"`
	Language      string     `json:"language"`
	License       string     `json:"license"`
	Attribution   string     `json:"attribution"`
	HumanReviewed bool       `json:"humanReviewed"`
	Reviewers     []Reviewer `json:"reviewers"`
	Labels        []Label    `json:"labels"`
}

// Parse decodes and checks a labels file (README "The labels file").
func Parse(data []byte) (*File, error) {
	var f File
	if err := json.Unmarshal(data, &f); err != nil {
		return nil, fmt.Errorf("topic labels: %w", err)
	}
	if f.Version != 1 {
		return nil, fmt.Errorf("topic labels: version %d, want 1", f.Version)
	}
	if !languagePattern.MatchString(f.Language) {
		return nil, fmt.Errorf("topic labels: language %q", f.Language)
	}
	if f.License != "CC-BY-4.0" {
		return nil, fmt.Errorf("topic labels: license %q, want CC-BY-4.0", f.License)
	}
	if f.Attribution == "" {
		return nil, errors.New("topic labels: no attribution")
	}
	reviewers := map[string]bool{}
	for _, r := range f.Reviewers {
		if !reviewerPattern.MatchString(r.ID) || reviewers[r.ID] {
			return nil, fmt.Errorf("topic labels: reviewer id %q", r.ID)
		}
		reviewers[r.ID] = true
	}
	if len(f.Labels) == 0 || len(f.Labels) > maxLabels {
		return nil, fmt.Errorf("topic labels: %d labels", len(f.Labels))
	}
	seen := map[[4]string]bool{}
	for i, l := range f.Labels {
		if err := checkLabel(l, reviewers); err != nil {
			return nil, fmt.Errorf("topic labels: label %d (%s): %w", i+1, l.Form, err)
		}
		id := [4]string{l.Key, l.Form, l.Reading, fmt.Sprint(l.Sense)}
		if seen[id] {
			return nil, fmt.Errorf("topic labels: label %d: %s sense %d twice", i+1, l.Form, l.Sense)
		}
		seen[id] = true
	}
	return &f, nil
}

func checkLabel(l Label, reviewers map[string]bool) error {
	if l.Key == "" || len(l.Key) > maxTextBytes || l.Form == "" || len(l.Form) > maxTextBytes || len(l.Reading) > maxTextBytes {
		return errors.New("key, form or reading empty or too long")
	}
	if l.Sense < 0 || l.Sense > maxSense {
		return fmt.Errorf("sense %d", l.Sense)
	}
	if len(l.Topics) == 0 || len(l.Topics) > MaxTopics {
		return fmt.Errorf("%d topics", len(l.Topics))
	}
	for i, t := range l.Topics {
		if !Known(t) || slices.Contains(l.Topics[:i], t) {
			return fmt.Errorf("topic %q unknown or twice", t)
		}
	}
	if !(l.Confidence > 0 && l.Confidence <= 1) || math.IsNaN(l.Confidence) {
		return fmt.Errorf("confidence %v", l.Confidence)
	}
	if !slices.Contains(bases, l.Basis) || !slices.Contains(reviews, l.Review) {
		return fmt.Errorf("basis %q, review %q", l.Basis, l.Review)
	}
	if l.Basis == "agent" && len(l.By) == 0 {
		return errors.New("an agent label names no reviewer")
	}
	for _, by := range l.By {
		if !reviewers[by] {
			return fmt.Errorf("reviewer %q is not in the file", by)
		}
	}
	if len(l.Note) > maxNoteBytes {
		return errors.New("note too long")
	}
	return nil
}

// Load returns the embedded labels of a language, or nil when it has none.
func Load(language string) (*File, error) {
	raw, err := embedded.ReadFile("labels/" + language + ".json")
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return Parse(raw)
}

func isKana(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if !unicode.In(r, unicode.Hiragana, unicode.Katakana) && r != 'ー' {
			return false
		}
	}
	return true
}

// TopicsFor returns the topics of a listed word (README "Looking up a word"): the rows with its form, and with its
// reading when both have one; for a kana word with no such row, the rows with that reading. The word row comes
// first, then the sense rows in sense order; each topic once. Nil when no row matches.
func (f *File) TopicsFor(form, reading string) []string {
	var rows []Label
	for _, l := range f.Labels {
		if l.Form == form && (reading == "" || l.Reading == "" || l.Reading == reading) {
			rows = append(rows, l)
		}
	}
	if len(rows) == 0 && reading == "" && isKana(form) {
		for _, l := range f.Labels {
			if l.Reading == form {
				rows = append(rows, l)
			}
		}
	}
	sort.SliceStable(rows, func(i, j int) bool { return rows[i].Sense < rows[j].Sense })
	var out []string
	for _, r := range rows {
		for _, t := range r.Topics {
			if !slices.Contains(out, t) {
				out = append(out, t)
			}
		}
	}
	return out
}
