package lang

import (
	"strings"
	"unicode"
)

// LatinLanguage reports whether code is one of the Latin-script languages
// the script checks know without a profile (the journal's offline OCR uses
// the same list).
func LatinLanguage(code string) bool { return latinLanguages[code] }

var latinLanguages = map[string]bool{"en": true, "de": true, "fr": true, "es": true, "it": true, "pt": true, "nl": true, "vi": true, "id": true, "tr": true, "pl": true}

// The script checks of AI output (moved from the journal for #186, where the
// AI examples use them too).

// FitsScript reports whether a text (a journal correction, a partner reply,
// an example sentence) is written in the language's script. The language
// profile decides for the languages that have one (ProfileOf, #199): a Han language needs a Han
// rune (with kana also Hiragana or Katakana), a Latin one a Latin letter. Of
// the others, ko needs Hangul and the Latin-script languages a Latin letter;
// the rest pass. This catches an AI that answers in the wrong language. A
// correction with no letters at all (a deletion or a punctuation fix) fits
// every language: only letters in the wrong script are rejected.
func FitsScript(language, correction string) bool {
	if strings.IndexFunc(correction, unicode.IsLetter) < 0 {
		return true
	}
	has := func(f func(rune) bool) bool { return strings.IndexFunc(correction, f) >= 0 }
	latin := func(r rune) bool { return unicode.IsLetter(r) && unicode.Is(unicode.Latin, r) }
	p := ProfileOf(language)
	switch {
	case p.Script == ScriptHan && p.Kana:
		return has(func(r rune) bool {
			return unicode.Is(unicode.Han, r) || unicode.Is(unicode.Hiragana, r) || unicode.Is(unicode.Katakana, r)
		})
	case p.Script == ScriptHan:
		return has(func(r rune) bool { return unicode.Is(unicode.Han, r) })
	case p.Script == ScriptLatin:
		return has(latin)
	case language == "ko":
		return has(func(r rune) bool { return unicode.Is(unicode.Hangul, r) })
	case latinLanguages[language]:
		return has(latin)
	}
	return true
}

// MostlyInScript is FitsScript plus a majority: at least half of the text's
// letters must be in the language's script, so a text in English with one
// word of the language is refused. A language whose script the check does not
// know passes, as in FitsScript.
func MostlyInScript(language, text string) bool {
	if !FitsScript(language, text) {
		return false
	}
	inScript, letters := 0, 0
	for _, r := range text {
		if !unicode.IsLetter(r) {
			continue
		}
		letters++
		if FitsScript(language, string(r)) {
			inScript++
		}
	}
	return letters == 0 || 2*inScript >= letters
}
