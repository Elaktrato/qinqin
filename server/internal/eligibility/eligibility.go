// Package eligibility answers, per dictionary entry, which companion cards
// (docs/contracts/cards/) a study session can make of it: a word salad
// (sentence), a writing card, a tone card, a reverse card and a cloze card.
// They are the rules a card applies when it is shown, decided before the
// session is planned, so a count never promises a card the session then
// drops (#288; docs/contracts/cards/eligibility.json).
package eligibility

import (
	"context"
	"database/sql"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"

	"qinqin/internal/lang"
	"qinqin/internal/lexicon"
	"qinqin/internal/model"
	"qinqin/internal/overlay"
	"qinqin/internal/segment"
	"qinqin/internal/sentences"
	"qinqin/internal/strokes"
)

// The kinds this package answers, in the card kind order
// (vocab, sentence, writing, tone, reverse, cloze).
const (
	Sentence = "sentence"
	Writing  = "writing"
	Tone     = "tone"
	Reverse  = "reverse"
	Cloze    = "cloze"
)

// ClozeCandidates is how many of an entry's non-blank sentences a cloze card
// ever considers (docs/contracts/cards/cloze.json).
const ClozeCandidates = 8

// Entry is what the rules read of an entry, as the viewer sees it: the
// written form and readings after the viewer's own patch, the dictionary
// forms, the number of glosses, the sentences the viewer may see (pack
// sentences, then the viewer's own) in server order, and which characters of
// the written form have stroke data.
type Entry struct {
	ID                      int64
	Language, Kind, Written string
	Forms                   []string
	Readings                []model.Reading
	Glosses                 int
	Sentences               []string
	Strokes                 map[string]bool
}

// SegmentFunc segments a text in a language (the server's segmenter, the
// one POST /api/segment uses). Nil: the language cannot be segmented.
type SegmentFunc func(ctx context.Context, language, text string) ([]segment.Match, error)

// Kinds returns the companion kinds e can make, in kind order. seg nil means
// the language cannot be segmented: no cloze, since the card segments its
// sentence when shown.
func Kinds(ctx context.Context, e Entry, seg SegmentFunc) ([]string, error) {
	kinds := []string{}
	var usable []string
	for _, s := range e.Sentences {
		if strings.TrimFunc(s, jsSpace) != "" {
			usable = append(usable, s)
		}
	}
	if len(usable) > 0 {
		kinds = append(kinds, Sentence)
	}
	// A character without glosses gets no writing card: a reading-only
	// prompt matches many homophones.
	if !(e.Kind == "character" && e.Glosses == 0) && writable(e.Written, e.Strokes) {
		kinds = append(kinds, Writing)
	}
	if lang.ProfileOf(e.Language).Tones && hasCleanPinyin(e.Readings) {
		kinds = append(kinds, Tone)
	}
	if e.Kind == "word" && e.Glosses > 0 {
		kinds = append(kinds, Reverse)
	}
	if seg != nil {
		word := sentences.Word{ID: e.ID, Language: e.Language, Written: e.Written, Forms: e.Forms}
		for i, text := range usable {
			if i == ClozeCandidates {
				break
			}
			matches, err := seg(ctx, e.Language, text)
			if err != nil {
				return nil, fmt.Errorf("eligibility of entry %d: %w", e.ID, err)
			}
			if sentences.ContainsWord(text, word, matches) {
				kinds = append(kinds, Cloze)
				break
			}
		}
	}
	return kinds, nil
}

// writable reports whether a Han character of written has stroke data.
func writable(written string, strokes map[string]bool) bool {
	for _, r := range written {
		if unicode.Is(unicode.Han, r) && strokes[string(r)] {
			return true
		}
	}
	return false
}

// hanChars are the distinct Han characters of written.
func hanChars(written string, into map[string]bool) {
	for _, r := range written {
		if unicode.Is(unicode.Han, r) {
			into[string(r)] = true
		}
	}
}

// jsSpace is white space as the web client trims and splits it (JavaScript's
// \s: the Unicode space separators, the ASCII controls \t to \r and U+FEFF;
// not U+0085, which Go's unicode.IsSpace would add).
func jsSpace(r rune) bool {
	return unicode.In(r, unicode.Z) || r >= '\t' && r <= '\r' || r == '\uFEFF'
}

