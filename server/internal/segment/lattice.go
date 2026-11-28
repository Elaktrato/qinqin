package segment

import (
	"context"
	"slices"
	"unicode"

	"qinqin/internal/lemma"
	"qinqin/internal/lookup"
)

// edge is one way to read the text from a position: a match and its cost.
type edge struct {
	m    *Match
	cost int
}

// lattice reads the whole text at once (docs/contracts/segment/README.md):
// every position is looked up once, in text order; each distinct matched
// surface there is an edge (its best-ranked result is the head, or a
// function word's own entry), the boundary rule of the lemma contract
// removes the longest edge where it would split it, and the cheapest path
// from the start to the end wins. A rune no edge covers costs
// Costs.Unmatched; ties go to the longer edge at the earliest position, so
// wherever scoring prefers nothing else the result is greedy's.
func (s Service) lattice(ctx context.Context, l lookup.Lang, runes []rune, r *Rules) ([]Match, error) {
	n := len(runes)
	hints := hintsOf(l)
	type looked struct {
		m       *Match
		results []lookup.Result
	}
	memo := make([]looked, n)
	for i := range n {
		m, results, err := s.lookupAt(ctx, l, runes, i)
		if err != nil {
			return nil, err
		}
		memo[i] = looked{m, results}
	}
	at := func(offset int) (*Match, []lookup.Result, error) {
		if offset < 0 || offset >= n {
			return nil, nil, nil
		}
		return memo[offset].m, memo[offset].results, nil
	}

	edges := make([][]edge, n)
	for i := range n {
		longest, results := memo[i].m, memo[i].results
		if longest == nil {
			continue
		}
		split, err := s.splitParticle(at, i, longest, results, hints)
		if err != nil {
			return nil, err
		}
		// Surfaces in ranking order: the lookup ranks by matched length
		// first, so the longest comes first.
		var surfaces []string
		for _, res := range results {
			if !slices.Contains(surfaces, res.Matched) {
				surfaces = append(surfaces, res.Matched)
			}
		}
		for k, surface := range surfaces {
			if k == 0 && split != nil {
				continue // the boundary rule splits the longest match
			}
			if e, ok := s.edgeOf(results, surface, i, r); ok {
				if i > 0 && kanji(runes[i-1]) && kanji(runes[i]) {
					e.cost += r.Costs.KanjiSplit
				}
				edges[i] = append(edges[i], e)
			}
		}
	}

	// best[i] is the cheapest reading of runes[i:]; next[i] its first edge
	// (nil: runes[i] stays unmatched).
	best := make([]int, n+1)
	next := make([]*edge, n)
	for i := n - 1; i >= 0; i-- {
		best[i] = -1
		for k := range edges[i] {
			e := &edges[i][k]
			if c := e.cost + best[e.m.End]; best[i] < 0 || c < best[i] {
				best[i], next[i] = c, e
			}
		}
		if c := r.Costs.Unmatched + best[i+1]; best[i] < 0 || c < best[i] {
			best[i], next[i] = c, nil
		}
	}
	matches := []Match{}
	for i := 0; i < n; {
		if next[i] == nil {
			i++
			continue
		}
		matches = append(matches, *next[i].m)
		i = next[i].m.End
	}
	return matches, nil
}

// edgeOf is the edge of the results that matched surface at offset, or
// false when none is a word or the surface is one of SplitWords. A result is no word when it is an exact
// reading match whose text is not the reading as written and is one rune
// long or mixes hiragana and katakana (はア read as はあ, ナ as な). A
// function word's head is its function entry and it costs Token; any
// other match costs Token plus WeakReading for a weak kana fit and
// NoPriorityKana when it is all kana and its entry has no priority.
func (s Service) edgeOf(results []lookup.Result, surface string, offset int, r *Rules) (edge, bool) {
	var own []lookup.Result
	oneRune := len([]rune(surface)) == 1
	for _, res := range results {
		if res.Matched == surface && !(res.ViaReading && len(res.Reasons) == 0 && res.Reading != surface && (oneRune || mixedKana(surface))) {
			own = append(own, res)
		}
	}
	if len(own) == 0 || slices.Contains(r.SplitWords, surface) {
		return edge{}, false
	}
	head := own[0]
	if f := slices.IndexFunc(own, func(res lookup.Result) bool { return r.isFunction(res) }); f >= 0 {
		head = own[f]
		own = append([]lookup.Result{head}, slices.Delete(slices.Clone(own), f, f+1)...)
		m := s.matchOf(own, surface, offset)
		m.Function = true
		return edge{m: m, cost: r.Costs.Token}, true
	}
	cost := r.Costs.Token
	if head.WeakReading {
		cost += r.Costs.WeakReading
	}
	if head.Pri == 0 && lemma.InScript("kana", surface) {
		cost += r.Costs.NoPriorityKana
	}
	return edge{m: s.matchOf(own, surface, offset), cost: cost}, true
}

// isFunction reports whether res is a function word: its lemma is in the
// closed list and a sense has a function part of speech.
func (r *Rules) isFunction(res lookup.Result) bool {
	return slices.Contains(r.FunctionWords, res.Lemma) && anySense(res, r.FunctionPOS)
}

// kanji reports whether c is a Han character (or 々, 〆).
func kanji(c rune) bool {
	return unicode.Is(unicode.Han, c) || c == '々' || c == '〆'
}

// mixedKana reports whether s holds both hiragana and katakana (ー is
// neither).
func mixedKana(s string) bool {
	var hira, kata bool
	for _, c := range s {
		switch {
		case unicode.Is(unicode.Hiragana, c):
			hira = true
		case unicode.Is(unicode.Katakana, c):
			kata = true
		}
	}
	return hira && kata
}
