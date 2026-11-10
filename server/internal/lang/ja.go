package lang

import (
	"slices"
	"strings"

	"qinqin/internal/model"
)

// Ja is the Japanese language pack: kana readings — kana, on, kun —
// normalize to a hiragana plain form, katakana folded to hiragana and
// the okurigana punctuation dictionary sources write dropped; romaji
// queries convert to kana, the canonical form of stored kana readings,
// so either script matches them; and every kana reading derives a
// romaji one through the kana tables.
type Ja struct{}

// Code is "ja".
func (Ja) Code() string { return "ja" }

// NormalizeReading returns the plain search form of one reading: kana
// readings — kana, on, kun — take the hiragana plain form; every other
// reading (romaji) lowercases.
func (Ja) NormalizeReading(readType, value string) string {
	switch readType {
	case "kana", "on", "kun":
		return kanaPlain(strings.ToLower(value))
	}
	return strings.ToLower(value)
}

// SearchPlain returns the plain search form of a query: a kana query
// takes the hiragana plain form, a romaji query converts to kana. A
// query that does not convert stays as written — search normalization
// never fails.
func (Ja) SearchPlain(query string) string {
	q := strings.ToLower(query)
	if containsKana(q) {
		return kanaPlain(q)
	}
	return romajiToKana(q)
}

// DeriveReadings appends a romaji reading converted from each kana
// reading — long vowels, the small tsu, and ん included. Nothing
// derives without a kana reading or when a romaji reading is already
// present; derivation never fails and never mutates its input.
func (j Ja) DeriveReadings(readings []model.Reading) []model.Reading {
	out := make([]model.Reading, len(readings))
	copy(out, readings)
	if slices.ContainsFunc(readings, func(r model.Reading) bool { return r.Type == "romaji" }) {
		return out
	}
	for _, r := range readings {
		if r.Type != "kana" {
			continue
		}
		romaji := kanaToRomaji(r.Value)
		out = append(out, model.Reading{
			Type:  "romaji",
			Value: romaji,
			Plain: j.NormalizeReading("romaji", romaji),
		})
	}
	return out
}

// Katakana folds to hiragana by a constant codepoint offset inside
// U+30A1–U+30F6 (ア U+30A2 → あ U+3042). The katakana middle dot and
// prolonged sound mark sit outside the fold range: the mark expands to
// the vowel of the kana before it, and everything else passes through.
const (
	katakanaLo = 0x30A1
	katakanaHi = 0x30F6
	foldOffset = 0x60
)

// okurigana is the punctuation dictionary sources write into kana
// readings — the dot and dash of a kun reading like まな.ぶ, the
// parentheses of an optional segment. It carries no sound, so the
// plain form drops it.
const okurigana = ".-() "

// kanaPlain returns the hiragana plain form of a kana reading or query:
// katakana folded to hiragana, okurigana punctuation dropped, and the
// prolonged sound mark expanded to the vowel of the kana before it —
// コーヒー plain こおひい — so readings the sources write with the mark
// match queries spelled out.
func kanaPlain(s string) string {
	var b strings.Builder
	prev := rune(0) // the last rune written, which a prolonged mark lengthens
	for _, r := range s {
		if strings.ContainsRune(okurigana, r) {
			continue
		}
		if r >= katakanaLo && r <= katakanaHi {
			r -= foldOffset
		}
		if r == 'ー' {
			if v := prolongedVowel(prev); v != 0 {
				b.WriteRune(v)
				prev = v
			}
			continue
		}
		b.WriteRune(r)
		prev = r
	}
	return b.String()
}

// prolongedVowel returns the kana of the vowel a prolonged sound mark
// lengthens after kana — こ is followed by お, ひ by い. A mark after
// anything that carries no vowel drops.
func prolongedVowel(kana rune) rune {
	switch lastVowel([]byte(kanaRomaji[kana])) {
	case 'a':
		return 'あ'
	case 'e':
		return 'え'
	case 'i':
		return 'い'
	case 'o':
		return 'お'
	case 'u':
		return 'う'
	}
	return 0
}

