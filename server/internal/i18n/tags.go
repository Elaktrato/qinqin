// Package i18n is the server side of the interface-text contract
// (docs/contracts/i18n/): the stored interface-language setting, language
// negotiation and the shared ICU-subset message syntax used by the mails.
package i18n

import "regexp"

// LanguageTagPattern is the syntax of a stored interface language other
// than "": language, optional script, optional region, in canonical case
// (docs/contracts/i18n/language-tags.json).
const LanguageTagPattern = `^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?$`

var languageTag = regexp.MustCompile(LanguageTagPattern)

// IsLanguageSetting reports whether v may be stored as an interface
// language: "" (follow the browser/device) or a canonical tag. Syntax only:
// whether any client supports the language is never checked.
func IsLanguageSetting(v string) bool {
	return v == "" || languageTag.MatchString(v)
}
