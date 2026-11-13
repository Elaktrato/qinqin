package sources

import (
	"slices"
	"strings"
	"unicode/utf8"
)

// Match ranks of a catalog work for a search query, best first. Search
// results are ranked before they are truncated to the limit, so the best
// hits are never cut off by catalog (id) order.
const (
	RankExactTitle  = iota // the title is the query
	RankTitlePrefix        // the title starts with the query
	RankAuthor             // the author contains the query
	RankSubstring          // the query occurs elsewhere in title+author
)

// MatchRank returns the rank of a work whose normalized title and author
// are given for the normalized query q, or -1 when it does not match.
func MatchRank(q, title, author string) int {
	switch {
	case title == q:
		return RankExactTitle
	case strings.HasPrefix(title, q):
		return RankTitlePrefix
	case strings.Contains(author, q):
		return RankAuthor
	case strings.Contains(title+author, q):
		return RankSubstring
	}
	return -1
}

// RankPhonetic is added to the MatchRank of a phonetic match, so every
// match on the written title or author ranks before every phonetic one.
const RankPhonetic = RankSubstring + 1

// MinPhoneticQuery is the shortest phonetic query key, in letters after
// the adapter's folding (lang.PhoneticKey collapses "tou" to "to"), that
// is matched phonetically: shorter keys such as "a" or "ko" occur in
// most readings of a catalog and would only bury the useful hits.
const MinPhoneticQuery = 3

// CombinedRank ranks a work first by its normalized written title and
// author for the normalized query nq, then — when that does not match —
// by its phonetic keys ptitle and pauthor for the phonetic query pq
// (offset by RankPhonetic, phonetic true). A pq shorter than
// MinPhoneticQuery letters, or a work without phonetic keys, never
// matches phonetically; written matches have no minimum length. It
// returns -1 when neither matches.
func CombinedRank(nq, title, author, pq, ptitle, pauthor string) (rank int, phonetic bool) {
	if r := MatchRank(nq, title, author); r >= 0 {
		return r, false
	}
	if utf8.RuneCountInString(pq) < MinPhoneticQuery || (ptitle == "" && pauthor == "") {
		return -1, false
	}
	if r := MatchRank(pq, ptitle, pauthor); r >= 0 {
		return RankPhonetic + r, true
	}
	return -1, false
}

// TopMatches returns at most limit of items that match (rank >= 0), best
// rank first, ties by id: shorter ids first, then lexically — numeric
// order for the digit ids the sources use.
func TopMatches[T any](items []T, limit int, rank func(T) int, id func(T) string) []T {
	type ranked struct {
		item T
		rank int
		id   string
	}
	var hits []ranked
	for _, it := range items {
		if r := rank(it); r >= 0 {
			hits = append(hits, ranked{it, r, id(it)})
		}
	}
	slices.SortFunc(hits, func(a, b ranked) int {
		if a.rank != b.rank {
			return a.rank - b.rank
		}
		if len(a.id) != len(b.id) {
			return len(a.id) - len(b.id)
		}
		return strings.Compare(a.id, b.id)
	})
	out := make([]T, 0, min(limit, len(hits)))
	for _, h := range hits[:min(limit, len(hits))] {
		out = append(out, h.item)
	}
	return out
}
