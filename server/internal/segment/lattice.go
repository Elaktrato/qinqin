package segment

import (
	"context"
	"fmt"
	"slices"
	"unicode"

	"qinqin/internal/lemma"
	"qinqin/internal/levels"
	"qinqin/internal/lookup"
)

// edge is one way to read the text from a position: a match and its cost.
// listed: its head is a direct member of a word level list of the
// language (only with rules that read the lists), or it is one of the
// rules' PartFunctionWords.
type edge struct {
	m      *Match
	cost   int
	listed bool
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

	// The word levels of every entry the lattice can read, in one batched
	// read (rules that use the level lists only).
	var lv map[int64]int
	if r.usesLevels() && s.Lookup.DB != nil {
		var ids []int64
		seen := map[int64]bool{}
		for _, lk := range memo {
			for _, res := range lk.results {
				if !seen[res.EntryID] {
					seen[res.EntryID] = true
					ids = append(ids, res.EntryID)
				}
			}
		}
		var err error
		if lv, err = levels.WordLevels(ctx, s.Lookup.DB, l.Code, ids); err != nil {
			return nil, fmt.Errorf("segment: %w", err)
		}
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
			if e, ok := s.edgeOf(results, surface, i, r, lv); ok {
				if i > 0 && kanji(runes[i-1]) && kanji(runes[i]) {
					e.cost += r.Costs.KanjiSplit
				}
				edges[i] = append(edges[i], e)
			}
		}
	}

	if r.Compounds == CompoundsParts {
		for i := range n {
			edges[i] = slices.DeleteFunc(edges[i], func(e edge) bool { return readByParts(edges, e) })
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
// other match's head is its listed result of the lowest level (with level
// lists, lv), else its best-ranked one, and it costs Token plus
// WeakReading for a weak kana fit, NoPriorityKana when it is all kana and
// its entry has no priority, and its level cost (levelCost).
func (s Service) edgeOf(results []lookup.Result, surface string, offset int, r *Rules, lv map[int64]int) (edge, bool) {
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
		if s.WithReadings {
			if rd := r.FunctionReadings[head.Lemma]; rd != "" {
				m.Reading = pinyinOf(head, rd)
			}
		}
		return edge{m: m, cost: r.Costs.Token, listed: slices.Contains(r.PartFunctionWords, head.Lemma)}, true
	}
	if lv != nil {
		best := -1
		for k, res := range own {
			if lvl, ok := lv[res.EntryID]; ok && (best < 0 || lvl < lv[own[best].EntryID]) {
				best = k
			}
		}
		if best > 0 {
			head = own[best]
			own = append([]lookup.Result{head}, slices.Delete(slices.Clone(own), best, best+1)...)
		}
	}
	cost := r.Costs.Token
	if head.WeakReading {
		cost += r.Costs.WeakReading
	}
	if head.Pri == 0 && lemma.InScript("kana", surface) {
		cost += r.Costs.NoPriorityKana
	}
	lvl, listed := lv[head.EntryID]
	if r.usesLevels() {
		if listed {
			cost += min(r.Costs.LevelStep*lvl, r.Costs.Unlisted)
		} else {
			cost += r.Costs.Unlisted
		}
	}
	m := s.matchOf(own, surface, offset)
	if s.WithReadings && (len(r.Readings) > 0 || len(r.FunctionReadings) > 0) {
		if rd := r.readingOf(head); rd != nil {
			m.Reading = rd
		}
	}
	return edge{m: m, cost: cost, listed: listed}, true
}

// readByParts reports whether e is a compound the Compounds rule drops: two
// or more runes, its head in no word level list, and its whole text read
// by listed edges (PartFunctionWords among them) that lie inside it; any
// other function word counts as its last part only (在地 is 在 | 地, the
// particle follows its word; 地上 stays the noun).
func readByParts(edges [][]edge, e edge) bool {
	start, end := e.m.Start, e.m.End
	if e.listed || end-start < 2 {
		return false
	}
	reach := make([]bool, end-start+1)
	reach[0] = true
	for p := start; p < end; p++ {
		if !reach[p-start] {
			continue
		}
		for _, x := range edges[p] {
			if (x.listed || x.m.Function && x.m.End == end) && x.m.End <= end && x.m.End-x.m.Start < end-start {
				reach[x.m.End-start] = true
			}
		}
	}
	return reach[end-start]
}

// isFunction reports whether res is a function word: its lemma is in the
// closed list and a sense has a function part of speech.
func (r *Rules) isFunction(res lookup.Result) bool {
	if !slices.Contains(r.FunctionWords, res.Lemma) {
		return false
	}
	if rd := r.FunctionReadings[res.Lemma]; rd != "" && pinyinOf(res, rd) != nil {
		return true
	}
	return anySense(res, r.FunctionPOS)
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
