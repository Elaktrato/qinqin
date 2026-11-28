package segment

import (
	"slices"
	"strings"
	"unicode"

	"qinqin/internal/lexicon"
	"qinqin/internal/lookup"
)

// readingOf is the reading a match of res shows under rules that choose
// readings (docs/contracts/segment/README.md, "The reading of a match";
// Chinese, #349): the Readings table's reading of the lemma when the
// entry has it; else the reading whose everyday senses (not minor: a
// surname, variant, "used in" or archaic line, the sense display rule)
// have the most glosses, a sense without a reading tag counting for every
// reading, ties to the earliest; nil when no reading of the readings'
// first type has an everyday gloss (the lookup's reading stands).
func (r *Rules) readingOf(res lookup.Result) *Reading {
	if rd := r.Readings[res.Lemma]; rd != "" {
		if out := pinyinOf(res, rd); out != nil {
			return out
		}
	}
	if len(res.Readings) == 0 {
		return nil
	}
	typ := res.Readings[0].Type
	best, bestN := -1, 0
	for k, rd := range res.Readings {
		if rd.Type != typ {
			continue
		}
		key := readingKey(rd.Value)
		n := 0
		for _, sn := range res.Senses {
			s := lexicon.Sense{POS: sn.POS, Tags: sn.Tags, Glosses: sn.Glosses}
			if lexicon.MinorSense(s) {
				continue
			}
			if tags := lexicon.SenseReadings(s); len(tags) == 0 || slices.ContainsFunc(tags, func(t string) bool { return readingKey(t) == key }) {
				n += len(sn.Glosses)
			}
		}
		if n > bestN {
			best, bestN = k, n
		}
	}
	if best < 0 {
		return nil
	}
	return &Reading{Type: typ, Value: res.Readings[best].Value}
}

// pinyinOf is res's reading equal to value (compared as reading tags
// are: case, white space and apostrophes ignored), nil when it has none.
func pinyinOf(res lookup.Result, value string) *Reading {
	key := readingKey(value)
	for _, rd := range res.Readings {
		if readingKey(rd.Value) == key {
			return &Reading{Type: rd.Type, Value: rd.Value}
		}
	}
	return nil
}

// readingKey is a reading in the form a sense's reading tag compares in:
// lower case, without white space and apostrophes.
func readingKey(r string) string {
	return strings.Map(func(c rune) rune {
		if unicode.IsSpace(c) || c == '\'' || c == '’' {
			return -1
		}
		return unicode.ToLower(c)
	}, r)
}
