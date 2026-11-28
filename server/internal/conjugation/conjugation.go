// Package conjugation is the Japanese conjugation engine of the conjugation
// trainer (#178, docs/contracts/conjugation/): the class of a dictionary
// entry from its JMdict parts of speech, and the forms of a verb or an
// adjective, each with its canonical answer first and the accepted
// alternatives after it. The forms are the reader lemmatizer's in reverse:
// the contract's fixture is checked against its rule table (#165).
package conjugation

import (
	"slices"
	"strings"
	"unicode/utf8"
)

// Form ids, verb forms in question order.
const (
	Polite             = "polite"
	PoliteNegative     = "polite-negative"
	PolitePast         = "polite-past"
	PolitePastNegative = "polite-past-negative"
	Negative           = "negative"
	Past               = "past"
	PastNegative       = "past-negative"
	Te                 = "te"
	Potential          = "potential"
	Volitional         = "volitional"
	PoliteVolitional   = "polite-volitional"
	ConditionalBa      = "conditional-ba"
	ConditionalTara    = "conditional-tara"
	Passive            = "passive"
	Causative          = "causative"
)

// Answer is one accepted answer of a form: its written form (with the
// word's kanji) and its kana reading.
type Answer struct {
	Written string `json:"written"`
	Reading string `json:"reading"`
}

// Word is what the engine makes of one entry: its class, the families it is
// drilled in (family order) and the forms of those families, each with its
// canonical answer first.
type Word struct {
	Class    string              `json:"class"`
	Families []string            `json:"families"`
	Forms    map[string][]Answer `json:"forms"`
}

// rule is one class's conjugation: the kana ending of the dictionary form,
// the suffixes that replace it per form (canonical first), and the first
// kana of a suffix after which a written form keeps the kanji that stands
// for the ending's first kana (来る → 来ない, 良い → 良くない); any other
// suffix is written in kana (有る → ない).
type rule struct {
	ending string
	forms  map[string][]string
	sounds string
}

// godanRow is the vowel row of a godan ending and its て and た forms.
type godanRow struct{ a, i, e, o, te, ta string }

var godanRows = map[string]godanRow{
	"う": {"わ", "い", "え", "お", "って", "った"},
	"く": {"か", "き", "け", "こ", "いて", "いた"},
	"ぐ": {"が", "ぎ", "げ", "ご", "いで", "いだ"},
	"す": {"さ", "し", "せ", "そ", "して", "した"},
	"つ": {"た", "ち", "て", "と", "って", "った"},
	"ぬ": {"な", "に", "ね", "の", "んで", "んだ"},
	"ぶ": {"ば", "び", "べ", "ぼ", "んで", "んだ"},
	"む": {"ま", "み", "め", "も", "んで", "んだ"},
	"る": {"ら", "り", "れ", "ろ", "って", "った"},
}

func one(s ...string) []string { return s }

// godan builds a godan class's rule from its row.
func godan(ending string, r godanRow) rule {
	return rule{ending: ending, forms: map[string][]string{
		Polite:             one(r.i + "ます"),
		PoliteNegative:     one(r.i + "ません"),
		PolitePast:         one(r.i + "ました"),
		PolitePastNegative: one(r.i + "ませんでした"),
		Negative:           one(r.a + "ない"),
		Past:               one(r.ta),
		PastNegative:       one(r.a + "なかった"),
		Te:                 one(r.te),
		Potential:          one(r.e + "る"),
		Volitional:         one(r.o + "う"),
		PoliteVolitional:   one(r.i + "ましょう"),
		ConditionalBa:      one(r.e + "ば"),
		ConditionalTara:    one(r.ta + "ら"),
		Passive:            one(r.a + "れる"),
		Causative:          one(r.a + "せる"),
	}}
}

