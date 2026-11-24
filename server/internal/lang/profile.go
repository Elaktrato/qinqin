package lang

import "strings"

// The language profiles (#199, docs/contracts/languages/profiles.json): one
// core definition per language of what it has, read by availability checks
// instead of comparing codes. Reading code (pinyin, kana, deinflection)
// stays in the language packs. The web table is
// apps/web/src/lib/languageProfiles.ts; both are pinned to the fixture.

// Scripts of a profile.
const (
	ScriptHan   = "han"
	ScriptLatin = "latin"
	ScriptOther = "other"
)

// Profile is one language's core definition.
type Profile struct {
	Code          string   `json:"code"` // the primary subtag, "*" for the fallback
	Script        string   `json:"script"`
	Readings      []string `json:"readings"`
	Segmentation  string   `json:"segmentation"` // "dictionary" or "spaces"
	Tones         bool     `json:"tones"`
	Strokes       bool     `json:"strokes"`
	Kana          bool     `json:"kana"`
	Variants      bool     `json:"variants"`
	CardKinds     []string `json:"cardKinds"`
	PracticeModes []string `json:"practiceModes"`
}

// HasCardKind reports whether a session of the language may hold kind.
func (p Profile) HasCardKind(kind string) bool {
	for _, k := range p.CardKinds {
		if k == kind {
			return true
		}
	}
	return false
}

var (
	allPractice = []string{"decks", "levels", "characterMap"}
	plainKinds  = []string{"vocab", "sentence", "reverse", "cloze"}
)

// Profiles are the profiles in the fixture's order; the fallback is last.
var Profiles = []Profile{
	{Code: "zh", Script: ScriptHan, Readings: []string{"pinyin"}, Segmentation: "dictionary", Tones: true, Strokes: true, Variants: true,
		CardKinds: []string{"vocab", "sentence", "writing", "tone", "reverse", "cloze"}, PracticeModes: allPractice},
	{Code: "ja", Script: ScriptHan, Readings: []string{"kana"}, Segmentation: "dictionary", Kana: true,
		CardKinds: []string{"vocab", "sentence", "writing", "reverse", "cloze"}, PracticeModes: allPractice},
	{Code: "es", Script: ScriptLatin, Readings: []string{}, Segmentation: "spaces", CardKinds: plainKinds, PracticeModes: []string{"decks", "levels"}},
	{Code: "*", Script: ScriptOther, Readings: []string{}, Segmentation: "spaces", CardKinds: plainKinds, PracticeModes: []string{"decks", "levels"}},
}

// ProfileOf resolves a code by its primary subtag, case-insensitive
// (zh-TW -> zh); any other code gets the fallback.
func ProfileOf(code string) Profile {
	primary, _, _ := strings.Cut(strings.ToLower(strings.TrimSpace(code)), "-")
	primary, _, _ = strings.Cut(primary, "_")
	for _, p := range Profiles[:len(Profiles)-1] {
		if p.Code == primary {
			return p
		}
	}
	return Profiles[len(Profiles)-1]
}