// containsKana reports whether s carries any kana — hiragana or
// katakana, small kana included. A query that does is treated as kana;
// anything else is tried as romaji.
func containsKana(s string) bool {
	for _, r := range s {
		if (r >= 0x3041 && r <= 0x309F) || (r >= 0x30A1 && r <= 0x30FF) {
			return true
		}
	}
	return false
}

// kanaRomaji maps every kana — big and small, the archaic ゐゑゔ
// included — to its Hepburn-ish romaji. The sokuon っ and the prolonged
// sound mark ー carry no romaji of their own and are handled by the
// converter.
var kanaRomaji = map[rune]string{
	'あ': "a", 'い': "i", 'う': "u", 'え': "e", 'お': "o",
	'か': "ka", 'き': "ki", 'く': "ku", 'け': "ke", 'こ': "ko",
	'が': "ga", 'ぎ': "gi", 'ぐ': "gu", 'げ': "ge", 'ご': "go",
	'さ': "sa", 'し': "shi", 'す': "su", 'せ': "se", 'そ': "so",
	'ざ': "za", 'じ': "ji", 'ず': "zu", 'ぜ': "ze", 'ぞ': "zo",
	'た': "ta", 'ち': "chi", 'つ': "tsu", 'て': "te", 'と': "to",
	'だ': "da", 'ぢ': "ji", 'づ': "zu", 'で': "de", 'ど': "do",
	'な': "na", 'に': "ni", 'ぬ': "nu", 'ね': "ne", 'の': "no",
	'は': "ha", 'ひ': "hi", 'ふ': "fu", 'へ': "he", 'ほ': "ho",
	'ば': "ba", 'び': "bi", 'ぶ': "bu", 'べ': "be", 'ぼ': "bo",
	'ぱ': "pa", 'ぴ': "pi", 'ぷ': "pu", 'ぺ': "pe", 'ぽ': "po",
	'ま': "ma", 'み': "mi", 'む': "mu", 'め': "me", 'も': "mo",
	'や': "ya", 'ゆ': "yu", 'よ': "yo",
	'ら': "ra", 'り': "ri", 'る': "ru", 'れ': "re", 'ろ': "ro",
	'わ': "wa", 'ゐ': "wi", 'ゑ': "we", 'を': "wo",
	'ん': "n",
	'ゔ': "vu",
	'ぁ': "a", 'ぃ': "i", 'ぅ': "u", 'ぇ': "e", 'ぉ': "o",
	'ゃ': "ya", 'ゅ': "yu", 'ょ': "yo",
}

// kanaCombos maps a kana plus a small kana to one romaji syllable:
// き+ゃ = kya, し+ゅ = shu, じ+ょ = jo, ふ+ぁ = fa.
var kanaCombos = map[[2]rune]string{
	{'き', 'ゃ'}: "kya", {'き', 'ゅ'}: "kyu", {'き', 'ょ'}: "kyo",
	{'ぎ', 'ゃ'}: "gya", {'ぎ', 'ゅ'}: "gyu", {'ぎ', 'ょ'}: "gyo",
	{'し', 'ゃ'}: "sha", {'し', 'ゅ'}: "shu", {'し', 'ょ'}: "sho",
	{'じ', 'ゃ'}: "ja", {'じ', 'ゅ'}: "ju", {'じ', 'ょ'}: "jo",
	{'ち', 'ゃ'}: "cha", {'ち', 'ゅ'}: "chu", {'ち', 'ょ'}: "cho",
	{'に', 'ゃ'}: "nya", {'に', 'ゅ'}: "nyu", {'に', 'ょ'}: "nyo",
	{'ひ', 'ゃ'}: "hya", {'ひ', 'ゅ'}: "hyu", {'ひ', 'ょ'}: "hyo",
	{'び', 'ゃ'}: "bya", {'び', 'ゅ'}: "byu", {'び', 'ょ'}: "byo",
	{'ぴ', 'ゃ'}: "pya", {'ぴ', 'ゅ'}: "pyu", {'ぴ', 'ょ'}: "pyo",
	{'み', 'ゃ'}: "mya", {'み', 'ゅ'}: "myu", {'み', 'ょ'}: "myo",
	{'り', 'ゃ'}: "rya", {'り', 'ゅ'}: "ryu", {'り', 'ょ'}: "ryo",
	{'ふ', 'ぁ'}: "fa", {'ふ', 'ぃ'}: "fi", {'ふ', 'ぇ'}: "fe", {'ふ', 'ぉ'}: "fo",
}

