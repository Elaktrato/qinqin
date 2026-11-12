package lookup

import (
	"cmp"
	"slices"
	"strings"
)

// candidate is one entry as the ranker sees it: the keys of the sort
// chain, precomputed from the entry's best match.
type candidate struct {
	// primary: the dictionary-side text that matched (the deinflected
	// form for an inflected match, the source text otherwise) equals the
	// entry's first reading (plain-normalized for kana) or first form.
	primary bool
	// matchedLen is the length of the matched source text in code points.
	matchedLen int
	// freqRank is the entry's rank in the ranking pack (see
	// rankingRanks); 0 when that pack has no data for the entry.
	freqRank int
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
//  1. primary reading match, true first;
//  2. matched source text length, longest first;
//  3. frequency order: lower rank first, entries with data in the
//     ranking pack before those without (with no frequency data at all
//     every rank is 0 and the key is a no-op);
//  4. inflection chain length, shortest first;
//  5. exact source-term matches, most first;
//  6. dictionary order, lowest dictionary id first;
//  7. entry score: usually kana with priority first, then priority;
//  8. headword text, ascending, then entry id: fully deterministic.
//
// Frequency deliberately outranks the inflection chain (Yomitan puts it
// after), so a frequent deinflected verb beats a rare exact homophone.
func compareCandidates(a, b candidate) int {
	if c := cmpTrueFirst(a.primary, b.primary); c != 0 {
		return c
	}
	if c := cmp.Compare(b.matchedLen, a.matchedLen); c != 0 {
		return c
	}
	if c := cmpRank(a.freqRank, b.freqRank); c != 0 {
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
