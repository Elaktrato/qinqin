// Package starter holds the Starter sets (#214): a short, hand-reviewed list of
// common, picturable words per language, written for this project and released
// with it (the word choice is ours; the dictionary data it points at stays in
// the dictionaries). A set names words the way a level or frequency list does
// (a written form and optionally a reading) and the picture each word is
// expected to have in an images pack; the server resolves the words to
// dictionary entries and the web client copies them into the learner's own deck.
//
// Format and rules: docs/contracts/starter/README.md; fixtures set.json.
package starter

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"

	"qinqin/internal/freq"
	"qinqin/internal/lexicon"
)

//go:embed sets/*.json
var embedded embed.FS

// Limits of a set.
const (
	// MaxWords is the largest set: the issue asks for 100-300 words per language.
	MaxWords      = 300
	maxFormBytes  = 100
	maxNameBytes  = 100
	maxCreditSize = 500
)

var (
	idPattern      = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,39}$`)
	languagePat    = regexp.MustCompile(`^[a-z]{2,3}$`)
	conceptPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)
	packIDPattern  = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,63}$`)
)

// Picture is the picture a word is expected to have: the images pack and the
// concept in it. Target is the mapping's target when it is not the word's form
// (a Japanese `j:<ent_seq>` key). A test checks every Picture against the
// committed mapping of its pack, so the set never promises a picture that is not there.
type Picture struct {
	Pack    string `json:"pack"`
	Concept string `json:"concept"`
	Target  string `json:"target,omitempty"`
}

// Word is one word of a set, in learning order.
type Word struct {
	// Form is the written form as a list gives it (a kana row is a kana form).
	Form string `json:"form"`
	// Reading tells homographs apart (月 つき, not げつ); kana or pinyin, optional.
	Reading string `json:"reading,omitempty"`
	// Gloss is a short English note for the people who review the set; it is not shown or stored.
	Gloss   string  `json:"gloss"`
	Picture Picture `json:"picture"`
}

// Set is one language's starter set.
type Set struct {
	Version     int    `json:"version"`
	ID          string `json:"id"`
	Language    string `json:"language"`
	Name        string `json:"name"`
	License     string `json:"license"`
	Attribution string `json:"attribution"`
	// HumanReviewed says a person has read every word against the dictionary; false marks a seed that
	// only the author (an agent) checked.
	HumanReviewed bool `json:"humanReviewed"`
	Words    []Word `json:"words"`
}

// Parse reads and validates one set file.
func Parse(raw []byte) (Set, error) {
	var s Set
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&s); err != nil {
		return Set{}, fmt.Errorf("starter set: %w", err)
	}
	if s.Version != 1 {
		return Set{}, fmt.Errorf("starter set %q: version %d, want 1", s.ID, s.Version)
	}
	if !idPattern.MatchString(s.ID) {
		return Set{}, fmt.Errorf("starter set: bad id %q", s.ID)
	}
	if !languagePat.MatchString(s.Language) {
		return Set{}, fmt.Errorf("starter set %s: bad language %q", s.ID, s.Language)
	}
	for field, v := range map[string]struct {
		text  string
		limit int
	}{"name": {s.Name, maxNameBytes}, "license": {s.License, maxNameBytes}, "attribution": {s.Attribution, maxCreditSize}} {
		if v.text == "" || len(v.text) > v.limit {
			return Set{}, fmt.Errorf("starter set %s: %s must be 1-%d bytes", s.ID, field, v.limit)
		}
	}
	if len(s.Words) == 0 || len(s.Words) > MaxWords {
		return Set{}, fmt.Errorf("starter set %s: %d words, want 1-%d", s.ID, len(s.Words), MaxWords)
	}
	seen := map[string]bool{}
	for i, w := range s.Words {
		if w.Form == "" || len(w.Form) > maxFormBytes || len(w.Reading) > maxFormBytes {
			return Set{}, fmt.Errorf("starter set %s: word %d: form and reading must be at most %d bytes, form not empty", s.ID, i+1, maxFormBytes)
		}
		if k := w.Form + "\x00" + w.Reading; seen[k] {
			return Set{}, fmt.Errorf("starter set %s: word %d (%s) is listed twice", s.ID, i+1, w.Form)
		} else {
			seen[k] = true
		}
		if !packIDPattern.MatchString(w.Picture.Pack) || !conceptPattern.MatchString(w.Picture.Concept) {
			return Set{}, fmt.Errorf("starter set %s: word %d (%s): a picture needs a pack id and a concept", s.ID, i+1, w.Form)
		}
		if len(w.Picture.Target) > maxFormBytes {
			return Set{}, fmt.Errorf("starter set %s: word %d (%s): picture target too long", s.ID, i+1, w.Form)
		}
	}
	return s, nil
}

