package lookup

import (
	"cmp"
	"slices"
	"strings"
)

// candidate is one entry as the ranker sees it: the keys of the sort
// chain, precomputed from the entry's best match.
type candidate struct {
	// matchedLen is the length of the matched source text in code points.
	matchedLen int
	// yields: an exact match of an unwritten expression that is a
	// same-length inflection of a word with at least its priority (すれば
	// of する); set by markYields from the rule table's hints.
	yields bool
	// expressionSense: a sense of the entry is an expression (an
	// expression never makes another one yield: として and とする).
	expressionSense bool
	// weakKana: matched through a reading that is not the probe text as
	// written (アメ for あめ), or of an entry that has written forms and is
	// not usually kana (揣摩 read しま, 使用 read しよう).
	weakKana bool
	// freqRank is the entry's rank in the ranking pack (see
	// rankingRanks); 0 when that pack has no data for the entry.
	freqRank int
	// primary: the dictionary-side text that matched (the deinflected
	// form for an inflected match, the source text otherwise) equals the
	// entry's first reading (plain-normalized for kana) or first form,
	// or a CC-CEDICT traditional form.
	primary bool
	// chainLen is the length of the inflection chain; 0 for exact.
	chainLen int
	// exactCount is how many of the entry's forms and readings equal the
	// matched dictionary-side text.
	exactCount int
	// dictOrder is the lowest dictionary id among the entry's senses.
	dictOrder int64
	// ukPri and pri are the entry score: usually-kana words carrying a
	// priority first, then priority.
	ukPri    bool
	pri      int
	headword string
	entryID  int64
	// at is the candidate's index in the slice the caller built, which
	// sortCandidates leaves in place so callers can map back.
	at int
}

// compareCandidates is the sort chain, best first. Each key falls
// through to the next on a tie:
//
//  1. matched source text length, longest first;
//  2. expression yields: an unwritten expression that is the inflection
//     of a same-length candidate of at least its priority goes after
//     every inflected candidate (issue #165; before frequency, so the
//     result does not depend on a frequency pack being installed);
//  3. frequency order: lower rank first, entries with data in the
//     ranking pack before those without (with no frequency data at all
//     every rank is 0 and the key is a no-op);
//  4. primary reading match, true first. It only breaks ties: a word
//     found by an alternative form or reading (子ども for 子供) still
//     beats a shorter headword match (子), and a frequent word that has
//     the matched reading second (行く: いく, ゆく) beats a rarer one
//     reading it first (征く) — merged JMdict entries lack Yomitan's
//     per-reading headwords, so frequency must be able to decide;
//  5. kana fit: a strong match (a form, a usually-kana word, a word
//     without written forms) before a weak one (a kanji word matched only
//     by its kana reading; issue #165);
//  6. inflection chain length, shortest first;
//  7. exact source-term matches, most first;
//  8. dictionary order, lowest dictionary id first;
//  9. entry score: usually kana with priority first, then priority;
//  10. headword text, ascending, then entry id: fully deterministic.
//
// Frequency deliberately outranks the inflection chain (Yomitan puts it
// after), so a frequent deinflected verb beats a rare exact homophone.
func compareCandidates(a, b candidate) int {
	if c := cmp.Compare(b.matchedLen, a.matchedLen); c != 0 {
		return c
	}
	if c := cmpTrueFirst(b.yields, a.yields); c != 0 {
		return c
	}
	if c := cmpRank(a.freqRank, b.freqRank); c != 0 {
		return c
	}
	if c := cmpTrueFirst(a.primary, b.primary); c != 0 {
		return c
	}
	if c := cmpTrueFirst(b.weakKana, a.weakKana); c != 0 {
		return c
	}
	if c := cmp.Compare(a.chainLen, b.chainLen); c != 0 {
		return c
	}
	if c := cmp.Compare(b.exactCount, a.exactCount); c != 0 {
		return c
	}
	if c := cmp.Compare(a.dictOrder, b.dictOrder); c != 0 {
		return c
	}
	if c := cmpTrueFirst(a.ukPri, b.ukPri); c != 0 {
		return c
	}
	if c := cmp.Compare(b.pri, a.pri); c != 0 {
		return c
	}
	if c := strings.Compare(a.headword, b.headword); c != 0 {
		return c
	}
	return cmp.Compare(a.entryID, b.entryID)
}

// markYields sets yields on every exact candidate of an expression: an
// entry without written forms whose every sense has a part-of-speech tag
// in expressionPos, when a same-length inflected candidate's entry has a
// priority above 0 and at least the expression's, and that is no
// expression itself (とする does not make として yield). expression[i] says
// whether cs[i] is such an entry.
func markYields(cs []candidate, expression []bool) {
	for i := range cs {
		c := &cs[i]
		if !expression[i] || c.chainLen != 0 {
			continue
		}
		c.yields = slices.ContainsFunc(cs, func(d candidate) bool {
			return d.matchedLen == c.matchedLen && d.chainLen > 0 && !d.expressionSense && d.pri > 0 && d.pri >= c.pri
		})
	}
}

// sortCandidates orders cs best first by compareCandidates.
func sortCandidates(cs []candidate) {
	slices.SortFunc(cs, compareCandidates)
}

func cmpTrueFirst(a, b bool) int {
	switch {
	case a == b:
		return 0
	case a:
		return -1
	}
	return 1
}

// cmpRank orders frequency ranks ascending, 0 (no data) last.
func cmpRank(a, b int) int {
	switch {
	case a == b:
		return 0
	case a == 0:
		return 1
	case b == 0:
		return -1
	}
	return cmp.Compare(a, b)
}

// rankingRanks returns each entry's frequency key: its rank in the
// ranking pack, the first pack in packs (priority order) with data for
// ANY of the entries; 0 for an entry without data there. When no pack
// has data for any entry every key is 0. freqs[i] are entry i's
// frequencies, at most one per pack.
func rankingRanks(packs []int64, freqs [][]Frequency) []int {
	out := make([]int, len(freqs))
	for _, p := range packs {
		found := false
		for i, fs := range freqs {
			for _, f := range fs {
				if f.PackID == p {
					out[i], found = f.Rank, true
				}
			}
		}
		if found {
			return out
		}
	}
	return out
}
