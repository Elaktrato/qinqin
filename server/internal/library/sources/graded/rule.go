package graded

import (
	"slices"
	"strings"
	"unicode"
)

// The level rule's two numbers (docs/contracts/graded/level-rule.json): a text fits a level when at least
// MinCoveragePercent of its counted tokens are at or below the level and at most MaxAbove distinct words are above
// it. 95 % is the "read next" target (#183): a learner who knows the level's words reads the text at 95 %.
const (
	MinCoveragePercent = 95
	MaxAbove           = 6
)

// Token is one segmenter match of a text, reduced to what the level rule reads: its code-point range, its surface
// and lemma, the lowest word level index of any of its entries (nil when no entry is listed) and whether it is a
// function word.
type Token struct {
	Start    int    `json:"start"`
	End      int    `json:"end"`
	Surface  string `json:"surface"`
	Lemma    string `json:"lemma"`
	Level    *int   `json:"level"`
	Function bool   `json:"function"`
}

// Report is a text counted against its level list.
type Report struct {
	// Counted is the number of counted tokens: matches that are no function word and overlap no name, plus one
	// for every run of letters no match covers (outside the names).
	Counted int
	// Within is the number of counted tokens at or below the declared level.
	Within int
	// Above are the distinct lemmas above the declared level, in first-occurrence order.
	Above []string
	// ComputedLevel is the lowest level index at which the text fits; nil when it fits none.
	ComputedLevel *int
	// Unglossed are the words of Above whose lemma and surface are both missing from the glosses.
	Unglossed []string
	// OK: the computed level is the declared one and every above-level word is glossed.
	OK bool
}

// counted is one counted token: its key (lemma), its surface and its level.
type counted struct {
	lemma, surface string
	level          *int
}

// Check counts a text (its paragraphs joined, as the tokens' offsets read it) against a word level list of levels
// levels (docs/contracts/graded/README.md, Level rule).
func Check(text string, names []string, tokens []Token, levels, declared int, glosses []string) Report {
	runes := []rune(text)
	inName := make([]bool, len(runes))
	for _, n := range names {
		nr := []rune(n)
		if len(nr) == 0 {
			continue
		}
		for i := 0; i+len(nr) <= len(runes); {
			if slices.Equal(runes[i:i+len(nr)], nr) {
				for j := i; j < i+len(nr); j++ {
					inName[j] = true
				}
				i += len(nr)
				continue
			}
			i++
		}
	}
	covered := make([]bool, len(runes))
	var items []counted
	type placed struct {
		at int
		c  counted
	}
	var order []placed
	for _, tk := range tokens {
		start, end := max(tk.Start, 0), min(tk.End, len(runes))
		overlaps := false
		for i := start; i < end; i++ {
			covered[i] = true
			if inName[i] {
				overlaps = true
			}
		}
		if tk.Function || overlaps || start >= end {
			continue
		}
		lemma := tk.Lemma
		if lemma == "" {
			lemma = tk.Surface
		}
		order = append(order, placed{start, counted{lemma, tk.Surface, tk.Level}})
	}
	for i := 0; i < len(runes); {
		if covered[i] || inName[i] || !unicode.IsLetter(runes[i]) {
			i++
			continue
		}
		j := i
		for j < len(runes) && !covered[j] && !inName[j] && unicode.IsLetter(runes[j]) {
			j++
		}
		run := string(runes[i:j])
		order = append(order, placed{i, counted{run, run, nil}})
		i = j
	}
	slices.SortStableFunc(order, func(a, b placed) int { return a.at - b.at })
	for _, p := range order {
		items = append(items, p.c)
	}

	within := func(c counted, level int) bool { return c.level != nil && *c.level <= level }
	above := func(level int) []string {
		var out []string
		for _, c := range items {
			if !within(c, level) && !slices.Contains(out, c.lemma) {
				out = append(out, c.lemma)
			}
		}
		return out
	}
	fits := func(level int) bool {
		n := 0
		for _, c := range items {
			if within(c, level) {
				n++
			}
		}
		return n*100 >= MinCoveragePercent*len(items) && len(above(level)) <= MaxAbove
	}

	r := Report{Counted: len(items)}
	for _, c := range items {
		if within(c, declared) {
			r.Within++
		}
	}
	r.Above = above(declared)
	for l := 0; l < levels; l++ {
		if fits(l) {
			r.ComputedLevel = &l
			break
		}
	}
	for _, a := range r.Above {
		surface := a
		for _, c := range items {
			if c.lemma == a {
				surface = c.surface
				break
			}
		}
		if !slices.Contains(glosses, a) && !slices.Contains(glosses, surface) {
			r.Unglossed = append(r.Unglossed, a)
		}
	}
	r.OK = r.ComputedLevel != nil && *r.ComputedLevel == declared && len(r.Unglossed) == 0
	return r
}

// Body is a text's paragraphs joined by a line break: the text the level rule and the segmenter read.
func Body(paragraphs []string) string { return strings.Join(paragraphs, "\n") }