// Sets returns the sets that ship with the binary, by language then id.
func Sets() ([]Set, error) {
	files, err := fs.Glob(embedded, "sets/*.json")
	if err != nil {
		return nil, err
	}
	sort.Strings(files)
	var out []Set
	ids := map[string]bool{}
	for _, f := range files {
		raw, err := embedded.ReadFile(f)
		if err != nil {
			return nil, err
		}
		s, err := Parse(raw)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", f, err)
		}
		if ids[s.ID] {
			return nil, fmt.Errorf("%s: duplicate set id %q", f, s.ID)
		}
		ids[s.ID] = true
		out = append(out, s)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Language != out[j].Language {
			return out[i].Language < out[j].Language
		}
		return out[i].ID < out[j].ID
	})
	return out, nil
}

// Resolver resolves a word as a list gives it to one entry id. Word is the word rule of the level and
// frequency lists (a written form and optional reading); Character looks a single hanzi up as a character
// entry, because the one-character lines of CC-CEDICT (狗, 水) are character entries in the lexicon, not words.
type Resolver interface {
	BestWordReadingID(ctx context.Context, language, form, reading string) (int64, error)
	BestCharacterID(ctx context.Context, language, form string) (int64, error)
}

// Lexicon is the Resolver of a lexicon store: the starter-deck word rule (freq.StarterResolver: a kana row
// takes the kana-only word first), then the character entry of a single-character form.
type Lexicon struct{ Store lexicon.Store }

// BestWordReadingID implements Resolver.
func (l Lexicon) BestWordReadingID(ctx context.Context, language, form, reading string) (int64, error) {
	return freq.StarterResolver{Lexicon: l.Store}.BestWordReadingID(ctx, language, form, reading)
}

// BestCharacterID implements Resolver.
func (l Lexicon) BestCharacterID(ctx context.Context, language, form string) (int64, error) {
	e, err := l.Store.Best(ctx, language, "character", form)
	if err != nil {
		return 0, err
	}
	return e.ID, nil
}

// Resolved is a word of a set and the entry it resolves to.
type Resolved struct {
	Word    Word
	EntryID int64
	// Character is true when the entry is a character entry (a single hanzi no dictionary lists as a word).
	Character bool
}

// Resolve resolves a set's words in order. A word no dictionary has is left out
// (the learner may have none of that dictionary installed); an entry that an
// earlier word already took is left out too, so a deck never holds one entry twice.
func Resolve(ctx context.Context, r Resolver, s Set) ([]Resolved, error) {
	taken := map[int64]bool{}
	out := make([]Resolved, 0, len(s.Words))
	for _, w := range s.Words {
		character := false
		id, err := r.BestWordReadingID(ctx, s.Language, w.Form, w.Reading)
		if errors.Is(err, lexicon.ErrNotFound) && utf8.RuneCountInString(w.Form) == 1 {
			id, err = r.BestCharacterID(ctx, s.Language, w.Form)
			character = err == nil
		}
		if errors.Is(err, lexicon.ErrNotFound) {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("starter set %s: %s: %w", s.ID, w.Form, err)
		}
		if taken[id] {
			continue
		}
		taken[id] = true
		out = append(out, Resolved{Word: w, EntryID: id, Character: character})
	}
	return out, nil
}