var ichidan = map[string][]string{
	Polite:             one("ます"),
	PoliteNegative:     one("ません"),
	PolitePast:         one("ました"),
	PolitePastNegative: one("ませんでした"),
	Negative:           one("ない"),
	Past:               one("た"),
	PastNegative:       one("なかった"),
	Te:                 one("て"),
	Potential:          one("られる", "れる"),
	Volitional:         one("よう"),
	PoliteVolitional:   one("ましょう"),
	ConditionalBa:      one("れば"),
	ConditionalTara:    one("たら"),
	Passive:            one("られる"),
	Causative:          one("させる"),
}

// adjectiveI is an い-adjective's forms after its stem (高, かっこよ).
func adjectiveI(stem string) map[string][]string {
	return map[string][]string{
		PoliteNegative:     one(stem+"くないです", stem+"くありません"),
		PolitePast:         one(stem + "かったです"),
		PolitePastNegative: one(stem+"くなかったです", stem+"くありませんでした"),
		Negative:           one(stem + "くない"),
		Past:               one(stem + "かった"),
		PastNegative:       one(stem + "くなかった"),
		Te:                 one(stem + "くて"),
		ConditionalBa:      one(stem + "ければ"),
		ConditionalTara:    one(stem + "かったら"),
	}
}

var rules = func() map[string]rule {
	r := map[string]rule{}
	for class, ending := range map[string]string{
		"v5u": "う", "v5k": "く", "v5g": "ぐ", "v5s": "す", "v5t": "つ", "v5n": "ぬ", "v5b": "ぶ", "v5m": "む", "v5r": "る",
	} {
		r[class] = godan(ending, godanRows[ending])
	}
	ku := godanRows["く"]
	ku.te, ku.ta = "って", "った"
	r["v5k-s"] = godan("く", ku)
	u := godanRows["う"]
	u.te, u.ta = "うて", "うた"
	r["v5u-s"] = godan("う", u)
	aru := godanRows["る"]
	aru.i = "い"
	r["v5aru"] = godan("る", aru)

	r["v1"] = rule{ending: "る", forms: ichidan}
	r["v1-s"] = rule{ending: "る", forms: ichidan}
	// いる (居る) has no ら-less potential: いれる is 入れる.
	iru := clone(ichidan)
	iru[Potential] = one("られる")
	r[ichidanIru] = rule{ending: "る", forms: iru}

	ari := godan("ある", godanRow{"あら", "あり", "あれ", "あろ", "あって", "あった"})
	ari.forms[Negative] = one("ない")
	ari.forms[PastNegative] = one("なかった")
	ari.forms[PoliteNegative] = one("ありません", "ないです")
	ari.forms[PolitePastNegative] = one("ありませんでした", "なかったです")
	ari.sounds = "あ"
	r["v5r-i"] = ari

	r["vk"] = rule{ending: "くる", sounds: "こきく", forms: map[string][]string{
		Polite:             one("きます"),
		PoliteNegative:     one("きません"),
		PolitePast:         one("きました"),
		PolitePastNegative: one("きませんでした"),
		Negative:           one("こない"),
		Past:               one("きた"),
		PastNegative:       one("こなかった"),
		Te:                 one("きて"),
		Potential:          one("こられる", "これる"),
		Volitional:         one("こよう"),
		PoliteVolitional:   one("きましょう"),
		ConditionalBa:      one("くれば"),
		ConditionalTara:    one("きたら"),
		Passive:            one("こられる"),
		Causative:          one("こさせる"),
	}}
	suru := map[string][]string{
		Polite:             one("します"),
		PoliteNegative:     one("しません"),
		PolitePast:         one("しました"),
		PolitePastNegative: one("しませんでした"),
		Negative:           one("しない"),
		Past:               one("した"),
		PastNegative:       one("しなかった"),
		Te:                 one("して"),
		Potential:          one("できる"),
		Volitional:         one("しよう"),
		PoliteVolitional:   one("しましょう"),
		ConditionalBa:      one("すれば"),
		ConditionalTara:    one("したら"),
		Passive:            one("される"),
		Causative:          one("させる"),
	}
	r["vs-i"] = rule{ending: "する", forms: suru}
	special := clone(suru)
	special[Negative] = one("さない", "しない")
	special[PastNegative] = one("さなかった", "しなかった")
	special[Potential] = one("せる")
	special[Volitional] = one("そう")
	special[ConditionalBa] = one("すれば", "せば")
	r["vs-s"] = rule{ending: "する", forms: special}
	// A する verb on a stem in っ (察する, 達する, 罰する) keeps the する forms;
	// its potential, volitional and causative are rare and not drilled.
	sokuon := clone(suru)
	sokuon[Passive] = one("せられる", "される")
	for _, id := range []string{Potential, Volitional, PoliteVolitional, Causative} {
		delete(sokuon, id)
	}
	r[vsSokuon] = rule{ending: "する", forms: sokuon}

	adjI := adjectiveI("")
	adjI[Polite] = one("いです")
	r["adj-i"] = rule{ending: "い", forms: adjI}
	adjIx := adjectiveI("よ")
	adjIx[Polite] = one("いいです", "よいです")
	r["adj-ix"] = rule{ending: "いい", sounds: "いよ", forms: adjIx}
	r["adj-na"] = rule{ending: "", forms: map[string][]string{
		Polite:             one("です"),
		PoliteNegative:     one("じゃありません", "じゃないです", "ではありません", "ではないです"),
		PolitePast:         one("でした"),
		PolitePastNegative: one("じゃありませんでした", "じゃなかったです", "ではありませんでした", "ではなかったです"),
		Negative:           one("じゃない", "ではない"),
		Past:               one("だった"),
		PastNegative:       one("じゃなかった", "ではなかった"),
		Te:                 one("で"),
		ConditionalBa:      one("なら", "ならば", "であれば"),
		ConditionalTara:    one("だったら"),
	}}
	// くれる, ある and the honorific verbs have the forms of an adjective's
	// families only.
	for _, class := range []string{"v1-s", "v5r-i", "v5aru"} {
		forms := clone(r[class].forms)
		for _, id := range []string{Potential, Volitional, PoliteVolitional, Passive, Causative} {
			delete(forms, id)
		}
		x := r[class]
		x.forms = forms
		r[class] = x
	}
	return r
}()

