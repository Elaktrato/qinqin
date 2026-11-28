package conjugation

import "slices"

// family is a form family: the unit a learner switches on and the drill
// schedules (one item per word × family).
type family struct {
	id    string
	forms []string
	def   bool // on by default
}

// families in order. The beginner families are on by default; the later
// ones (N4 and N3 in textbook order) are off.
var families = []family{
	{id: "polite", forms: []string{Polite, PoliteNegative, PoliteVolitional}, def: true},
	{id: "polite-past", forms: []string{PolitePast, PolitePastNegative}, def: true},
	{id: "negative", forms: []string{Negative}, def: true},
	{id: "past", forms: []string{Past, PastNegative}, def: true},
	{id: "te-form", forms: []string{Te}, def: true},
	{id: "potential", forms: []string{Potential}},
	{id: "volitional", forms: []string{Volitional}},
	{id: "conditional", forms: []string{ConditionalBa, ConditionalTara}},
	{id: "passive", forms: []string{Passive}},
	{id: "causative", forms: []string{Causative}},
}

var (
	allForms       = []string{Polite, PoliteNegative, PoliteVolitional, PolitePast, PolitePastNegative, Negative, Past, PastNegative, Te, Potential, Volitional, ConditionalBa, ConditionalTara, Passive, Causative}
	notOnPurpose   = []string{Potential, Volitional, PoliteVolitional, Passive, Causative}
	notOnPurposeNC = []string{Potential, Volitional, PoliteVolitional, Passive}
)

// exclusion: forms a word does not have although its class does, by its
// written form (and its class or reading where the written form is
// ambiguous). Reviewed by two Japanese teacher agents (plan 2026-11-28-178).
type exclusion struct {
	written []string
	class   string
	reading string
	forms   []string
}

var exclusions = []exclusion{
	{written: []string{"分かる", "わかる", "判る", "解る"}, forms: notOnPurposeNC},
	{written: []string{"出来る", "できる"}, forms: notOnPurpose},
	{written: []string{"見える", "みえる", "聞こえる", "きこえる"}, forms: notOnPurpose},
	{written: []string{"要る"}, forms: notOnPurpose},
	{written: []string{"いる"}, class: "v5r", forms: allForms},
	{written: []string{"要する", "有する"}, forms: []string{Volitional, PoliteVolitional, Passive}},
	{written: []string{"知る", "しる"}, forms: []string{Potential}},
	{written: []string{"似る", "足りる", "起こる", "晴れる", "曇る", "違う", "始まる"}, forms: notOnPurpose},
	{written: []string{"壊れる", "割れる", "折れる", "消える", "閉まる", "決まる", "見つかる", "治る", "生まれる", "済む", "開く", "空く"}, forms: notOnPurpose},
	{written: []string{"似合う", "疲れる", "咲く"}, forms: notOnPurposeNC},
	{written: []string{"困る"}, forms: notOnPurposeNC},
	{written: []string{"降る"}, forms: []string{Potential, Volitional, PoliteVolitional}},
	{written: []string{"関する", "対する", "反する"}, forms: allForms},
	{written: []string{"存じる", "申す", "致す", "いたす", "参る", "まいる", "おる", "伺う", "申し上げる"}, forms: []string{Potential, Passive, Causative, Volitional}},
	{written: []string{"召し上がる"}, forms: []string{Potential, Volitional, Passive, Causative}},
	{written: []string{"ござる", "御座る"}, forms: []string{Negative, Past, PastNegative, Te, ConditionalBa, ConditionalTara}},
	{written: []string{"死ぬ", "殺す"}, forms: []string{Volitional, PoliteVolitional}},
	{written: []string{"ない", "無い"}, class: "adj-i", forms: []string{Negative, PastNegative, PoliteNegative, PolitePastNegative}},
	{written: []string{"来る"}, reading: "きたる", forms: allForms},
}

// FamilyIDs are the form families in order.
func FamilyIDs() []string {
	out := make([]string, len(families))
	for i, f := range families {
		out[i] = f.id
	}
	return out
}

// DefaultFamilies are the families on by default, in order.
func DefaultFamilies() []string {
	var out []string
	for _, f := range families {
		if f.def {
			out = append(out, f.id)
		}
	}
	return out
}

// FormsOf is a family's forms in question order; nil for an unknown family.
func FormsOf(id string) []string {
	for _, f := range families {
		if f.id == id {
			return slices.Clone(f.forms)
		}
	}
	return nil
}

// ExcludedForms are the forms a word of class, written and read so, is
// never asked (the exclusions that match it).
func ExcludedForms(class, written, reading string) []string {
	var out []string
	for _, x := range exclusions {
		if !slices.Contains(x.written, written) || x.class != "" && x.class != class || x.reading != "" && x.reading != reading {
			continue
		}
		for _, f := range x.forms {
			if !slices.Contains(out, f) {
				out = append(out, f)
			}
		}
	}
	return out
}

// familiesWith are the families with at least one form that has.
func familiesWith(has func(form string) bool) []string {
	var out []string
	for _, f := range families {
		if slices.ContainsFunc(f.forms, has) {
			out = append(out, f.id)
		}
	}
	return out
}
