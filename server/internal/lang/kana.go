package lang

import "strings"

// ToHiragana folds katakana to hiragana and leaves every other rune alone.
func ToHiragana(s string) string {
	return strings.Map(func(r rune) rune {
		if r >= katakanaLo && r <= katakanaHi {
			return r - foldOffset
		}
		return r
	}, s)
}
