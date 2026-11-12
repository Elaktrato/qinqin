package lang

import "strings"

// maxDeinflectDepth bounds how many rules chain on one surface form.
const maxDeinflectDepth = 3

type jaRule struct{ from, to, reason string }

// jaRules is the deinflection table: a surface suffix rewritten to a
// shallower suffix. Rules chain, so ました -> ます -> む resolves to a
// dictionary form through an intermediate one. Candidates a rule
// produces wrongly (the table does not track verb class) are filtered
// by the dictionary lookup.
var jaRules = buildJaRules()

func buildJaRules() []jaRule {
	rules := []jaRule{
		// polite chains, shared by every verb class
		{"ました", "ます", "past"},
		{"ませんでした", "ます", "negative past"},
		{"ません", "ます", "negative"},
		{"ましょう", "ます", "volitional"},
		// ichidan
		{"なかった", "る", "negative past"},
		{"ない", "る", "negative"},
		{"ます", "る", "polite"},
		{"た", "る", "past"},
		{"たら", "る", "conditional"},
		{"て", "る", "te-form"},
		{"れば", "る", "conditional"},
		{"よう", "る", "volitional"},
		{"られる", "る", "passive"},
		{"させる", "る", "causative"},
		{"れる", "る", "potential"},
		// i-adjectives
		{"くなかった", "い", "negative past"},
		{"かった", "い", "past"},
		{"くない", "い", "negative"},
		{"くて", "い", "te-form"},
		{"ければ", "い", "conditional"},
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
			jaRule{g.a + "なかった", g.u, "negative past"},
			jaRule{g.a + "ない", g.u, "negative"},
			jaRule{g.i + "ます", g.u, "polite"},
			jaRule{g.past, g.u, "past"},
			jaRule{g.past + "ら", g.u, "conditional"},
			jaRule{g.te, g.u, "te-form"},
			jaRule{g.e + "ば", g.u, "conditional"},
			jaRule{g.o + "う", g.u, "volitional"},
			jaRule{g.e + "る", g.u, "potential"},
			jaRule{g.a + "れる", g.u, "passive"},
			jaRule{g.a + "せる", g.u, "causative"},
		)
	}
	return rules
}

// Deinflect returns the possible dictionary forms of a surface form,
// shallowest rule chain first, never the surface itself. Each candidate's
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
				if !strings.HasSuffix(n.form, r.from) || len(n.form) == len(r.from) {
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
