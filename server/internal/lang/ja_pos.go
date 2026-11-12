package lang

import (
	"slices"
	"strings"
)

// Word classes a deinflected Japanese form must have, matched against
// JMdict part-of-speech tags by ClassMatches.
const (
	ClassV1   = "v1"    // ichidan verb: v1, v1-s
	ClassV5   = "v5"    // godan verb: any v5* (v5r, v5k-s, v5aru, v5r-i, …)
	ClassVs   = "vs"    // する verb: vs, vs-i, vs-s, vs-c
	ClassVk   = "vk"    // 来る: vk
	ClassAdjI = "adj-i" // i-adjective: adj-i, adj-ix
)

// classMasu is the class of a polite ます form (飲みます): the product of
// a polite-chain rule and the input of a ます rule, never a dictionary
// form, so no POS tag matches it.
const classMasu = "masu"

// classTags lists the JMdict POS tags of each class; ClassV5 matches by
// prefix instead.
var classTags = map[string][]string{
	ClassV1:   {"v1", "v1-s"},
	ClassVs:   {"vs", "vs-i", "vs-s", "vs-c"},
	ClassVk:   {"vk"},
	ClassAdjI: {"adj-i", "adj-ix"},
}

// ClassMatches reports whether any of the JMdict POS tags pos (one
// sense's, e.g. v1, v5r, vs-i) belongs to class. Unknown classes match
// nothing.
func ClassMatches(class string, pos []string) bool {
	for _, p := range pos {
		if class == ClassV5 && strings.HasPrefix(p, "v5") || slices.Contains(classTags[class], p) {
			return true
		}
	}
	return false
}
