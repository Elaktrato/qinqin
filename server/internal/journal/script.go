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
// A correction with no letters at all (a deletion or a punctuation fix) fits
// every language: only letters in the wrong script are rejected.
func CorrectionFitsLanguage(lang, correction string) bool {
	if strings.IndexFunc(correction, unicode.IsLetter) < 0 {
		return true
	}
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
