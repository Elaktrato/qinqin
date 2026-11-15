// Package pinyin converts Mandarin pinyin, written with tone numbers or tone
// marks, into bopomofo, tone-marked pinyin, and a plain search form.
package pinyin

import (
	"fmt"
	"slices"
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
	// Marks the syllabic nasals and ê carry; they are not in markedVowels
	// because they are not vowels of the general tone-mark rule.
	for r, tm := range map[rune]toneMark{
		'ń': {'n', 2}, 'ň': {'n', 3}, 'ǹ': {'n', 4},
		'ḿ': {'m', 2},
		'ế': {'ê', 2}, 'ề': {'ê', 4},
	} {
		m[r] = tm
	}
	return m
}()

// initials lists the initials of initialBopomofo, longest first so that
// multi-letter initials match before single letters; deriving it keeps the
// two from drifting apart.
var initials = func() []string {
	out := make([]string, 0, len(initialBopomofo))
	for ini := range initialBopomofo {
		if ini != "" {
			out = append(out, ini)
		}
	}
	slices.SortFunc(out, func(a, b string) int {
		if len(a) != len(b) {
			return len(b) - len(a)
		}
		return strings.Compare(a, b)
	})
	return out
}()

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
	"b":     "a o ai ei ao an en ang eng i ie iao ian in ing u",
	"p":     "a o ai ei ao ou an en ang eng i ie iao ian in ing u",
	"m":     "a e o ai ei ao ou an en ang eng i ie iao iou ian in ing u",
	"f":     "a o ei ou an en ang eng u",
	"d":     "a e ai ei ao ou an en ang eng ong i ia ie iao iou ian ing u uo uei uan uen",
	"t":     "a e ai ei ao ou an ang eng ong i ie iao ian ing u uo uei uan uen",
	"n":     "a e ai ei ao ou an en ang eng ong i ie iao iou ian in iang ing u uo uan ü üe",
	"l":     "a e o ai ei ao ou an ang eng ong i ia ie iao iou ian in iang ing u uo uan uen ü üe",
	"g h":   "a e ai ei ao ou an en ang eng ong u ua uo uai uei uan uen uang",
	"k":     "a e ai ei ao ou an en ang eng ong u ua uo uai uei uan uen uang",
	"j q x": "i ia ie iao iou ian in iang ing iong ü üe üan ün",
	"zh":    "a e ai ei ao ou an en ang eng ong u ua uo uai uei uan uen uang",
	"ch":    "a e ai ao ou an en ang eng ong u ua uo uai uei uan uen uang",
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

// special is a syllable that is no initial-final pair: the interjection yo
// and the syllabic nasals and ê dictionaries write (嗯 n/ng, 呣 m, 哼 hng/hm,
// 欸 ê). They are valid only as a whole token — never as a part of a longer
// run — so splitting an unspaced token cannot invent them.
type special struct {
	bopomofo string
	mark     int // rune index of the letter that carries the tone mark
}

var specials = map[string]special{
	"yo":  {"ㄧㄛ", 1},
	"n":   {"ㄣ", 0},
	"ng":  {"ㄫ", 0},
	"m":   {"ㄇ", 0},
	"hng": {"ㄏㄫ", 1},
	"hm":  {"ㄏㄇ", 1},
	"ê":   {"ㄝ", 0},
}

// specialMarks holds the precomposed tone-marked forms of the letters a
// special carries its mark on (0 = none: written with a combining mark).
var specialMarks = map[rune][4]rune{
	'n': {0, 'ń', 'ň', 'ǹ'},
	'm': {0, 'ḿ', 0, 0},
	'ê': {0, 'ế', 0, 'ề'},
	'o': markedVowels['o'],
}

// combiningTone are the combining marks of tones 1-4: macron, acute,
// caron, grave.
var combiningTone = [4]rune{0x0304, 0x0301, 0x030C, 0x0300}

// markSpecial writes letter with its tone mark, precomposed where Unicode
// has the form and combining otherwise.
func markSpecial(letter rune, tone int) string {
	if r := specialMarks[letter][tone-1]; r != 0 {
		return string(r)
	}
	return string([]rune{letter, combiningTone[tone-1]})
}

var toneBopomofo = [6]string{"", "", "ˊ", "ˇ", "ˋ", ""}

// syllable is one parsed pinyin syllable.
type syllable struct {
	initial string
	final   string // normalized final: zero-initial spellings resolved, "ü" written as ü
	spelled string // typed spelling with tone removed and ü written as ü
	tone    int    // 0 = no tone given, 1-4 tones, 5 neutral
	special bool   // a special (see specials): final holds its spelling
}

