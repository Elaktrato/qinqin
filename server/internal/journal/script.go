package journal

import (
	"strings"
	"unicode"
)

var latinLanguages = map[string]bool{"en": true, "de": true, "fr": true, "es": true, "it": true, "pt": true, "nl": true, "vi": true, "id": true, "tr": true, "pl": true}

// CorrectionFitsLanguage reports whether a correction is written in the
// workspace language's script: zh needs a Han rune, ja Han, Hiragana or
// Katakana, ko Hangul, the Latin-script languages a Latin letter. Other
// languages pass. This catches an AI that answers in the wrong language.
func CorrectionFitsLanguage(lang, correction string) bool {
	has := func(f func(rune) bool) bool { return strings.IndexFunc(correction, f) >= 0 }
	switch {
	case lang == "zh":
		return has(func(r rune) bool { return unicode.Is(unicode.Han, r) })
	case lang == "ja":
		return has(func(r rune) bool {
			return unicode.Is(unicode.Han, r) || unicode.Is(unicode.Hiragana, r) || unicode.Is(unicode.Katakana, r)
		})
	case lang == "ko":
		return has(func(r rune) bool { return unicode.Is(unicode.Hangul, r) })
	case latinLanguages[lang]:
		return has(func(r rune) bool { return unicode.IsLetter(r) && unicode.Is(unicode.Latin, r) })
	}
	return true
}