// Variants of a class picked by the reading (never classes of their own).
const (
	vsSokuon   = "vs-s/sokuon"
	ichidanIru = "v1/iru"
)

func clone(m map[string][]string) map[string][]string {
	out := make(map[string][]string, len(m))
	for k, v := range m {
		out[k] = slices.Clone(v)
	}
	return out
}

// extras are accepted answers of single words, by kana reading: whole
// forms, written in kana.
var extras = map[string]map[string][]string{
	"いらっしゃる": {Te: {"いらして"}, Past: {"いらした"}},
}

// Classes are the engine's classes (JMdict part-of-speech tags).
func Classes() []string {
	var out []string
	for c := range rules {
		if !strings.Contains(c, "/") {
			out = append(out, c)
		}
	}
	slices.Sort(out)
	return out
}

// Classify is the class of an entry whose senses carry these
// part-of-speech lists: the first tag, sense by sense in order, that is an
// engine class; "" when there is none (the entry is not drilled).
func Classify(senses [][]string) string {
	for _, pos := range senses {
		for _, tag := range pos {
			if _, ok := rules[tag]; ok && !strings.Contains(tag, "/") {
				return tag
			}
		}
	}
	return ""
}

// ClassFamilies are the families an ordinary word of class has, in order
// (a variant picked by the reading, or an exclusion, may have fewer).
func ClassFamilies(class string) []string {
	if strings.Contains(class, "/") {
		return nil
	}
	r, ok := rules[class]
	if !ok {
		return nil
	}
	return familiesWith(func(id string) bool { return len(r.forms[id]) > 0 })
}

