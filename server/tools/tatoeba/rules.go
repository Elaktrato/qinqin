package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"sort"
)

// Rules is rules.json, the one tunable file of the filter: everything a
// reviewer may want to change after looking at a sample lives here.
type Rules struct {
	Notes []string `json:"notes,omitempty"`
	// TranslationLanguage is the Tatoeba code of the translations kept.
	TranslationLanguage string `json:"translationLanguage"`
	MaxTranslationRunes int    `json:"maxTranslationRunes"`
	// DropOrphans drops sentences (and translations) without an owner.
	DropOrphans bool `json:"dropOrphans"`
	// DropNegativeReviews drops a sentence any user reviewed with -1.
	DropNegativeReviews bool `json:"dropNegativeReviews"`
	// NativeOnly keeps only sentences whose owner declares NativeSkill in
	// the sentence's language; otherwise native owners rank first.
	NativeOnly  bool   `json:"nativeOnly"`
	NativeSkill string `json:"nativeSkill"`
	// DropTags are reliability tags, DenyTags unsuitable topics; matched
	// case-insensitively against the whole tag.
	DropTags []string `json:"dropTags"`
	DenyTags []string `json:"denyTags"`
	// MaxPerWord caps the sentences of one word group.
	MaxPerWord int `json:"maxPerWord"`
	// SampleSize is the number of lines of the review sample.
	SampleSize int                  `json:"sampleSize"`
	Languages  map[string]LangRules `json:"languages"`

	sum string // SHA-256 of the file, recorded in ATTRIBUTION.md
}

// LangRules are the rules of one pack.
type LangRules struct {
	Notes   []string `json:"notes,omitempty"`
	Tatoeba string   `json:"tatoeba"` // Tatoeba's ISO 639-3 code
	PackID  string   `json:"packId"`
	Name    string   `json:"name"`
	// Dictionary is the pack the sentences are segmented and linked with,
	// relative to the repository root.
	Dictionary  string `json:"dictionary"`
	ReadingType string `json:"readingType"` // pinyin | kana
	MinRunes    int    `json:"minRunes"`
	MaxRunes    int    `json:"maxRunes"`
	// MinCoverage is the share of the sentence's Han and kana code points
	// that must lie inside dictionary matches.
	MinCoverage float64 `json:"minCoverage"`
	// DenyWords drops a sentence containing any of them.
	DenyWords []string `json:"denyWords"`
	// SkipWords are matched (they count for coverage) but get no group.
	SkipWords []string `json:"skipWords"`
	// DefaultReadings settles a word with several readings: written form
	// (or dictionary form) → the reading to use, when it is one of them.
	DefaultReadings map[string]string `json:"defaultReadings"`
}

// languageCodes are the packs the tool can build.
var languageCodes = []string{"ja", "zh"}

func loadRules(file string) (Rules, error) {
	data, err := os.ReadFile(file)
	if err != nil {
		return Rules{}, fmt.Errorf("rules: %w", err)
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	var r Rules
	if err := dec.Decode(&r); err != nil {
		return Rules{}, fmt.Errorf("rules %s: %w", file, err)
	}
	sum := sha256.Sum256(data)
	r.sum = hex.EncodeToString(sum[:])
	if err := r.check(); err != nil {
		return Rules{}, fmt.Errorf("rules %s: %w", file, err)
	}
	return r, nil
}

func (r Rules) check() error {
	switch {
	case r.TranslationLanguage == "":
		return fmt.Errorf("translationLanguage is required")
	case r.MaxTranslationRunes < 1:
		return fmt.Errorf("maxTranslationRunes must be at least 1")
	case r.MaxPerWord < 1:
		return fmt.Errorf("maxPerWord must be at least 1")
	case r.SampleSize < 0:
		return fmt.Errorf("sampleSize must not be negative")
	case len(r.Languages) == 0:
		return fmt.Errorf("no languages")
	}
	for _, code := range sortedKeys(r.Languages) {
		l := r.Languages[code]
		known := false
		for _, c := range languageCodes {
			known = known || c == code
		}
		switch {
		case !known:
			return fmt.Errorf("language %q: the tool builds only %v", code, languageCodes)
		case l.Tatoeba == "" || l.PackID == "" || l.Name == "" || l.Dictionary == "":
			return fmt.Errorf("language %s: tatoeba, packId, name and dictionary are required", code)
		case l.ReadingType != "pinyin" && l.ReadingType != "kana":
			return fmt.Errorf("language %s: readingType must be pinyin or kana", code)
		case l.MinRunes < 1 || l.MaxRunes < l.MinRunes:
			return fmt.Errorf("language %s: need 1 <= minRunes <= maxRunes", code)
		case l.MinCoverage < 0 || l.MinCoverage > 1:
			return fmt.Errorf("language %s: minCoverage must be between 0 and 1", code)
		}
	}
	return nil
}

func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
