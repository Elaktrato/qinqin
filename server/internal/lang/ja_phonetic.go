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
//
// Spellings are folded to Hepburn the way catalog readings are written:
// kunrei-shiki and Nihon-shiki (si, ti, tu, hu, zi, sya, tyo, zyu, di,
// du, ...) and "wo" (を reads o). The same function keys the readings and
// the queries, so both sides agree whatever the fold does.
//
// Heuristics, deliberately narrow: the particles は and へ read ha and he
// in the catalog, so a query word that is exactly "wa" or "e" (separated
// by whitespace) folds to ha / he; inside a word, wa and e stay
// (watashi, kae), and so do the pieces of a hyphenated word (e-hon is
// ehon, wa-fuu is wafuu). The fixed expressions こんにちは and こんばんは,
// whose は is a particle, are matched by the query words konnichiwa and
// konbanwa. Other words that hide a particle (such as "wagahaiwa") are
// not recognised, and a lone "wa" or "e" meaning わ or え is read as the
// particle; the text matcher still finds those by their plain spelling.
func PhoneticKey(s string) string {
	var b []byte
	for _, word := range strings.Fields(norm.NFKC.String(s)) {
		word = strings.ToLower(word)
		if p, ok := particleTokens[word]; ok {
			word = p
		}
		for _, token := range strings.Split(word, "-") {
			b = appendToken(b, token)
		}
	}
	var out []byte
	for _, c := range b {
		if n := len(out); n > 0 && isVowel(c) && (out[n-1] == c || (out[n-1] == 'o' && c == 'u')) {
			continue // a long vowel: tou, too, kuu, ...
		}
		out = append(out, c)
	}
	return string(out)
}

// particleTokens are the query words that stand for a particle or a fixed
// expression with one, keyed by the whole lowercase whitespace-separated
// word.
var particleTokens = map[string]string{
	"wa": "ha", "e": "he",
	"konnichiwa": "konnichiha", "konbanwa": "konbanha",
}

// hepburn folds kunrei-shiki and Nihon-shiki romaji, and wo, to Hepburn.
// Longer spellings come first so the replacer meets them before si, ti.
// It also runs over the Hepburn that kanaToRomaji writes, so the Hepburn
// syllables that contain a kunrei spelling map to themselves ahead of it:
// shu and chu hold "hu", which would otherwise fold to sfu and cfu
// (しゅじん, ちゅうごく). No other Hepburn syllable contains one of the
// spellings below (shi, chi and tsu hold hi, hi and su, which are not).
var hepburn = strings.NewReplacer(
	"shu", "shu", "chu", "chu",
	"sya", "sha", "syu", "shu", "syo", "sho",
	"tya", "cha", "tyu", "chu", "tyo", "cho",
	"zya", "ja", "zyu", "ju", "zyo", "jo",
	"si", "shi", "ti", "chi", "tu", "tsu", "hu", "fu", "zi", "ji",
	"di", "ji", "du", "zu", "wo", "o",
)

// appendToken appends the key letters of one lowercase word.
func appendToken(b []byte, token string) []byte {
	token = kanaToRomaji(token)
	var letters []byte
	for _, r := range norm.NFKD.String(token) {
		if r < 'a' || r > 'z' {
			continue // combining marks, kanji, punctuation
		}
		letters = append(letters, byte(r))
	}
	return append(b, hepburn.Replace(string(letters))...)
}