// Conjugate is the word an entry of class makes, written and read so: its
// families and their forms, canonical answer first. Other spellings of the
// entry add their written answers after the headword's. False when the
// class is not the engine's, the forms do not end in its ending (the
// reading must be hiragana), or every form is excluded.
func Conjugate(class, written, reading string, spellings ...string) (Word, bool) {
	if strings.Contains(class, "/") {
		return Word{}, false
	}
	forms, ok := conjugate(class, written, reading)
	if !ok {
		return Word{}, false
	}
	for _, x := range ExcludedForms(class, written, reading) {
		delete(forms, x)
	}
	for _, sp := range spellings {
		more, ok := conjugate(class, sp, reading)
		if !ok {
			continue
		}
		for id, answers := range forms {
			for _, a := range more[id] {
				if !slices.Contains(answers, a) {
					answers = append(answers, a)
				}
			}
			forms[id] = answers
		}
	}
	families := familiesWith(func(id string) bool { return len(forms[id]) > 0 })
	if len(families) == 0 {
		return Word{}, false
	}
	return Word{Class: class, Families: families, Forms: forms}, true
}

// conjugate is every form of the class for one spelling.
func conjugate(class, written, reading string) (map[string][]Answer, bool) {
	r, ok := rules[class]
	if !ok || !hiragana(reading) || !strings.HasSuffix(reading, r.ending) || reading == r.ending && utf8.RuneCountInString(r.ending) == 1 {
		return nil, false
	}
	rstem := strings.TrimSuffix(reading, r.ending)
	switch {
	case class == "vs-s" && strings.HasSuffix(rstem, "っ"):
		r = rules[vsSokuon]
	case class == "v1" && reading == "いる":
		r = rules[ichidanIru]
	}
	writtenOf, ok := r.writer(written, rstem)
	if !ok {
		return nil, false
	}
	// 行く read ゆく: its て and た forms are read いって, いった.
	yuku := class == "v5k-s" && strings.HasSuffix(rstem, "ゆ")
	forms := map[string][]Answer{}
	for id, suffixes := range r.forms {
		for _, s := range suffixes {
			a := Answer{Written: writtenOf(s), Reading: rstem + s}
			if yuku && strings.HasPrefix(s, "っ") {
				iu := strings.TrimSuffix(rstem, "ゆ") + "い"
				a.Reading = iu + s
				if w, ok := strings.CutSuffix(strings.TrimSuffix(written, "く"), "ゆ"); ok {
					a.Written = w + "い" + s
				}
			}
			forms[id] = append(forms[id], a)
		}
	}
	if class == "vs-i" {
		forms[Potential] = append(forms[Potential], Answer{Written: writtenOf("出来る"), Reading: rstem + "できる"})
	}
	for id, list := range extras[reading] {
		for _, k := range list {
			forms[id] = append(forms[id], Answer{Written: k, Reading: k})
		}
	}
	return forms, true
}

// writer returns how a suffix is written after the written form's stem.
func (r rule) writer(written, rstem string) (func(string) string, bool) {
	if strings.HasSuffix(written, r.ending) && written != "" && (written != r.ending || utf8.RuneCountInString(r.ending) > 1) {
		wstem := strings.TrimSuffix(written, r.ending)
		return func(s string) string { return wstem + s }, true
	}
	_, size := utf8.DecodeRuneInString(r.ending)
	if r.sounds == "" || size == len(r.ending) {
		return nil, false
	}
	head := strings.TrimSuffix(written, r.ending[size:])
	kanji, ksize := utf8.DecodeLastRuneInString(head)
	if head == written || ksize == 0 || isKana(kanji) {
		return nil, false
	}
	return func(s string) string {
		lead, n := utf8.DecodeRuneInString(s)
		if strings.ContainsRune(r.sounds, lead) {
			return head + s[n:]
		}
		return rstem + s
	}, true
}

func hiragana(s string) bool {
	if s == "" {
		return false
	}
	for _, c := range s {
		if !(c >= 0x3041 && c <= 0x3096) && c != 0x30fc {
			return false
		}
	}
	return true
}

func isKana(c rune) bool {
	return c >= 0x3041 && c <= 0x30ff
}