func (s syllable) isApical() bool {
	return s.final == "i" && apicalInitials[s.initial]
}

func (s syllable) bopomofo() string {
	if s.special {
		return specials[s.spelled].bopomofo + toneBopomofo[s.tone]
	}
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

func parse(token string) (syllable, error) { return parseSyllable(token, true) }

// parseSyllable parses one syllable; allowSpecial admits the specials, which
// only a whole token may be.
func parseSyllable(token string, allowSpecial bool) (syllable, error) {
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
	if spelled == "eh" {
		spelled = "ê"
	}
	if _, ok := specials[spelled]; ok {
		if !allowSpecial {
			return syllable{}, invalid
		}
		return syllable{final: spelled, spelled: spelled, tone: tone, special: true}, nil
	}

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

// isApostrophe reports the apostrophes that separate syllables: the ASCII
// one and the typographic one.
func isApostrophe(r rune) bool { return r == '\'' || r == '’' }

// parseAll parses whitespace-separated syllables. An apostrophe also
// separates ("xi'an" is "xi an"); unspaced runs without one stay an error.
func parseAll(s string) ([]syllable, error) {
	var syls []syllable
	for _, tok := range strings.Fields(s) {
		for _, piece := range strings.FieldsFunc(tok, isApostrophe) {
			syl, err := parse(piece)
			if err != nil {
				return nil, err
			}
			syls = append(syls, syl)
		}
	}
	if len(syls) == 0 {
		return nil, fmt.Errorf("pinyin: empty input")
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
	if s.special {
		if s.tone >= 1 && s.tone <= 4 {
			i := specials[s.spelled].mark
			return string(spelled[:i]) + markSpecial(spelled[i], s.tone) + string(spelled[i+1:])
		}
		return s.spelled
	}
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
		if r == 'ê' {
			r = 'e'
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

// maxSyllableRunes bounds a split attempt: six letters plus one tone mark.
const maxSyllableRunes = 7

// splitSyllables splits one whitespace-free token into syllables: first on
// apostrophes, then greedily on the longest prefix that parse accepts,
// backtracking one step at a time when the rest cannot be split. A token
// that cannot be split is returned whole, so parse reports it.
func splitSyllables(token string) []string {
	var out []string
	for _, piece := range strings.FieldsFunc(token, func(r rune) bool { return r == '\'' || r == '’' }) {
		parts, ok := splitPiece([]rune(piece))
		if !ok {
			return []string{token}
		}
		out = append(out, parts...)
	}
	if len(out) == 0 {
		return []string{token}
	}
	return out
}

// isErhua reports whether a syllable is the erhua suffix r, alone or with the
// neutral tone CC-CEDICT writes (r5).
func isErhua(s string) bool {
	s = strings.ToLower(s)
	return s == "r" || s == "r5"
}

func splitPiece(r []rune) ([]string, bool) {
	if len(r) == 0 {
		return nil, true
	}
	if isErhua(string(r)) {
		return []string{string(r)}, true
	}
	for n := min(len(r), maxSyllableRunes); n >= 1; n-- {
		if _, err := parseSyllable(string(r[:n]), n == len(r)); err != nil {
			continue
		}
		if rest, ok := splitPiece(r[n:]); ok {
			return append([]string{string(r[:n])}, rest...), true
		}
	}
	return nil, false
}

// ToNumbered converts pinyin (tone numbers or tone marks, spaces optional)
// to one lowercase numbered syllable per syllable: ü is written v and the
// neutral tone 5, so "nǚ'ér" gives ["nv3", "er2"]. An erhua r, written alone
// (CC-CEDICT's "r5") or after a syllable ("diǎnr"), is the syllable er5.
func ToNumbered(s string) ([]string, error) {
	tokens := strings.Fields(s)
	if len(tokens) == 0 {
		return nil, fmt.Errorf("pinyin: empty input")
	}
	var out []string
	for _, tok := range tokens {
		for _, part := range splitSyllables(tok) {
			if isErhua(part) {
				out = append(out, "er5") // the suffix is spoken as a neutral-tone er
				continue
			}
			syl, err := parse(part)
			if err != nil {
				return nil, err
			}
			tone := syl.tone
			if tone == 0 {
				tone = 5
			}
			spelled := strings.ReplaceAll(syl.spelled, "ü", "v")
			if syl.special && spelled == "ê" {
				spelled = "eh" // ASCII, as the audio index writes it
			}
			if syl.initial == "j" || syl.initial == "q" || syl.initial == "x" {
				spelled = strings.ReplaceAll(spelled, "v", "u") // ju, not jv
			}
			out = append(out, spelled+string(rune('0'+tone)))
		}
	}
	return out, nil
}
