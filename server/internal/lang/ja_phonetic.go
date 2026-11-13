package lang

import (
	"strings"

	"golang.org/x/text/unicode/norm"
)

// PhoneticKey returns a loose romaji key of a Japanese reading or query,
// so every common spelling of one word meets: とうきょう, トウキョウ,
// ﾄｳｷｮｳ, toukyou, Tōkyō, TÔKYÔ, ＴＯＫＹＯ and to-kyo all give "tokyo".
// The text is NFKC-folded and lowercased, its kana converted to Hepburn
// romaji (katakana folds, ー lengthens), diacritics such as macrons
// dropped, everything but a-z dropped (spaces, hyphens, apostrophes,
// kanji), and long vowels shortened: a doubled vowel and "ou" write one
// vowel. The key is for matching only; it is lossy on purpose. Text
// without kana or Latin letters has the key "".
func PhoneticKey(s string) string {
	s = kanaToRomaji(strings.ToLower(norm.NFKC.String(s)))
	var b []byte
	for _, r := range norm.NFKD.String(s) {
		if r < 'a' || r > 'z' {
			continue // combining marks, kanji, punctuation
		}
		c := byte(r)
		if n := len(b); n > 0 && isVowel(c) && (b[n-1] == c || (b[n-1] == 'o' && c == 'u')) {
			continue // a long vowel: tou, too, kuu, ...
		}
		b = append(b, c)
	}
	return string(b)
}
