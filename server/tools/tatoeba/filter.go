package main

import (
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"
)

// The filter steps, in order; each counts the sentences it dropped.
const (
	stepOrphan      = "orphan (no owner)"
	stepNativeOnly  = "owner not native (nativeOnly)"
	stepTag         = "unreliable tag"
	stepDenyTag     = "deny tag"
	stepReview      = "negative review"
	stepLength      = "length out of bounds"
	stepDenyWord    = "deny word"
	stepTranslation = "no usable English translation"
	stepDuplicate   = "near duplicate"
	stepCoverage    = "dictionary coverage below minimum"
	stepNoWord      = "no word that links"
)

// candidate is a sentence that passed the text filters, with its chosen
// translation and what the ranking needs.
type candidate struct {
	s      *sentence
	tr     *sentence
	native bool
	runes  int

	// Set by the reading and linking step.
	reading string
	words   []string
}

// counter keeps the per-step drop counts in step order.
type counter struct {
	order []string
	n     map[string]int
}

func newCounter() *counter { return &counter{n: map[string]int{}} }

func (c *counter) add(step string, k int) {
	if _, ok := c.n[step]; !ok {
		c.order = append(c.order, step)
	}
	c.n[step] += k
}

// filterLanguage applies the text filters of rules to the sentences of one
// pack language, in step order, and returns the survivors in ranking
// order, the number read and the drop counts.
func filterLanguage(ex *export, rules Rules, lr LangRules) ([]*candidate, int, *counter) {
	drops := newCounter()
	for _, step := range []string{stepOrphan, stepNativeOnly, stepTag, stepDenyTag, stepReview, stepLength, stepDenyWord, stepTranslation, stepDuplicate} {
		drops.add(step, 0)
	}
	dropTags := lowerSet(rules.DropTags)
	denyTags := lowerSet(rules.DenyTags)
	tagged := func(id int64, set map[string]bool) bool {
		for _, t := range ex.tags[id] {
			if set[t] {
				return true
			}
		}
		return false
	}

	var ids []int64
	for id, s := range ex.sentences {
		if s.Lang == lr.Tatoeba {
			ids = append(ids, id)
		}
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })

	var kept []*candidate
	for _, id := range ids {
		s := ex.sentences[id]
		native := s.Owner != "" && ex.skill(s.Lang, s.Owner) == rules.NativeSkill
		n := utf8.RuneCountInString(s.Text)
		switch {
		case rules.DropOrphans && s.Owner == "":
			drops.add(stepOrphan, 1)
		case rules.NativeOnly && !native:
			drops.add(stepNativeOnly, 1)
		case tagged(id, dropTags):
			drops.add(stepTag, 1)
		case tagged(id, denyTags):
			drops.add(stepDenyTag, 1)
		case rules.DropNegativeReviews && ex.negative[id]:
			drops.add(stepReview, 1)
		case n < lr.MinRunes || n > lr.MaxRunes:
			drops.add(stepLength, 1)
		case containsAny(s.Text, lr.DenyWords):
			drops.add(stepDenyWord, 1)
		default:
			tr := bestTranslation(ex, rules, id, dropTags, denyTags)
			if tr == nil {
				drops.add(stepTranslation, 1)
				continue
			}
			kept = append(kept, &candidate{s: s, tr: tr, native: native, runes: n})
		}
	}

	// Near-duplicates: the best-ranked sentence of each key survives.
	sortCandidates(kept)
	seen := map[string]bool{}
	out := kept[:0]
	for _, c := range kept {
		k := dupKey(c.s.Text)
		if seen[k] {
			drops.add(stepDuplicate, 1)
			continue
		}
		seen[k] = true
		out = append(out, c)
	}
	return out, len(ids), drops
}

// bestTranslation picks the sentence's English translation: linked
// directly, passing the orphan, tag, review and length rules; a native
// owner first, then the lowest id.
func bestTranslation(ex *export, rules Rules, id int64, dropTags, denyTags map[string]bool) *sentence {
	var best *sentence
	bestNative := false
	for _, tid := range ex.links[id] {
		t := ex.sentences[tid]
		if t == nil || t.Lang != rules.TranslationLanguage {
			continue
		}
		if rules.DropOrphans && t.Owner == "" {
			continue
		}
		bad := false
		for _, tag := range ex.tags[tid] {
			bad = bad || dropTags[tag] || denyTags[tag]
		}
		if bad || (rules.DropNegativeReviews && ex.negative[tid]) || utf8.RuneCountInString(t.Text) > rules.MaxTranslationRunes || strings.TrimSpace(t.Text) == "" {
			continue
		}
		native := t.Owner != "" && ex.skill(t.Lang, t.Owner) == rules.NativeSkill
		if best == nil || (native && !bestNative) {
			best, bestNative = t, native // links are ascending: the first of a rank has the lowest id
		}
	}
	return best
}

// sortCandidates orders by rank: a native owner first, then a sentence
// with a reading, then shorter, then the lower id.
func sortCandidates(cs []*candidate) {
	sort.SliceStable(cs, func(i, j int) bool { return better(cs[i], cs[j]) })
}

func better(a, b *candidate) bool {
	if a.native != b.native {
		return a.native
	}
	if (a.reading != "") != (b.reading != "") {
		return a.reading != ""
	}
	if a.runes != b.runes {
		return a.runes < b.runes
	}
	return a.s.ID < b.s.ID
}

// dupKey is the near-duplicate key: NFKC, case-folded, letters, marks and
// digits only (punctuation, symbols and spaces removed).
func dupKey(text string) string {
	var b strings.Builder
	for _, r := range norm.NFKC.String(text) {
		if unicode.IsLetter(r) || unicode.IsNumber(r) || unicode.IsMark(r) {
			b.WriteRune(unicode.ToLower(r))
		}
	}
	return b.String()
}

func lowerSet(list []string) map[string]bool {
	m := map[string]bool{}
	for _, s := range list {
		m[strings.ToLower(strings.TrimSpace(s))] = true
	}
	return m
}

func containsAny(text string, words []string) bool {
	for _, w := range words {
		if w != "" && strings.Contains(text, w) {
			return true
		}
	}
	return false
}
