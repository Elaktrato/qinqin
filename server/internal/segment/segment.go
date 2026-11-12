// Package segment finds dictionary words in running zh/ja text by greedy
// longest match. Offsets are Unicode code points, never bytes or UTF-16.
package segment

import (
	"context"
	"fmt"
	"unicode"

	"qinqin/internal/entries"
)

// MaxWordRunes is the longest word, in code points, the tokenizer tries.
const MaxWordRunes = 12

// Candidate is one dictionary entry a match resolves to.
type Candidate struct {
	ID   int64
	Kind string // "character" | "word"
}

// Match is one recognized word in the text.
type Match struct {
	Surface    string      // text as written in the input
	Start, End int         // code-point offsets, End exclusive
	Lemma      string      // dictionary form (== Surface unless deinflected)
	Reason     string      // "" or deinflection reason, e.g. "past"
	Entries    []Candidate // all entries with written == Lemma
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
	found, err := s.Entries.EntriesByWritten(ctx, language, prefixes)
	if err != nil {
		return nil, fmt.Errorf("segment lookup: %w", err)
	}
	for l := n; l >= 1; l-- {
		es := found[prefixes[l-1]]
		if len(es) == 0 {
			continue
		}
		m := &Match{
			Surface: prefixes[l-1],
			Start:   offset,
			End:     offset + l,
			Lemma:   prefixes[l-1],
		}
		for _, e := range es {
			m.Entries = append(m.Entries, Candidate{ID: e.ID, Kind: e.Kind})
		}
		return m, nil
	}
	// Seam: Japanese deinflection plugs in here (a lang.Deinflector found
	// via lang.For(language) type assertion; absent means no deinflection).
	return nil, nil
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
