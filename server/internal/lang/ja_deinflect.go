package lang

import "strings"

// maxDeinflectDepth bounds how many rules chain on one surface form.
const maxDeinflectDepth = 3

type jaRule struct {
	from, to, reason string
	whole            bool // matches only the entire surface, not a suffix
}

// jaRules is the deinflection table: a surface suffix rewritten to a
// shallower suffix. Rules chain, so ました -> ます -> む resolves to a
// dictionary form through an intermediate one. Candidates a rule
// produces wrongly (the table does not track verb class) are filtered
// by the dictionary lookup: candidates are not part-of-speech filtered,
// the dictionary is the only filter.
var jaRules = buildJaRules()

func buildJaRules() []jaRule {
	r := func(from, to, reason string) jaRule { return jaRule{from, to, reason, false} }
	w := func(from, to, reason string) jaRule { return jaRule{from, to, reason, true} }
	rules := []jaRule{
		// irregular verbs first (来る needs no row: た/て/ない/ます -> る cover it), so they rank ahead of regular guesses
		r("行った", "行く", "past"),
		r("行って", "行く", "te-form"),
		r("した", "する", "past"),
		r("して", "する", "te-form"),
		r("しない", "する", "negative"),
		r("しなかった", "する", "negative past"),
		r("します", "する", "polite"),
		r("しよう", "する", "volitional"),
		r("すれば", "する", "conditional"),
		r("される", "する", "passive"),
		r("させる", "する", "causative"),
		r("し", "する", "stem"),
		w("きた", "くる", "past"),
		w("きて", "くる", "te-form"),
		w("こない", "くる", "negative"),
		w("きます", "くる", "polite"),
		// polite chains, shared by every verb class
		r("ました", "ます", "past"),
		r("ませんでした", "ます", "negative past"),
		r("ません", "ます", "negative"),
		r("ましょう", "ます", "volitional"),
		// ichidan
		r("なかった", "る", "negative past"),
		r("ない", "る", "negative"),
		r("ます", "る", "polite"),
		r("た", "る", "past"),
		r("たら", "る", "conditional"),
		r("て", "る", "te-form"),
		r("れば", "る", "conditional"),
		r("よう", "る", "volitional"),
		r("られる", "る", "passive"),
		r("させる", "る", "causative"),
		r("れる", "る", "potential"),
		// i-adjectives
		r("くなかった", "い", "negative past"),
		r("かった", "い", "past"),
		r("くない", "い", "negative"),
		r("くて", "い", "te-form"),
		r("ければ", "い", "conditional"),
	}
	// godan: dictionary ending, i/a/e/o stems, past (た) and te (て) tails.
	godan := []struct{ u, i, a, e, o, past, te string }{
		{"う", "い", "わ", "え", "お", "った", "って"},
		{"く", "き", "か", "け", "こ", "いた", "いて"},
		{"ぐ", "ぎ", "が", "げ", "ご", "いだ", "いで"},
		{"す", "し", "さ", "せ", "そ", "した", "して"},
		{"つ", "ち", "た", "て", "と", "った", "って"},
		{"ぬ", "に", "な", "ね", "の", "んだ", "んで"},
		{"ぶ", "び", "ば", "べ", "ぼ", "んだ", "んで"},
		{"む", "み", "ま", "め", "も", "んだ", "んで"},
		{"る", "り", "ら", "れ", "ろ", "った", "って"},
	}
	for _, g := range godan {
		rules = append(rules,
			r(g.a+"なかった", g.u, "negative past"),
			r(g.a+"ない", g.u, "negative"),
			r(g.i+"ます", g.u, "polite"),
			r(g.past, g.u, "past"),
			r(g.past+"ら", g.u, "conditional"),
			r(g.te, g.u, "te-form"),
			r(g.e+"ば", g.u, "conditional"),
			r(g.o+"う", g.u, "volitional"),
			r(g.e+"る", g.u, "potential"),
			r(g.a+"れる", g.u, "passive"),
			r(g.a+"せる", g.u, "causative"),
		)
	}
	return rules
}

// jaBare lists irregular suffixes that may be the entire surface (した);
// every other suffix rule needs a non-empty stem.
var jaBare = map[string]bool{
	"行った": true, "行って": true, "した": true, "して": true, "しない": true,
	"しなかった": true, "します": true, "しよう": true, "すれば": true,
	"される": true, "させる": true, "し": true,
}

// Deinflect returns the possible dictionary forms of a surface form,
// shallowest rule chain first (rule-table order within a depth), never the surface itself. Each candidate's
// Reason lists the applied inflections innermost first, e.g.
// "polite past" for 飲みました.
func (Ja) Deinflect(surface string) []Deinflection {
	type node struct {
		form    string
		reasons []string // in application order
	}
	seen := map[string]bool{surface: true}
	var out []Deinflection
	level := []node{{form: surface}}
	for depth := 0; depth < maxDeinflectDepth && len(level) > 0; depth++ {
		var next []node
		for _, n := range level {
			for _, r := range jaRules {
				if r.whole {
					if n.form != r.from {
						continue
					}
				} else if !strings.HasSuffix(n.form, r.from) || (len(n.form) == len(r.from) && !jaBare[r.from]) {
					continue
				}
				form := strings.TrimSuffix(n.form, r.from) + r.to
				if seen[form] {
					continue
				}
				seen[form] = true
				reasons := append(append([]string(nil), n.reasons...), r.reason)
				next = append(next, node{form, reasons})
				out = append(out, Deinflection{Form: form, Reason: joinReversed(reasons)})
			}
		}
		level = next
	}
	return out
}

func joinReversed(reasons []string) string {
	rev := make([]string, len(reasons))
	for i, r := range reasons {
		rev[len(reasons)-1-i] = r
	}
	return strings.Join(rev, " ")
}