// romajiSyllable is one romanized syllable and the kana it parses back
// to.
type romajiSyllable struct {
	romaji string
	kana   string
}

// romajiSyllables holds each romanized syllable and its kana, ordered
// longest-first for greedy matching. It is the inverse of kanaRomaji
// and kanaCombos, minus the kana that never parse back: the small kana
// (combining marks, the sokuon, the chōon), the archaic ゐゑ, and the
// Hepburn-merged ぢづ, whose spellings resolve to じ and ず.
var romajiSyllables = func() []romajiSyllable {
	uninvertible := map[rune]bool{
		'ぁ': true, 'ぃ': true, 'ぅ': true, 'ぇ': true, 'ぉ': true,
		'ゃ': true, 'ゅ': true, 'ょ': true,
		'っ': true, 'ー': true,
		'ゐ': true, 'ゑ': true, 'ぢ': true, 'づ': true,
	}
	m := make(map[string]string)
	for r, romaji := range kanaRomaji {
		if !uninvertible[r] && m[romaji] == "" {
			m[romaji] = string(r)
		}
	}
	for pair, romaji := range kanaCombos {
		if m[romaji] == "" {
			m[romaji] = string(pair[:])
		}
	}
	out := make([]romajiSyllable, 0, len(m))
	for romaji, kana := range m {
		out = append(out, romajiSyllable{romaji: romaji, kana: kana})
	}
	slices.SortFunc(out, func(a, b romajiSyllable) int {
		return len(b.romaji) - len(a.romaji)
	})
	return out
}()

// kanaToRomaji converts kana — hiragana or katakana — to romaji: small
// ya/yu/yo and the loanword small vowels combine with the neighboring
// kana, a small tsu doubles the next syllable's consonant (Hepburn's
// "t" before a ち-cluster), and okurigana punctuation drops. The
// prolonged sound mark has already expanded in the plain form.
// Anything that is not kana passes through.
func kanaToRomaji(s string) string {
	rs := []rune(kanaPlain(s))
	var b []byte
	for i := 0; i < len(rs); i++ {
		r := rs[i]
		if r == 'っ' {
			// The small tsu doubles the next syllable's consonant.
			if c := geminateConsonant(unitRomaji(rs, i+1)); c != "" {
				b = append(b, c...)
			}
			continue
		}
		if i+1 < len(rs) {
			if romaji, ok := kanaCombos[[2]rune{r, rs[i+1]}]; ok {
				b = append(b, romaji...)
				i++
				continue
			}
		}
		if isSmallVowel(r) {
			// A small vowel combines with the kana before it: ふ+ぁ = fa.
			b = appendSmallVowel(b, r)
			continue
		}
		if romaji, ok := kanaRomaji[r]; ok {
			b = append(b, romaji...)
			continue
		}
		b = append(b, string(r)...)
	}
	return string(b)
}

// unitRomaji returns the romaji of the kana unit at position i — a kana
// plus a small ya/yu/yo when one follows — or "" when no kana starts
// there.
func unitRomaji(rs []rune, i int) string {
	if i >= len(rs) {
		return ""
	}
	if i+1 < len(rs) {
		if romaji, ok := kanaCombos[[2]rune{rs[i], rs[i+1]}]; ok {
			return romaji
		}
	}
	return kanaRomaji[rs[i]]
}

