// Package segment finds dictionary words in running zh/ja text by greedy
// longest match, on top of the lookup engine: one match per position is
// the longest text the ranked lookup matched there. Offsets are Unicode
// code points, never bytes or UTF-16.
package segment

import (
	"context"
	"fmt"

	"qinqin/internal/lang"
	"qinqin/internal/lookup"
)

// MaxReadingCandidates caps the candidates of a match: a common kana word
// can be the reading of dozens of homophones. The cap applies after the
// lookup ranking, so the best ones survive.
const MaxReadingCandidates = 8

// Candidate is one dictionary entry a match resolves to.
type Candidate struct {
	ID   int64  `json:"id"`
	Kind string `json:"kind"` // "character" | "word"
	// Reading is true when the entry matched by one of its kana readings
	// rather than by a written form (Japanese only).
	Reading bool `json:"reading,omitempty"`
}

// Match is one recognized word in the text.
type Match struct {
	Surface string `json:"surface"` // text as written in the input
	Start   int    `json:"start"`   // code-point offset
	End     int    `json:"end"`     // code-point offset, exclusive
	Lemma   string `json:"lemma"`   // dictionary form (== Surface unless deinflected)
	Reason  string `json:"reason"`  // "" or deinflection reason, e.g. "past"
	// Entries are the entries matching Surface, in ranking order, at most
	// MaxReadingCandidates. Only Entries[0] corresponds to Lemma and
	// Reason; later candidates are other readings or entries with the
	// same surface, which may have a different lemma.
	Entries []Candidate `json:"entries"`
	// Reading is the best candidate's reading, set only when the service
	// has WithReadings: for a Japanese form match the entry's first
	// reading, for a reading match the matched one; Chinese pinyin. It is
	// unrelated to Candidate.Reading, the "matched by a reading" flag.
	Reading *Reading `json:"reading,omitempty"`
}

// Reading is one reading of a match: its type ("pinyin", "kana", ...) and
// display value.
type Reading struct {
	Type  string `json:"type"`
	Value string `json:"value"`
}

// Service tokenizes text with the lookup engine.
type Service struct {
	Lookup lookup.Service
	// WithReadings fills Match.Reading.
	WithReadings bool
}

// MatchAt returns the longest dictionary match starting at the code-point
// offset, or nil, nil when nothing matches there (or the offset is out of
// range).
//
// The match is the longest text any lookup result matched; its lemma and
// reason come from the best-ranked result of that length, and its
// entries are the results of that length in ranking order.
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

// matchAt looks up the window of lookup.MaxWindowRunes code points from
// offset — all the engine reads — and shifts the match back to offsets
// of runes.
func (s Service) matchAt(ctx context.Context, language string, runes []rune, offset int) (*Match, error) {
	if offset < 0 || offset >= len(runes) {
		return nil, nil
	}
	window := string(runes[offset:min(offset+lookup.MaxWindowRunes, len(runes))])
	results, err := s.Lookup.Lookup(ctx, language, window, 0, nil)
	if err != nil {
		return nil, fmt.Errorf("segment: %w", err)
	}
	if len(results) == 0 {
		return nil, nil
	}
	// The lookup ranks by matched length first, so the longest match
	// leads and every result of that length follows it.
	best := results[0]
	m := &Match{
		Surface: best.Matched, Start: offset + best.Start, End: offset + best.End,
		Lemma: best.Lemma, Reason: lang.ReasonOf(best.Reasons),
	}
	for _, r := range results {
		if r.Matched != best.Matched || len(m.Entries) == MaxReadingCandidates {
			break
		}
		m.Entries = append(m.Entries, Candidate{ID: r.EntryID, Kind: r.Kind, Reading: r.ViaReading})
	}
	if s.WithReadings {
		m.Reading = readingOf(best)
	}
	return m, nil
}

// readingOf is the reading lookup reports for r (the matched one, else
// the first) with its type, or nil for an entry without readings.
func readingOf(r lookup.Result) *Reading {
	for _, rd := range r.Readings {
		if rd.Value == r.Reading {
			return &Reading{Type: rd.Type, Value: rd.Value}
		}
	}
	if len(r.Readings) > 0 {
		return &Reading{Type: r.Readings[0].Type, Value: r.Readings[0].Value}
	}
	return nil
}
