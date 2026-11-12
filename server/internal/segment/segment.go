// Package segment finds dictionary words in running zh/ja text by greedy
// longest match. Offsets are Unicode code points, never bytes or UTF-16.
package segment

import (
	"context"
	"fmt"
	"slices"
	"unicode"

	"qinqin/internal/entries"
	"qinqin/internal/lang"
	"qinqin/internal/model"
)

// MaxWordRunes is the longest word, in code points, the tokenizer tries.
const MaxWordRunes = 12

// Candidate is one dictionary entry a match resolves to.
type Candidate struct {
	ID   int64  `json:"id"`
	Kind string `json:"kind"` // "character" | "word"
	// Reading is true when the entry matched by one of its kana readings
	// rather than by its written form (Japanese only).
	Reading bool `json:"reading,omitempty"`
}

// Match is one recognized word in the text.
type Match struct {
	Surface string      `json:"surface"` // text as written in the input
	Start   int         `json:"start"`   // code-point offset
	End     int         `json:"end"`     // code-point offset, exclusive
	Lemma   string      `json:"lemma"`   // dictionary form (== Surface unless deinflected)
	Reason  string      `json:"reason"`  // "" or deinflection reason, e.g. "past"
	Entries []Candidate `json:"entries"` // entries written Lemma, else (ja) read Lemma, at most MaxReadingCandidates
}

// Service tokenizes text over the dictionary entries.
type Service struct{ Entries entries.Store }

// MatchAt returns the longest dictionary match starting at the code-point
// offset, or nil, nil when nothing matches there (or the offset is out of
// range).
func (s Service) MatchAt(ctx context.Context, language, text string, offset int) (*Match, error) {
	return s.matchAt(ctx, language, []rune(text), offset)
}

// Segment returns the non-overlapping matches of text in ascending order;
// runs without a match are skipped.
func (s Service) Segment(ctx context.Context, language, text string) ([]Match, error) {
	runes := []rune(text)
	matches := []Match{}
	for i := 0; i < len(runes); {
		m, err := s.matchAt(ctx, language, runes, i)
		if err != nil {
			return nil, err
		}
		if m == nil {
			i++
			continue
		}
		matches = append(matches, *m)
		i = m.End
	}
	return matches, nil
}

func (s Service) matchAt(ctx context.Context, language string, runes []rune, offset int) (*Match, error) {
	if offset < 0 || offset >= len(runes) || !wordStart(language, runes[offset]) {
		return nil, nil
	}
	n := min(MaxWordRunes, len(runes)-offset)
	prefixes := make([]string, n)
	for l := 1; l <= n; l++ {
		prefixes[l-1] = string(runes[offset : offset+l])
	}
	// Deinflected forms of every prefix, when the language inflects.
	deinflector, _ := lang.For(language).(lang.Deinflector)
	var inflected [][]lang.Deinflection
	lookup := slices.Clone(prefixes)
	if deinflector != nil {
		inflected = make([][]lang.Deinflection, n)
		for i, p := range prefixes {
			inflected[i] = deinflector.Deinflect(p)
			for _, d := range inflected[i] {
				lookup = append(lookup, d.Form)
			}
		}
	}
	found, err := s.Entries.EntriesByWritten(ctx, language, lookup)
	if err != nil {
		return nil, fmt.Errorf("segment lookup: %w", err)
	}
	byReading, err := s.readingHits(ctx, language, lookup)
	if err != nil {
		return nil, err
	}
	// Longest surface wins. At equal length a written-form hit beats a
	// reading hit, and within each kind an exact dictionary hit beats a
	// deinflected one. Among deinflected candidates that hit the
	// dictionary, the shallowest deinflection wins, then the order
	// Deinflect returns (shallowest first, rule-table order within a
	// depth). Candidates are not part-of-speech filtered: the dictionary
	// lookup is the only filter.
	for l := n; l >= 1; l-- {
		surface := prefixes[l-1]
		var deins []lang.Deinflection
		if inflected != nil {
			deins = inflected[l-1]
		}
		m := &Match{Surface: surface, Start: offset, End: offset + l}
		if lemma, reason, es := pick(surface, deins, func(f string) []entries.ReadingHit {
			return asHits(found[f])
		}); len(es) > 0 {
			m.Lemma, m.Reason = lemma, reason
			for _, e := range es {
				m.Entries = append(m.Entries, Candidate{ID: e.ID, Kind: e.Kind})
			}
			return m, nil
		}
		if lemma, reason, es := pick(surface, deins, func(f string) []entries.ReadingHit {
			return byReading[f]
		}); len(es) > 0 {
			m.Lemma, m.Reason = lemma, reason
			for _, e := range es[:min(len(es), MaxReadingCandidates)] {
				m.Entries = append(m.Entries, Candidate{ID: e.ID, Kind: e.Kind, Reading: true})
			}
			return m, nil
		}
	}
	return nil, nil
}

