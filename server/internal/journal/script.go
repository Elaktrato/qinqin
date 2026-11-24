package journal

import (
	"strings"
	"unicode"

	"qinqin/internal/lang"
)

var latinLanguages = map[string]bool{"en": true, "de": true, "fr": true, "es": true, "it": true, "pt": true, "nl": true, "vi": true, "id": true, "tr": true, "pl": true}

// CorrectionFitsLanguage reports whether a correction is written in the
// workspace language's script. The language profile decides for the
// languages that have one (lang.ProfileOf, #199): a Han language needs a Han
// rune (with kana also Hiragana or Katakana), a Latin one a Latin letter. Of
// the others, ko needs Hangul and the Latin-script languages a Latin letter;
// the rest pass. This catches an AI that answers in the wrong language. A
// correction with no letters at all (a deletion or a punctuation fix) fits
// every language: only letters in the wrong script are rejected.
func CorrectionFitsLanguage(language, correction string) bool {
	if strings.IndexFunc(correction, unicode.IsLetter) < 0 {
		return true
	}
	has := func(f func(rune) bool) bool { return strings.IndexFunc(correction, f) >= 0 }
	latin := func(r rune) bool { return unicode.IsLetter(r) && unicode.Is(unicode.Latin, r) }
	p := lang.ProfileOf(language)
	switch {
	case p.Script == lang.ScriptHan && p.Kana:
		return has(func(r rune) bool {
			return unicode.Is(unicode.Han, r) || unicode.Is(unicode.Hiragana, r) || unicode.Is(unicode.Katakana, r)
		})
	case p.Script == lang.ScriptHan:
		return has(func(r rune) bool { return unicode.Is(unicode.Han, r) })
	case p.Script == lang.ScriptLatin:
		return has(latin)
	case language == "ko":
		return has(func(r rune) bool { return unicode.Is(unicode.Hangul, r) })
	case latinLanguages[language]:
		return has(latin)
	}
	return true
}
