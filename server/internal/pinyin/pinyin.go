// Package pinyin converts Mandarin pinyin, written with tone numbers or tone
// marks, into bopomofo, tone-marked pinyin, and a plain search form.
package pinyin

import (
	"fmt"
	"strings"
)

type toneMark struct {
	base rune
	tone int
}

// markedVowels maps each base vowel to its tone-marked forms for tones 1-4.
var markedVowels = map[rune][4]rune{
	'a': {'ā', 'á', 'ǎ', 'à'},
	'e': {'ē', 'é', 'ě', 'è'},
	'i': {'ī', 'í', 'ǐ', 'ì'},
	'o': {'ō', 'ó', 'ǒ', 'ò'},
	'u': {'ū', 'ú', 'ǔ', 'ù'},
	'ü': {'ǖ', 'ǘ', 'ǚ', 'ǜ'},
}

var toneMarks = func() map[rune]toneMark {
	m := make(map[rune]toneMark)
	for base, forms := range markedVowels {
		for i, r := range forms {
			m[r] = toneMark{base: base, tone: i + 1}
		}
	}
	return m
}()

// initials is ordered so that multi-letter initials match before single letters.
var initials = []string{"zh", "ch", "sh", "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "j", "q", "x", "r", "z", "c", "s"}

var initialBopomofo = map[string]string{
	"":   "",
	"b":  "ㄅ",
	"p":  "ㄆ",
	"m":  "ㄇ",
	"f":  "ㄈ",
	"d":  "ㄉ",
	"t":  "ㄊ",
	"n":  "ㄋ",
	"l":  "ㄌ",
	"g":  "ㄍ",
	"k":  "ㄎ",
	"h":  "ㄏ",
	"j":  "ㄐ",
	"q":  "ㄑ",
	"x":  "ㄒ",
	"zh": "ㄓ",
	"ch": "ㄔ",
	"sh": "ㄕ",
	"r":  "ㄖ",
	"z":  "ㄗ",
	"c":  "ㄘ",
	"s":  "ㄙ",
}

// apicalInitials take the final "i" as a bare consonant sound with no vowel symbol.
var apicalInitials = map[string]bool{"zh": true, "ch": true, "sh": true, "r": true, "z": true, "c": true, "s": true}

var finalBopomofo = map[string]string{
	"a":    "ㄚ",
	"o":    "ㄛ",
	"e":    "ㄜ",
	"ai":   "ㄞ",
	"ei":   "ㄟ",
	"ao":   "ㄠ",
	"ou":   "ㄡ",
	"an":   "ㄢ",
	"en":   "ㄣ",
	"ang":  "ㄤ",
	"eng":  "ㄥ",
	"er":   "ㄦ",
	"ong":  "ㄨㄥ",
	"i":    "ㄧ",
	"ia":   "ㄧㄚ",
	"ie":   "ㄧㄝ",
	"iao":  "ㄧㄠ",
	"iou":  "ㄧㄡ",
	"ian":  "ㄧㄢ",
	"in":   "ㄧㄣ",
	"iang": "ㄧㄤ",
	"ing":  "ㄧㄥ",
	"iong": "ㄩㄥ",
	"u":    "ㄨ",
	"ua":   "ㄨㄚ",
	"uo":   "ㄨㄛ",
	"uai":  "ㄨㄞ",
	"uei":  "ㄨㄟ",
	"uan":  "ㄨㄢ",
	"uen":  "ㄨㄣ",
	"uang": "ㄨㄤ",
	"ueng": "ㄨㄥ",
	"ü":    "ㄩ",
	"üe":   "ㄩㄝ",
	"üan":  "ㄩㄢ",
	"ün":   "ㄩㄣ",
}

// finalsByInitial lists the finals each initial takes in standard Mandarin
// syllables. Keys may name several initials separated by spaces.
var finalsByInitial = map[string]string{
	"b p":   "a o ai ei ao ou an en ang eng i ie iao ian in ing u",
	"m":     "a e o ai ei ao ou an en ang eng i ie iao iou ian in ing u",
	"f":     "a o ei ou an en ang eng u",
	"d":     "a e ai ei ao ou an en ang eng ong i ia ie iao iou ian ing u uo uei uan uen",
	"t":     "a e ai ei ao ou an ang eng ong i ie iao ian ing u uo uei uan uen",
	"n":     "a e ai ei ao ou an en ang eng ong i ie iao iou ian in iang ing u uo uan uen ü üe",
	"l":     "a e o ai ei ao ou an en ang eng ong i ia ie iao iou ian in iang ing u uo uan uen ü üe",
	"g h":   "a e ai ei ao ou an en ang eng ong u ua uo uai uei uan uen uang",
	"k":     "a e ai ei ao ou an en ang eng ong u ua uo uai uei uan uen uang",
	"j q x": "i ia ie iao iou ian in iang ing iong ü üe üan ün",
	"zh ch": "a e ai ei ao ou an en ang eng ong u ua uo uai uei uan uen uang",
	"sh":    "a e ai ei ao ou an en ang eng u ua uo uai uei uan uen uang",
	"r":     "e ao ou an en ang eng ong u uo uei uan uen",
	"z":     "a e ai ei ao ou an en ang eng ong u uo uei uan uen",
	"c s":   "a e ai ao ou an en ang eng ong u uo uei uan uen",
}

var validFinals = func() map[string]map[string]bool {
	set := make(map[string]map[string]bool)
	for initialGroup, finals := range finalsByInitial {
		for _, ini := range strings.Fields(initialGroup) {
			if set[ini] == nil {
				set[ini] = make(map[string]bool)
			}
			for _, f := range strings.Fields(finals) {
				set[ini][f] = true
			}
		}
	}
	return set
}()

// validSyllable reports whether an initial and final form a real Mandarin syllable.
// A bare zero-initial final must be a standalone syllable, so "ong" is excluded.
func validSyllable(initial, final string) bool {
	switch {
	case initial == "":
		_, ok := finalBopomofo[final]
		return ok && final != "ong"
	case apicalInitials[initial] && final == "i":
		return true
	}
	return validFinals[initial][final]
}

var toneBopomofo = [6]string{"", "", "ˊ", "ˇ", "ˋ", ""}

// syllable is one parsed pinyin syllable.
type syllable struct {
	initial string
	final   string // normalized final: zero-initial spellings resolved, "ü" written as ü
	spelled string // typed spelling with tone removed and ü written as ü
	tone    int    // 0 = no tone given, 1-4 tones, 5 neutral
}

func (s syllable) isApical() bool {
	return s.final == "i" && apicalInitials[s.initial]
}

func (s syllable) bopomofo() string {
	body := initialBopomofo[s.initial]
	if !s.isApical() {
		body += finalBopomofo[s.final]
	}
	return body + toneBopomofo[s.tone]
}

// zeroInitialFinal rewrites y- and w-spellings into their medial-based finals.
func zeroInitialFinal(s string) string {
	switch {
	case strings.HasPrefix(s, "y"):
		rest := s[1:]
		switch {
		case rest == "":
			return ""
		case rest[0] == 'i':
			return rest
		case rest[0] == 'u':
			return "ü" + rest[1:]
		default:
			return "i" + rest
		}
	case strings.HasPrefix(s, "w"):
		rest := s[1:]
		if rest == "" {
			return ""
		}
		if rest == "u" {
			return "u"
		}
		return "u" + rest
	}
	return s
}

func parse(token string) (syllable, error) {
	invalid := fmt.Errorf("pinyin: invalid syllable %q", token)
	runes := []rune(strings.ToLower(token))
	tone := 0
	if n := len(runes); n > 0 && runes[n-1] >= '1' && runes[n-1] <= '5' {
		tone = int(runes[n-1] - '0')
		runes = runes[:n-1]
	}
	for i, r := range runes {
		if m, ok := toneMarks[r]; ok {
			tone = m.tone
			runes[i] = m.base
		}
	}
	spelled := strings.NewReplacer("u:", "ü", "v", "ü").Replace(string(runes))

	initial := ""
	rest := spelled
	for _, ini := range initials {
		if strings.HasPrefix(spelled, ini) {
			initial = ini
			rest = spelled[len(ini):]
			break
		}
	}

	final := rest
	if initial == "" {
		final = zeroInitialFinal(spelled)
	} else {
		if initial == "j" || initial == "q" || initial == "x" {
			if strings.HasPrefix(final, "u") {
				final = "ü" + final[1:]
			}
		}
		switch final {
		case "iu":
			final = "iou"
		case "ui":
			final = "uei"
		case "un":
			final = "uen"
		}
	}

	if !validSyllable(initial, final) {
		return syllable{}, invalid
	}
	return syllable{initial: initial, final: final, spelled: spelled, tone: tone}, nil
}

func parseAll(s string) ([]syllable, error) {
	tokens := strings.Fields(s)
	if len(tokens) == 0 {
		return nil, fmt.Errorf("pinyin: empty input")
	}
	syls := make([]syllable, len(tokens))
	for i, tok := range tokens {
		syl, err := parse(tok)
		if err != nil {
			return nil, err
		}
		syls[i] = syl
	}
	return syls, nil
}

// ToBopomofo converts space-separated pinyin (tone numbers or tone marks) to bopomofo.
func ToBopomofo(s string) (string, error) {
	syls, err := parseAll(s)
	if err != nil {
		return "", err
	}
	out := make([]string, len(syls))
	for i, syl := range syls {
		out[i] = syl.bopomofo()
	}
	return strings.Join(out, " "), nil
}

// ToMarked converts space-separated pinyin (tone numbers or tone marks) to tone-marked pinyin.
func ToMarked(s string) (string, error) {
	syls, err := parseAll(s)
	if err != nil {
		return "", err
	}
	out := make([]string, len(syls))
	for i, syl := range syls {
		out[i] = syl.marked()
	}
	return strings.Join(out, " "), nil
}

func (s syllable) marked() string {
	spelled := []rune(s.spelled)
	if s.initial == "j" || s.initial == "q" || s.initial == "x" {
		for i, r := range spelled {
			if r == 'ü' {
				spelled[i] = 'u'
			}
		}
	}
	if s.tone < 1 || s.tone > 4 {
		return string(spelled)
	}
	idx := markIndex(spelled)
	spelled[idx] = markedVowels[baseVowel(spelled[idx])][s.tone-1]
	return string(spelled)
}

// markIndex returns the position of the vowel that carries the tone mark:
// a or e if present, otherwise o in "ou", otherwise the last vowel.
func markIndex(r []rune) int {
	for i, c := range r {
		if c == 'a' || c == 'e' {
			return i
		}
	}
	for i := 0; i+1 < len(r); i++ {
		if r[i] == 'o' && r[i+1] == 'u' {
			return i
		}
	}
	for i := len(r) - 1; i >= 0; i-- {
		if _, ok := markedVowels[baseVowel(r[i])]; ok {
			return i
		}
	}
	return 0
}

// baseVowel returns the key of markedVowels for a rune, or the rune itself
// when it is an unmarked vowel. Non-vowels map to themselves and are not in markedVowels.
func baseVowel(r rune) rune {
	if m, ok := toneMarks[r]; ok {
		return m.base
	}
	return r
}

// Plain returns lowercase pinyin letters only: tones, spaces, and apostrophes are
// removed, and ü, u:, and v are all written as v.
func Plain(s string) string {
	var base strings.Builder
	for _, r := range strings.ToLower(s) {
		if m, ok := toneMarks[r]; ok {
			r = m.base
		}
		base.WriteRune(r)
	}
	var b strings.Builder
	for _, r := range strings.NewReplacer("u:", "v", "ü", "v").Replace(base.String()) {
		if r >= 'a' && r <= 'z' {
			b.WriteRune(r)
		}
	}
	return b.String()
}