// MaxReadingCandidates caps the candidates of a match found by reading:
// a common kana word can be the reading of dozens of homophones. The cap
// applies after EntriesByReading's ranking (usually-kana words first,
// then JMdict priority, reading position, entry id), so the best ones
// survive.
const MaxReadingCandidates = 8

// pick returns the lemma, reason and hits of surface: the exact form when
// it hits, else the first deinflection (in Deinflect order) that does.
func pick(surface string, deins []lang.Deinflection, hits func(string) []entries.ReadingHit) (string, string, []entries.ReadingHit) {
	if es := hits(surface); len(es) > 0 {
		return surface, "", es
	}
	for _, d := range deins {
		if es := hits(d.Form); len(es) > 0 {
			return d.Form, d.Reason, es
		}
	}
	return "", "", nil
}

func asHits(es []model.Entry) []entries.ReadingHit {
	if len(es) == 0 {
		return nil
	}
	out := make([]entries.ReadingHit, len(es))
	for i, e := range es {
		out[i] = entries.ReadingHit{ID: e.ID, Kind: e.Kind, Written: e.Written}
	}
	return out
}

// readingHits looks up the kana-only forms among forms by the kana
// readings of Japanese entries (JMdict stores a word with a kanji form
// under that form only, its kana as readings), keyed by the form as
// given. Other languages, and forms with any non-kana rune, get none.
func (s Service) readingHits(ctx context.Context, language string, forms []string) (map[string][]entries.ReadingHit, error) {
	if language != "ja" {
		return nil, nil
	}
	pack := lang.For(language)
	plainOf := make(map[string]string)
	var plains []string
	for _, f := range forms {
		if _, seen := plainOf[f]; seen || !kanaOnly(f) {
			continue
		}
		p := pack.NormalizeReading("kana", f)
		plainOf[f] = p
		if !slices.Contains(plains, p) {
			plains = append(plains, p)
		}
	}
	if len(plains) == 0 {
		return nil, nil
	}
	hits, err := s.Entries.EntriesByReading(ctx, language, "kana", plains)
	if err != nil {
		return nil, fmt.Errorf("segment reading lookup: %w", err)
	}
	out := make(map[string][]entries.ReadingHit, len(plainOf))
	for f, p := range plainOf {
		if hs := hits[p]; len(hs) > 0 {
			out[f] = hs
		}
	}
	return out, nil
}

// kanaOnly reports whether s is non-empty and made of hiragana, katakana
// and the prolonged sound mark only.
func kanaOnly(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r != 'ー' && !unicode.In(r, unicode.Hiragana, unicode.Katakana) {
			return false
		}
	}
	return true
}

// wordStart reports whether r can begin a word: a letter, except Latin
// letters in zh/ja text.
func wordStart(language string, r rune) bool {
	if !unicode.IsLetter(r) {
		return false
	}
	if (language == "zh" || language == "ja") && unicode.Is(unicode.Latin, r) {
		return false
	}
	return true
}
