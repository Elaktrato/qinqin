package journal

import (
	"fmt"
	"strings"

	"qinqin/internal/ai"
)

const (
	maxAnnotations = 40
	contextRunes   = 8
	maxFieldRunes  = 1000
)

type span struct{ start, end int } // rune offsets

// ResolveAnnotations validates the model's annotations against the text the
// server sent. Prefix and Suffix are computed here from the actual text; the
// model's ContextBefore only picks the occurrence of a repeated quote. An
// annotation that cannot be placed truthfully is dropped and counted.
func ResolveAnnotations(text, lang string, raw []ai.RawAnnotation) ([]Annotation, DropCounts) {
	var drop DropCounts
	runes := []rune(text)
	var kept []Annotation
	var spans []span
	for _, r := range raw {
		quote := strings.TrimSpace(r.Quote)
		corr := strings.TrimSpace(r.Correction)
		switch {
		case quote == "":
			drop.Empty++
			continue
		case corr == quote:
			drop.NoChange++
			continue
		case !CorrectionFitsLanguage(lang, corr):
			drop.WrongScript++
			continue
		}
		q := []rune(quote)
		occ := occurrences(runes, q)
		if len(occ) == 0 {
			drop.NotFound++
			continue
		}
		at := occ[0]
		if len(occ) > 1 {
			if before := []rune(r.ContextBefore); len(before) > 0 {
				for _, o := range occ {
					if o >= len(before) && string(runes[o-len(before):o]) == string(before) {
						at = o
						break
					}
				}
			}
		}
		sp := span{at, at + len(q)}
		overlap := false
		for _, k := range spans {
			if sp.start < k.end && k.start < sp.end {
				overlap = true
				break
			}
		}
		if overlap {
			drop.Overlap++
			continue
		}
		if len(kept) >= maxAnnotations {
			drop.TooMany++
			continue
		}
		spans = append(spans, sp)
		kept = append(kept, Annotation{
			ID:          fmt.Sprintf("a%d", len(kept)+1),
			Quote:       quote,
			Prefix:      string(runes[max(0, sp.start-contextRunes):sp.start]),
			Suffix:      string(runes[sp.end:min(len(runes), sp.end+contextRunes)]),
			Correction:  cutRunes(corr, maxFieldRunes),
			Explanation: cutRunes(strings.TrimSpace(r.Explanation), maxFieldRunes),
			Category:    cutRunes(strings.TrimSpace(r.Category), 40),
		})
	}
	return kept, drop
}

func occurrences(text, q []rune) []int {
	var out []int
	for i := 0; i+len(q) <= len(text); i++ {
		if string(text[i:i+len(q)]) == string(q) {
			out = append(out, i)
		}
	}
	return out
}

// FilterSuggestionWords keeps at most 5 items, trims their fields and keeps
// only words that were in the list sent, so no invented word reaches a chip.
func FilterSuggestionWords(items []ai.SuggestionItem, sent []string) []ai.SuggestionItem {
	allowed := make(map[string]bool, len(sent))
	for _, w := range sent {
		allowed[w] = true
	}
	var out []ai.SuggestionItem
	for _, it := range items {
		if len(out) == 5 {
			break
		}
		n := ai.SuggestionItem{Title: strings.TrimSpace(it.Title), Prompt: strings.TrimSpace(it.Prompt), Words: []string{}}
		for _, w := range it.Words {
			if w = strings.TrimSpace(w); allowed[w] {
				n.Words = append(n.Words, w)
			}
		}
		out = append(out, n)
	}
	return out
}
