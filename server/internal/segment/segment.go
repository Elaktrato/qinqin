// Package segment finds dictionary words in running zh/ja text by greedy
// longest match, on top of the lookup engine: one match per position is
// the longest text the ranked lookup matched there. Offsets are Unicode
// code points, never bytes or UTF-16.
package segment

import (
	"context"
	"fmt"
	"slices"

	"qinqin/internal/lang"
	"qinqin/internal/lemma"
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
	// Stem is set when the first entry matched the stem of a compound
	// lemma (勉強 for 勉強しています, lemma 勉強する): the dictionary-side
	// text furigana aligns against (docs/contracts/reader/).
	Stem string `json:"stem,omitempty"`
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
// runs without a match are skipped. A match is the longest one at its
// position, except that an expression never cuts a longer word
// (splitParticle).
func (s Service) Segment(ctx context.Context, language, text string) ([]Match, error) {
	runes := []rune(text)
	matches := []Match{}
	hints := hintsOf(language)
	for i := 0; i < len(runes); {
		m, results, err := s.lookupAt(ctx, language, runes, i)
		if err != nil {
			return nil, err
		}
		if m == nil {
			i++
			continue
		}
		if p, err := s.splitParticle(ctx, language, runes, i, m, results, hints); err != nil {
			return nil, err
		} else if p != nil {
			m = p
		}
		matches = append(matches, *m)
		i = m.End
	}
	return matches, nil
}

// hintsOf returns the ranking hints of the language's rule table; none
// for a language without one.
func hintsOf(language string) lemma.Hints {
	if d, ok := lang.For(language).(lang.Deinflector); ok {
		return d.Rules().Hints
	}
	return lemma.Hints{}
}

// splitParticle applies the boundary rule (docs/contracts/lemma/README.md):
// when m, the match at offset, is an exact match whose first entry is an
// expression without priority (every sense tagged with
// hints.ExpressionPOS; には and にとって keep theirs), the shortest
// shorter match at offset is a particle (its first entry has a sense
// tagged with hints.ParticlePOS) and the match right after that particle
// ends strictly past m — or ends with m and has a candidate that is a
// strong inflection of a word with priority — the token is the particle: 仕事をしている is
// 仕事 | を | している, not 仕事 | をして | いる, and 仕事をして帰った is
// 仕事 | を | して | 帰った. Nil when the rule does not apply.
func (s Service) splitParticle(ctx context.Context, language string, runes []rune, offset int, m *Match, results []lookup.Result, hints lemma.Hints) (*Match, error) {
	best := results[0]
	if len(hints.ExpressionPOS) == 0 || len(hints.ParticlePOS) == 0 || len(best.Reasons) > 0 || best.Pri > 0 || !everySense(best, hints.ExpressionPOS) {
		return nil, nil
	}
	short := -1
	for i, r := range results {
		if n := r.End - r.Start; n < best.End-best.Start && (short < 0 || n < results[short].End-results[short].Start) {
			short = i
		}
	}
	if short < 0 || !anySense(results[short], hints.ParticlePOS) {
		return nil, nil
	}
	next, nextResults, err := s.lookupAt(ctx, language, runes, offset+results[short].End-results[short].Start)
	if err != nil || next == nil || next.End < m.End {
		return nil, err
	}
	// Ending with the expression, the word after the particle wins only
	// when one of its candidates is a strong (kana fit) inflection of a
	// word with priority: して of する, even where the noun 仕手 ranks
	// first, but not ねない of 寝る in かねない.
	if next.End == m.End && !slices.ContainsFunc(nextResults, func(r lookup.Result) bool {
		return r.Matched == next.Surface && len(r.Reasons) > 0 && r.Pri > 0 && !r.WeakReading
	}) {
		return nil, nil
	}
	return s.matchOf(results, results[short].Matched, offset), nil
}

// everySense reports whether r has senses and each has a tag in tags.
func everySense(r lookup.Result, tags []string) bool {
	return len(r.Senses) > 0 && !slices.ContainsFunc(r.Senses, func(sn lookup.SenseOut) bool {
		return !slices.ContainsFunc(sn.POS, func(p string) bool { return slices.Contains(tags, p) })
	})
}

// anySense reports whether a sense of r has a tag in tags.
func anySense(r lookup.Result, tags []string) bool {
	return slices.ContainsFunc(r.Senses, func(sn lookup.SenseOut) bool {
		return slices.ContainsFunc(sn.POS, func(p string) bool { return slices.Contains(tags, p) })
	})
}

// matchAt looks up the window of lookup.MaxWindowRunes code points from
// offset — all the engine reads — and shifts the match back to offsets
// of runes.
func (s Service) matchAt(ctx context.Context, language string, runes []rune, offset int) (*Match, error) {
	m, _, err := s.lookupAt(ctx, language, runes, offset)
	return m, err
}

// lookupAt is matchAt that also returns the ranked lookup results.
func (s Service) lookupAt(ctx context.Context, language string, runes []rune, offset int) (*Match, []lookup.Result, error) {
	if offset < 0 || offset >= len(runes) {
		return nil, nil, nil
	}
	window := string(runes[offset:min(offset+lookup.MaxWindowRunes, len(runes))])
	results, err := s.Lookup.Lookup(ctx, language, window, 0, nil)
	if err != nil {
		return nil, nil, fmt.Errorf("segment: %w", err)
	}
	if len(results) == 0 {
		return nil, nil, nil
	}
	// The lookup ranks by matched length first, so the longest match
	// leads and every result of that length follows it.
	return s.matchOf(results, results[0].Matched, offset), results, nil
}

// matchOf is the match of the results that matched surface (the first
// of them is its best), at offset.
func (s Service) matchOf(results []lookup.Result, surface string, offset int) *Match {
	var m *Match
	var best lookup.Result
	for _, r := range results {
		if r.Matched != surface {
			continue
		}
		if m == nil {
			best = r
			m = &Match{
				Surface: r.Matched, Start: offset + r.Start, End: offset + r.End,
				Lemma: r.Lemma, Reason: lang.ReasonOf(r.Reasons), Stem: r.Stem,
			}
		}
		if len(m.Entries) == MaxReadingCandidates {
			break
		}
		m.Entries = append(m.Entries, Candidate{ID: r.EntryID, Kind: r.Kind, Reading: r.ViaReading})
	}
	if s.WithReadings {
		m.Reading = readingOf(best)
	}
	return m
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