// separators split pinyin into syllables: white space and apostrophes.
var separators = regexp.MustCompile("[\\p{Z}\\t\\n\\v\\f\\r\\x{FEFF}'’ʼ`]+")

// toneMarks are the combining tone marks (NFD) of tones 1 to 4.
var toneMarks = map[rune]bool{'̄': true, '́': true, '̌': true, '̀': true}

// hasCleanPinyin reports whether one pinyin reading parses as clean toned
// pinyin: syllables made of letters only once the tone marks are taken off
// (tone numbers and punctuation are not clean); a lone neutral "r" is erhua
// and joins the syllable before it (web: exercises/tones.ts cleanReadings).
func hasCleanPinyin(readings []model.Reading) bool {
	for _, r := range readings {
		if r.Type == "pinyin" && cleanPinyin(r.Value) {
			return true
		}
	}
	return false
}

func cleanPinyin(value string) bool {
	var syllables []string
	for _, token := range separators.Split(strings.ToLower(value), -1) {
		var plain strings.Builder
		marked := false
		for _, r := range norm.NFD.String(token) {
			if toneMarks[r] {
				marked = true
				continue
			}
			plain.WriteRune(r)
		}
		p := strings.ReplaceAll(norm.NFC.String(plain.String()), "v", "ü")
		if p == "" {
			continue
		}
		if len(syllables) > 0 && p == "r" && !marked {
			syllables[len(syllables)-1] += "r"
			continue
		}
		syllables = append(syllables, p)
	}
	if len(syllables) == 0 {
		return false
	}
	for _, s := range syllables {
		for _, r := range s {
			if !unicode.IsLetter(r) {
				return false
			}
		}
	}
	return true
}

// Segmenter returns the SegmentFunc of a language, nil when it cannot be
// segmented.
type Segmenter func(language string) SegmentFunc

// ForEntries answers the kinds of every entry in ids for viewerID: the
// viewer's patch of the written form and readings applies, the viewer's own
// sentences count, nobody else's. An id that names no live entry answers an
// empty list.
func ForEntries(ctx context.Context, sqlDB *sql.DB, segmenter Segmenter, viewerID int64, ids []int64) (map[int64][]string, error) {
	out := make(map[int64][]string, len(ids))
	for _, id := range ids {
		out[id] = []string{}
	}
	es, err := lexicon.Store{DB: sqlDB}.GetMany(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("eligibility: %w", err)
	}
	found := make([]int64, 0, len(es))
	for _, e := range es {
		found = append(found, e.ID)
	}
	texts, err := sentences.TextsForEntries(ctx, sqlDB, found, viewerID)
	if err != nil {
		return nil, fmt.Errorf("eligibility: %w", err)
	}
	bases := make([]model.EntryBase, len(es))
	chars := map[string]bool{}
	for i, e := range es {
		base := model.EntryBase{ID: e.ID, Language: e.Language, Kind: e.Kind, Written: e.Headword()}
		for _, r := range e.Readings {
			base.Readings = append(base.Readings, model.Reading{Type: r.Type, Value: r.Value, Plain: r.Plain, Ord: r.Ord})
		}
		if err := overlay.Apply(ctx, sqlDB, viewerID, &base); err != nil {
			return nil, fmt.Errorf("eligibility: %w", err)
		}
		bases[i] = base
		hanChars(base.Written, chars)
	}
	list := make([]string, 0, len(chars))
	for c := range chars {
		list = append(list, c)
	}
	slices.Sort(list)
	have, err := strokes.Has(ctx, sqlDB, list)
	if err != nil {
		return nil, fmt.Errorf("eligibility: %w", err)
	}
	for i, e := range es {
		base := bases[i]
		entry := Entry{ID: e.ID, Language: e.Language, Kind: e.Kind, Written: base.Written, Readings: base.Readings, Sentences: texts[e.ID], Strokes: have}
		for _, f := range e.Forms {
			entry.Forms = append(entry.Forms, f.Text)
		}
		for _, s := range e.Senses {
			entry.Glosses += len(s.Glosses)
		}
		kinds, err := Kinds(ctx, entry, segmenter(e.Language))
		if err != nil {
			return nil, err
		}
		out[e.ID] = kinds
	}
	return out, nil
}
