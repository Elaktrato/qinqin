package lookup

import (
	"context"
	"log"
	"maps"
	"slices"
	"strings"

	"qinqin/internal/freq"
	"qinqin/internal/lang"
	"qinqin/internal/lexicon"
)

// freqGroup is a set of terms an entry's frequency is looked up by, with
// the readings a reading-specific row must name to apply to them. A kana
// group is a fallback: it applies to a pack only when the entry's other
// groups have no hit in that pack.
type freqGroup struct {
	terms, readings []string
	kana            bool
}

// freqGroups lists the term groups of an entry:
//   - its forms, with every reading value of the entry in raw, hiragana,
//     katakana and plain form (packs compare readings exactly);
//   - for a word without forms, or one usually written in kana (UK),
//     each kana reading as a term of its own, with that reading's
//     variants — a pack lists する, not only 為る. Such a kana row is
//     shared by every UK homophone (する also reads 掏る), so it is a
//     fallback for packs with nothing for the entry's forms.
//
// A Japanese character entry (KANJIDIC) has none: word frequency rows
// would rank a kanji as if it were the word written with it. Chinese
// character entries (single hanzi from CC-CEDICT or Unihan, merged by
// written form) keep theirs: a Chinese frequency row for a single hanzi
// is the frequency of that one-character word.
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
				groups = append(groups, freqGroup{terms: []string{r.Value}, readings: variants(r), kana: true})
			}
		}
	}
	return groups
}

// variants is a reading's value in raw, hiragana, katakana and plain
// form, sorted and deduplicated.
func variants(r lexicon.Reading) []string {
	out := []string{r.Value, lang.ToHiragana(r.Value), toKatakana(r.Value), r.Plain}
	slices.Sort(out)
	return slices.Compact(out)
}

// frequencies returns each entry's frequencies — one per pack of
// language with data for it, the best rank among its term groups (kana
// groups only for packs with no hit for the others), in pack priority
// order — and those packs' ids in priority order. The
// rows of every entry's terms come from ONE freq.Store.Rows call and are
// matched per entry with freq.BestHits, Lookup's own semantics.
//
// Frequency data only ranks and decorates: when it cannot be read the
// lookup goes on without it, so the error is logged, not returned.
func (s Service) frequencies(ctx context.Context, language string, es []lexicon.Entry) ([][]Frequency, []int64) {
	packs, err := s.Freq.Packs(ctx)
	if err != nil {
		log.Printf("lookup: frequency packs unavailable, ranking without them: %v", err)
		return make([][]Frequency, len(es)), nil
	}
	var packIDs []int64
	for _, p := range packs {
		if strings.EqualFold(p.Language, language) {
			packIDs = append(packIDs, p.ID)
		}
	}
	out, err := s.packFrequencies(ctx, language, es, packIDs)
	if err != nil {
		log.Printf("lookup: frequency rows unavailable, ranking without them: %v", err)
		return make([][]Frequency, len(es)), nil
	}
	return out, packIDs
}

// EntryRanks returns the ranking pack of language — its first installed
// frequency pack by priority, fixed whatever the entries are — and each
// entry's rank there (0 = no data), with frequencies' semantics (term
// groups, kana fallback, no word rank for a Japanese character). pack is
// nil when the language has no pack. Unlike lookups, errors are returned.
func (s Service) EntryRanks(ctx context.Context, language string, es []lexicon.Entry) (*freq.PackInfo, []int, error) {
	ranks := make([]int, len(es))
	packs, err := s.Freq.Packs(ctx)
	if err != nil {
		return nil, nil, err
	}
	var pack *freq.PackInfo
	for i := range packs {
		if strings.EqualFold(packs[i].Language, language) {
			pack = &packs[i]
			break
		}
	}
	if pack == nil {
		return nil, ranks, nil
	}
	freqs, err := s.packFrequencies(ctx, language, es, []int64{pack.ID})
	if err != nil {
		return nil, nil, err
	}
	for i, fs := range freqs {
		if len(fs) > 0 {
			ranks[i] = fs[0].Rank
		}
	}
	return pack, ranks, nil
}

// packFrequencies is frequencies over the given packs (priority order).
func (s Service) packFrequencies(ctx context.Context, language string, es []lexicon.Entry, packIDs []int64) ([][]Frequency, error) {
	out := make([][]Frequency, len(es))
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
		return out, nil
	}
	rows, err := s.Freq.Rows(ctx, terms)
	if err != nil {
		return nil, err
	}

	for i := range es {
		best := map[int64]freq.Hit{}
		var fallback []freq.Hit
		for _, g := range groups[i] {
			hits := freq.BestHits(rows, g.terms, g.readings)
			if g.kana {
				fallback = append(fallback, hits...)
				continue
			}
			for _, h := range hits {
				if cur, ok := best[h.PackID]; !ok || h.Rank < cur.Rank {
					best[h.PackID] = h
				}
			}
		}
		// Trade-off: a UK entry whose kanji form has a poor rank and no
		// attributed kana row keeps that poor rank, not the kana row's.
		formHit := maps.Clone(best)
		for _, h := range fallback {
			if _, ok := formHit[h.PackID]; ok {
				continue
			}
			if cur, ok := best[h.PackID]; !ok || h.Rank < cur.Rank {
				best[h.PackID] = h
			}
		}
		for _, id := range packIDs {
			if h, ok := best[id]; ok {
				out[i] = append(out[i], Frequency{PackID: h.PackID, PackName: h.PackName, Rank: h.Rank, Display: h.Display})
			}
		}
	}
	return out, nil
}

// Hiragana ぁ..ゖ and katakana ァ..ヶ are 0x60 apart.
const (
	hiraganaLo, hiraganaHi = 0x3041, 0x3096
	kanaShift              = 0x60
)

func toKatakana(s string) string {
	return strings.Map(func(r rune) rune {
		if r >= hiraganaLo && r <= hiraganaHi {
			return r + kanaShift
		}
		return r
	}, s)
}
