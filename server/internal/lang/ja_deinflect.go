package lang

import (
	"strings"

	"qinqin/internal/lemma"
)

// Deinflect returns the possible dictionary forms of a surface form by
// the Japanese rule table (server/internal/lemma/tables/ja.json,
// docs/contracts/lemma/): shallowest rule chain first (rule-table order
// within a depth), never the surface itself. A form reachable as two
// classes (いれば: 居る v1, 要る v5) yields one candidate per class. Each
// candidate's Reasons are the applied inflections in application order
// (the rule rewriting the surface first); Reason joins them innermost
// first, e.g. "polite past" for 飲みました.
func (j Ja) Deinflect(surface string) []Deinflection {
	return deinflect(j.Rules(), surface)
}

// Rules is the Japanese rule table.
func (Ja) Rules() *lemma.Table { return lemma.For("ja") }

// deinflect runs t on surface and renders its candidates.
func deinflect(t *lemma.Table, surface string) []Deinflection {
	cs := t.Deinflect(surface)
	out := make([]Deinflection, len(cs))
	for i, c := range cs {
		out[i] = Deinflection{Form: c.Form, Reason: ReasonOf(c.Reasons), Reasons: c.Reasons, Class: c.Class}
	}
	return out
}

// ReasonOf renders an inflection chain in application order (see
// Deinflection.Reasons) as Deinflection.Reason: innermost first,
// space-joined, e.g. "passive past" for [past passive].
func ReasonOf(reasons []string) string {
	rev := make([]string, len(reasons))
	for i, r := range reasons {
		rev[len(reasons)-1-i] = r
	}
	return strings.Join(rev, " ")
}
