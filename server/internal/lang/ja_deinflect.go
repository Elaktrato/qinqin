package lang

import (
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"
)

// maxDeinflectDepth bounds how many rules chain on one surface form.
// Four reach the longest progressive chains: していました -> しています
// (past) -> している (polite) -> して (progressive) -> する (te-form).
const maxDeinflectDepth = 4

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
	// stemOK, when set, must accept the text the rule leaves before its
	// suffix (見 for 見ろ), else the rule does not apply.
	stemOK func(stem string) bool
}

// longKanaStem is the stem guard of the ichidan ろ imperative and たい
// desiderative rules: a kana-only stem of one code point is refused.
// いろ, いたい, みたい are far more often 色, 痛い and the suffix みたい
// than forms of 居る or 見る, and frequency (which outranks the
// inflection chain) would pick the verb; written with kanji (見ろ,
// 見たい) they still apply.
func longKanaStem(stem string) bool {
	return utf8.RuneCountInString(stem) > 1 || !kanaOnly(stem)
}

// yoStem guards the literary ichidan よ imperative (見よ, 考えよ, 起きよ):
// the stem must contain a non-kana character — a kana-only stem is a
// word plus the sentence particle よ (これよ, それよ, だれよ), never
// 凝る/逸れる/弛れる — and must not end in a te-form (見てよ, してよ:
// 見て plus よ). 捨てよ is lost with the te-form guard.
func yoStem(stem string) bool {
	return stem != "" && !kanaOnly(stem) && !strings.HasSuffix(stem, "て") && !strings.HasSuffix(stem, "で")
}

// kanaOnly reports whether s is non-empty and all hiragana or katakana.
func kanaOnly(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r != 'ー' && !unicode.In(r, unicode.Hiragana, unicode.Katakana) {
			return false
		}
	}
	return true
}

// jaRules is the deinflection table. Rules chain, so ました -> ます -> む
// resolves to a dictionary form through an intermediate one, but only
// when the intermediate form's class is one the next rule takes: a ます
// form (classMasu) feeds the polite rules, an ichidan form (食べさせる)
// the passive/causative/potential rules, an adj-i form (食べない,
// 食べたい) the negative and desiderative rules, a te-form an auxiliary
// rule left (して, class te) the te-form rules. Candidates a rule produces wrongly (話した -> 話する,
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
	{"て", "te-form", []string{classTe}},
	{"れば", "conditional", nil},
	{"よう", "volitional", nil},
	// passive, causative and potential forms are themselves ichidan verbs
	{"られる", "passive", []string{ClassV1}},
	{"させる", "causative", []string{ClassV1}},
	{"れる", "potential", []string{ClassV1}},
}

func buildJaRules() []jaRule {
	adj, masu, v1, te := []string{ClassAdjI}, []string{classMasu}, []string{ClassV1}, []string{classTe}
	r := func(from, to, reason, out string, in []string) jaRule {
		return jaRule{from: from, to: to, reason: reason, in: in, out: out}
	}
	b := func(from, to, reason, out string, in []string) jaRule {
		return jaRule{from: from, to: to, reason: reason, in: in, out: out, bare: true}
	}
	w := func(from, to, reason, out string, in []string) jaRule {
		return jaRule{from: from, to: to, reason: reason, in: in, out: out, whole: true}
	}
	guard := func(rule jaRule, stemOK func(string) bool) jaRule {
		rule.stemOK = stemOK
		return rule
	}
	// irregular verbs first, so they rank ahead of regular guesses
	rules := []jaRule{
		b("行った", "行く", "past", ClassV5, nil),
		b("行って", "行く", "te-form", ClassV5, te),
		b("した", "する", "past", ClassVs, nil),
		b("して", "する", "te-form", ClassVs, te),
		b("しない", "する", "negative", ClassVs, adj),
		b("しなかった", "する", "negative past", ClassVs, nil),
		b("します", "する", "polite", ClassVs, masu),
		b("しよう", "する", "volitional", ClassVs, nil),
		b("すれば", "する", "conditional", ClassVs, nil),
		b("される", "する", "passive", ClassVs, v1),
		b("させる", "する", "causative", ClassVs, v1),
		b("し", "する", "stem", ClassVs, nil),
		w("きた", "くる", "past", ClassVk, nil),
		w("きて", "くる", "te-form", ClassVk, te),
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
			r(g.te, g.u, "te-form", ClassV5, te),
			r(g.e+"ば", g.u, "conditional", ClassV5, nil),
			r(g.o+"う", g.u, "volitional", ClassV5, nil),
			r(g.e+"る", g.u, "potential", ClassV5, v1),
			r(g.a+"れる", g.u, "passive", ClassV5, v1),
			r(g.a+"せる", g.u, "causative", ClassV5, v1),
		)
	}
	// Progressive, desiderative, imperative and kana 行く rules come last,
	// so they only add candidates after each surface's earlier ones.
	rules = append(rules,
		// Progressive: the auxiliary いる after a te-form. いる is itself
		// ichidan, so its inflections reach ている through the ichidan
		// rules first (していた -> している, past), then the te-form is
		// left with class te (-> して, progressive) for the te-form rules
		// (-> する, te-form): Reasons [past progressive te-form].
		r("ている", "て", "progressive", classTe, v1),
		r("でいる", "で", "progressive", classTe, v1),
		r("てる", "て", "progressive", classTe, v1), // contracted: してる, してた, してない
		r("でる", "で", "progressive", classTe, v1),
		// 行く read いく: irregular past and te-form, like 行った/行って.
		b("いった", "いく", "past", ClassV5, nil),
		b("いって", "いく", "te-form", ClassV5, te),
		// Desiderative: たい on the masu stem inflects as an i-adjective
		// (食べたかった -> 食べたい, past -> 食べる, desire).
		b("したい", "する", "desire", ClassVs, adj),
		w("きたい", "くる", "desire", ClassVk, adj),
		b("来たい", "来る", "desire", ClassVk, adj),
		guard(r("たい", "る", "desire", ClassV1, adj), longKanaStem),
		// Imperative.
		b("しろ", "する", "imperative", ClassVs, nil),
		b("せよ", "する", "imperative", ClassVs, nil),
		w("こい", "くる", "imperative", ClassVk, nil),
		b("来い", "来る", "imperative", ClassVk, nil),
		guard(r("ろ", "る", "imperative", ClassV1, nil), longKanaStem),
		guard(r("よ", "る", "imperative", ClassV1, nil), yoStem),
	)
	// Godan imperatives (行け, 待て, 書け, 話せ) are deliberately NOT
	// deinflected: an e-row ending is far more often a noun in running
	// text (届け, 構え, 揺れ, 期限切れ, 子供向け, 二階建て), and at equal
	// matched length frequency, which outranks the inflection chain,
	// would pick the verb.
	for _, g := range godan {
		rules = append(rules,
			// the godan stem includes the i-row kana (いき for いきたい), so no guard
			r(g.i+"たい", g.u, "desire", ClassV5, adj),
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
				if r.stemOK != nil && !r.stemOK(strings.TrimSuffix(n.form, r.from)) {
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
