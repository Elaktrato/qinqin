package lang

import (
	"slices"
	"strings"
)

// maxDeinflectDepth bounds how many rules chain on one surface form.
const maxDeinflectDepth = 3

// jaRule rewrites a surface suffix to a shallower one. The form it
// produces has word class out; in lists the classes the form it rewrites
// may have when that form is itself the product of an earlier rule.
// Rules with an empty in (past, te-form, conditional, …) rewrite only the
// surface: their inflected forms are not words of any class.
type jaRule struct {
	from, to, reason string
	in               []string
	out              string
	whole            bool // matches only the entire surface, not a suffix
	bare             bool // may match the entire surface (した -> する)
}

// jaRules is the deinflection table. Rules chain, so ました -> ます -> む
// resolves to a dictionary form through an intermediate one, but only
// when the intermediate form's class is one the next rule takes: a ます
// form (classMasu) feeds the polite rules, an ichidan form (食べさせる)
// the passive/causative/potential rules, an adj-i form (食べない) the
// negative rules. Candidates a rule produces wrongly (話した -> 話する,
// class vs) are left to the caller, which checks Class against the
// dictionary form's POS with ClassMatches.
var jaRules = buildJaRules()

// jaIchidan lists the ichidan endings (dictionary ending る); 来る
// conjugates the same on its written stem 来.
var jaIchidan = []struct {
	from, reason string
	in           []string
}{
	{"なかった", "negative past", nil},
	{"ない", "negative", []string{ClassAdjI}}, // ない inflects as an i-adjective
	{"ます", "polite", []string{classMasu}},
	{"た", "past", nil},
	{"たら", "conditional", nil},
	{"て", "te-form", nil},
	{"れば", "conditional", nil},
	{"よう", "volitional", nil},
	// passive, causative and potential forms are themselves ichidan verbs
	{"られる", "passive", []string{ClassV1}},
	{"させる", "causative", []string{ClassV1}},
	{"れる", "potential", []string{ClassV1}},
}

func buildJaRules() []jaRule {
	adj, masu, v1 := []string{ClassAdjI}, []string{classMasu}, []string{ClassV1}
	r := func(from, to, reason, out string, in []string) jaRule {
		return jaRule{from: from, to: to, reason: reason, in: in, out: out}
	}
	b := func(from, to, reason, out string, in []string) jaRule {
		return jaRule{from: from, to: to, reason: reason, in: in, out: out, bare: true}
	}
	w := func(from, to, reason, out string, in []string) jaRule {
		return jaRule{from: from, to: to, reason: reason, in: in, out: out, whole: true}
	}
	// irregular verbs first, so they rank ahead of regular guesses
	rules := []jaRule{
		b("行った", "行く", "past", ClassV5, nil),
		b("行って", "行く", "te-form", ClassV5, nil),
		b("した", "する", "past", ClassVs, nil),
		b("して", "する", "te-form", ClassVs, nil),
		b("しない", "する", "negative", ClassVs, adj),
		b("しなかった", "する", "negative past", ClassVs, nil),
		b("します", "する", "polite", ClassVs, masu),
		b("しよう", "する", "volitional", ClassVs, nil),
		b("すれば", "する", "conditional", ClassVs, nil),
		b("される", "する", "passive", ClassVs, v1),
		b("させる", "する", "causative", ClassVs, v1),
		b("し", "する", "stem", ClassVs, nil),
		w("きた", "くる", "past", ClassVk, nil),
		w("きて", "くる", "te-form", ClassVk, nil),
		w("こない", "くる", "negative", ClassVk, adj),
		w("きます", "くる", "polite", ClassVk, masu),
	}
	for _, e := range jaIchidan {
		rules = append(rules, b("来"+e.from, "来る", e.reason, ClassVk, e.in))
	}
	// polite chains, shared by every verb class
	rules = append(rules,
		r("ました", "ます", "past", classMasu, nil),
		r("ませんでした", "ます", "negative past", classMasu, nil),
		r("ません", "ます", "negative", classMasu, nil),
		r("ましょう", "ます", "volitional", classMasu, nil),
	)
	for _, e := range jaIchidan {
		rules = append(rules, r(e.from, "る", e.reason, ClassV1, e.in))
	}
	rules = append(rules,
		r("くなかった", "い", "negative past", ClassAdjI, nil),
		r("かった", "い", "past", ClassAdjI, nil),
		r("くない", "い", "negative", ClassAdjI, adj),
		r("くて", "い", "te-form", ClassAdjI, nil),
		r("ければ", "い", "conditional", ClassAdjI, nil),
	)
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
			r(g.a+"なかった", g.u, "negative past", ClassV5, nil),
			r(g.a+"ない", g.u, "negative", ClassV5, adj),
			r(g.i+"ます", g.u, "polite", ClassV5, masu),
			r(g.past, g.u, "past", ClassV5, nil),
			r(g.past+"ら", g.u, "conditional", ClassV5, nil),
			r(g.te, g.u, "te-form", ClassV5, nil),
			r(g.e+"ば", g.u, "conditional", ClassV5, nil),
			r(g.o+"う", g.u, "volitional", ClassV5, nil),
			r(g.e+"る", g.u, "potential", ClassV5, v1),
			r(g.a+"れる", g.u, "passive", ClassV5, v1),
			r(g.a+"せる", g.u, "causative", ClassV5, v1),
		)
	}
	return rules
}

// Deinflect returns the possible dictionary forms of a surface form,
// shallowest rule chain first (rule-table order within a depth), never
// the surface itself. A form reachable as two classes (いれば: 居る v1,
// 要る v5) yields one candidate per class. Each candidate's Reasons are
// the applied inflections in application order (the rule rewriting the
// surface first); Reason joins them innermost first, e.g. "polite past"
// for 飲みました.
func (Ja) Deinflect(surface string) []Deinflection {
	type key struct{ form, class string }
	type node struct {
		key
		reasons []string
	}
	seen := map[key]bool{}
	var out []Deinflection
	level := []node{{key: key{form: surface}}}
	for depth := 0; depth < maxDeinflectDepth && len(level) > 0; depth++ {
		var next []node
		for _, n := range level {
			for _, r := range jaRules {
				if depth > 0 && !slices.Contains(r.in, n.class) {
					continue
				}
				if r.whole {
					if n.form != r.from {
						continue
					}
				} else if !strings.HasSuffix(n.form, r.from) || (len(n.form) == len(r.from) && !r.bare) {
					continue
				}
				k := key{strings.TrimSuffix(n.form, r.from) + r.to, r.out}
				if k.form == surface || seen[k] {
					continue
				}
				seen[k] = true
				reasons := append(append([]string(nil), n.reasons...), r.reason)
				next = append(next, node{k, reasons})
				out = append(out, Deinflection{Form: k.form, Reason: ReasonOf(reasons), Reasons: reasons, Class: k.class})
			}
		}
		level = next
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