// geminateConsonant returns the consonant a small tsu writes ahead of a
// syllable: the syllable's first letter, Hepburn's "t" before a
// ち-cluster, and nothing ahead of a vowel.
func geminateConsonant(syllable string) string {
	if syllable == "" {
		return ""
	}
	if strings.HasPrefix(syllable, "ch") {
		return "t"
	}
	if strings.ContainsRune("aeiou", rune(syllable[0])) {
		return ""
	}
	return syllable[:1]
}

// isSmallVowel reports whether r is one of the small vowels ぁぃぅぇぉ.
func isSmallVowel(r rune) bool {
	switch r {
	case 'ぁ', 'ぃ', 'ぅ', 'ぇ', 'ぉ':
		return true
	}
	return false
}

// smallVowel is the romaji vowel each small vowel writes.
var smallVowel = map[rune]byte{
	'ぁ': 'a', 'ぃ': 'i', 'ぅ': 'u', 'ぇ': 'e', 'ぉ': 'o',
}

// appendSmallVowel appends a small vowel's romaji to b: after a big
// kana ending in a different vowel it replaces that vowel (ふ+ぁ = fa),
// otherwise it writes the vowel itself.
func appendSmallVowel(b []byte, r rune) []byte {
	v := smallVowel[r]
	if n := len(b); n > 1 && isVowel(b[n-1]) && b[n-1] != v {
		return append(b[:n-1], v)
	}
	return append(b, v)
}

// isVowel reports whether c is one of the romaji vowels.
func isVowel(c byte) bool {
	return strings.IndexByte("aeiou", c) >= 0
}

// lastVowel returns the last vowel in b, or 0 when there is none.
func lastVowel(b []byte) byte {
	for i := len(b) - 1; i >= 0; i-- {
		if isVowel(b[i]) {
			return b[i]
		}
	}
	return 0
}

// romajiToKana converts a lowercase romaji query to kana: syllables
// match longest-first, a doubled consonant becomes the small tsu, and
// a closing n — before another n, an apostrophe, a consonant other
// than y, or the end — is ん. An n before a y is an onset instead:
// nya, nyu, nyo are にゃ, にゅ, にょ, and the んや reading writes its
// apostrophe (shin'ya), so the romaji the pack derives from kana
// round-trips. A query that does not parse as romaji stays as written.
func romajiToKana(s string) string {
	var b strings.Builder
	i := 0
	for i < len(s) {
		// A doubled consonant other than n is the small tsu: one of
		// the pair is consumed, the other starts the next syllable.
		if i+1 < len(s) && s[i] == s[i+1] && s[i] != 'n' && isConsonant(s[i]) {
			b.WriteString("っ")
			i++
			continue
		}
		// Hepburn writes the small tsu before a ち-cluster as "t".
		if strings.HasPrefix(s[i:], "tch") {
			b.WriteString("っ")
			i++ // the t is the sokuon; the cha/chu/cho syllable follows
			continue
		}
		if s[i] == 'n' && nCloses(s, i) {
			b.WriteString("ん")
			i++
			if i < len(s) && s[i] == '\'' {
				i++
			}
			continue
		}
		matched := false
		for _, sy := range romajiSyllables {
			if strings.HasPrefix(s[i:], sy.romaji) {
				b.WriteString(sy.kana)
				i += len(sy.romaji)
				matched = true
				break
			}
		}
		if !matched {
			return s // not romaji: the query stays as written
		}
	}
	return b.String()
}

// nCloses reports whether the n at s[i] is the moraic nasal ん closing
// a syllable rather than the onset of one: it closes at the end of the
// query, before another n, before an apostrophe, or before a consonant
// other than y. An n before a y is an onset — nya, nyu, nyo are にゃ,
// にゅ, にょ — and a んや reading writes its apostrophe (shin'ya), so
// the romaji the pack derives from kana converts back to the kana it
// came from.
func nCloses(s string, i int) bool {
	if i+1 == len(s) {
		return true
	}
	next := s[i+1]
	return next == 'n' || next == '\'' || (isConsonant(next) && next != 'y')
}

// isConsonant reports whether c is a lowercase romaji consonant.
func isConsonant(c byte) bool {
	return c >= 'a' && c <= 'z' && !isVowel(c)
}
