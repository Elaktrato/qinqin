package lookup

import (
	"context"
	"log"
	"slices"
	"strings"

	"qinqin/internal/freq"
	"qinqin/internal/lexicon"
)

// freqGroup is a set of terms an entry's frequency is looked up by, with
// the readings a reading-specific row must name to apply to them.
type freqGroup struct {
	terms, readings []string
}

// freqGroups lists the term groups of an entry:
//   - its forms, with every reading value of the entry in raw, hiragana,
//     katakana and plain form (packs compare readings exactly);
//   - for a word without forms, or one usually written in kana (UK),
//     each kana reading as a term of its own, with that reading's
//     variants — a pack lists する, not only 為る.
//
// A Japanese character entry (KANJIDIC) has none: word frequency rows
// would rank a kanji as if it were the word written with it. Chinese
// character entries are CC-CEDICT words and keep theirs.
func freqGroups(language string, e lexicon.Entry) []freqGroup {
	if language == "ja" && e.Kind == kindCharacter {
		return nil
	}
	var groups []freqGroup
	if len(e.Forms) > 0 {
		g := freqGroup{}
		for _, f := range e.Forms {
			g.terms = append(g.terms, f.Text)
		}
		for _, r := range e.Readings {
			g.readings = append(g.readings, variants(r)...)
		}
		slices.Sort(g.readings)
		groups = append(groups, freqGroup{terms: g.terms, readings: slices.Compact(g.readings)})
	}
	if len(e.Forms) == 0 || e.UK {
		for _, r := range e.Readings {
			if r.Type == "kana" {
				groups = append(groups, freqGroup{terms: []string{r.Value}, readings: variants(r)})
			}
		}
	}
	return groups
}

// variants is a reading's value in raw, hiragana, katakana and plain
// form, sorted and deduplicated.
func variants(r lexicon.Reading) []string {
	out := []string{r.Value, toHiragana(r.Value), toKatakana(r.Value), r.Plain}
	slices.Sort(out)
	return slices.Compact(out)
}

// frequencies returns each entry's frequencies — one per pack of
// language with data for it, the best rank among its term groups, in
// pack priority order — and those packs' ids in priority order. The
// rows of every entry's terms come from ONE freq.Store.Rows call and are
// matched per entry with freq.BestHits, Lookup's own semantics.
//
// Frequency data only ranks and decorates: when it cannot be read the
// lookup goes on without it, so the error is logged, not returned.
func (s Service) frequencies(ctx context.Context, language string, es []lexicon.Entry) ([][]Frequency, []int64) {
	out := make([][]Frequency, len(es))
	packs, err := s.Freq.Packs(ctx)
	if err != nil {
		log.Printf("lookup: frequency packs unavailable, ranking without them: %v", err)
		return out, nil
	}
	var packIDs []int64
	for _, p := range packs {
		if strings.EqualFold(p.Language, language) {
			packIDs = append(packIDs, p.ID)
		}
	}
	if len(packIDs) == 0 {
		return out, nil
	}

	groups := make([][]freqGroup, len(es))
	var terms []string
	for i, e := range es {
		groups[i] = freqGroups(language, e)
		for _, g := range groups[i] {
			terms = append(terms, g.terms...)
		}
	}
	if len(terms) == 0 {
		return out, packIDs
	}
	rows, err := s.Freq.Rows(ctx, terms)
	if err != nil {
		log.Printf("lookup: frequency rows unavailable, ranking without them: %v", err)
		return out, nil
	}

	for i := range es {
		best := map[int64]freq.Hit{}
		for _, g := range groups[i] {
			for _, h := range freq.BestHits(rows, g.terms, g.readings) {
				if cur, ok := best[h.PackID]; !ok || h.Rank < cur.Rank {
					best[h.PackID] = h
				}
			}
		}
		for _, id := range packIDs {
			if h, ok := best[id]; ok {
				out[i] = append(out[i], Frequency{PackID: h.PackID, PackName: h.PackName, Rank: h.Rank, Display: h.Display})
			}
		}
	}
	return out, packIDs
}

// Hiragana ぁ..ゖ and katakana ァ..ヶ are 0x60 apart.
const (
	hiraganaLo, hiraganaHi = 0x3041, 0x3096
	katakanaLo, katakanaHi = 0x30A1, 0x30F6
	kanaShift              = katakanaLo - hiraganaLo
)

func toHiragana(s string) string {
	return strings.Map(func(r rune) rune {
		if r >= katakanaLo && r <= katakanaHi {
			return r - kanaShift
		}
		return r
	}, s)
}

func toKatakana(s string) string {
	return strings.Map(func(r rune) rune {
		if r >= hiraganaLo && r <= hiraganaHi {
			return r + kanaShift
		}
		return r
	}, s)
}
