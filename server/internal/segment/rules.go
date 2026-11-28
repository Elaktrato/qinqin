package segment

import (
	"bytes"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"sync"
)

// rulesFS holds the segmentation rules per language
// (docs/contracts/segment/<language>.json, byte for byte). A language
// without a file is segmented by greedy longest match.
//
//go:embed rules/*.json
var rulesFS embed.FS

// Rules are a language's whole-sentence segmentation rules: the costs of
// the lattice and the closed list of function words
// (docs/contracts/segment/README.md).
type Rules struct {
	Format   int    `json:"format"`
	Language string `json:"language"`
	Costs    Costs  `json:"costs"`
	// SplitWords are surfaces that are never one token: in running text
	// they are a word and a particle (今日は is 今日 | は; the greeting is
	// written こんにちは).
	SplitWords []string `json:"splitWords"`
	// FunctionPOS are the parts of speech of a function word's entry.
	FunctionPOS []string `json:"functionPos"`
	// FunctionWords are the lemmas that are function words (particles,
	// the copula, auxiliaries) when an entry of theirs has a FunctionPOS
	// or the lemma's FunctionReadings reading.
	FunctionWords []string `json:"functionWords"`
	// FunctionReadings name a function word by its reading where the
	// dictionary has no parts of speech (CC-CEDICT): 着 is a function
	// word through its reading zhe, which its match then shows.
	FunctionReadings map[string]string `json:"functionReadings,omitempty"`
	// Compounds is "parts" when a token of two or more runes whose head is
	// in no word level list is no edge where listed words and function
	// words read its whole text (不是 is 不 | 是); "" keeps every edge.
	Compounds string `json:"compounds,omitempty"`
	// PartFunctionWords are the function words that count as a listed
	// part anywhere in a compound under the Compounds rule (得 in 得很);
	// any other function word only as its last part (在地 is 在 | 地, but
	// 地上 stays the noun).
	PartFunctionWords []string `json:"partFunctionWords,omitempty"`
	// Readings are the readings a match of these surfaces shows when its
	// entry has them (长 cháng), before the everyday rule.
	Readings map[string]string `json:"readings,omitempty"`
}

// Costs are the lattice costs: a token costs Token, a function word's
// nothing more, any other token WeakReading more for a weak kana-fit match
// and NoPriorityKana more for an all-kana match of an entry without
// priority; a
// token that starts between two kanji costs KanjiSplit more; a rune no
// token covers costs Unmatched.
type Costs struct {
	Token          int `json:"token"`
	WeakReading    int `json:"weakReading"`
	NoPriorityKana int `json:"noPriorityKana"`
	KanjiSplit     int `json:"kanjiSplit"`
	Unmatched      int `json:"unmatched"`
	// LevelStep and Unlisted price a token by the word level lists of
	// the language (#349): a token whose head is a direct member costs
	// LevelStep per level index more (its lowest level, at most
	// Unlisted), any other Unlisted more. Zero for both: no level costs.
	LevelStep int `json:"levelStep,omitempty"`
	Unlisted  int `json:"unlisted,omitempty"`
}

// usesLevels reports whether the rules read the word level lists.
func (r *Rules) usesLevels() bool {
	return r.Costs.LevelStep > 0 || r.Costs.Unlisted > 0 || r.Compounds == CompoundsParts
}

// CompoundsParts is the Compounds rule that drops an unlisted compound its
// listed parts can read.
const CompoundsParts = "parts"

// MaxRulesFormat is the newest rules format this engine reads.
const MaxRulesFormat = 1

// ParseRules decodes a rules file strictly: one JSON object, no unknown
// key, a known format, costs from 0 to 10,000 (a token at least 1, Unmatched
// above any token of one position), a non-empty function word list
// without empty entries whose words each have a part of speech list or a
// function reading, and a known Compounds rule.
func ParseRules(data []byte) (*Rules, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	var r Rules
	if err := dec.Decode(&r); err != nil {
		return nil, fmt.Errorf("segment rules: %w", err)
	}
	if dec.More() {
		return nil, errors.New("segment rules: trailing data")
	}
	if r.Format < 1 || r.Format > MaxRulesFormat {
		return nil, fmt.Errorf("segment rules: format %d", r.Format)
	}
	c := r.Costs
	for _, v := range []int{c.Token, c.WeakReading, c.NoPriorityKana, c.KanjiSplit, c.Unmatched, c.LevelStep, c.Unlisted} {
		if v < 0 || v > 10_000 {
			return nil, fmt.Errorf("segment rules: cost %d outside 0..10000", v)
		}
	}
	if c.Token < 1 {
		return nil, errors.New("segment rules: a token costs at least 1")
	}
	if c.Unmatched <= c.Token+c.WeakReading+c.NoPriorityKana+c.Unlisted {
		return nil, errors.New("segment rules: an unmatched rune must cost more than any token")
	}
	if len(r.FunctionWords) == 0 || slices.Contains(r.FunctionPOS, "") || slices.Contains(r.FunctionWords, "") || slices.Contains(r.SplitWords, "") {
		return nil, errors.New("segment rules: empty function list or entry")
	}
	for _, w := range r.FunctionWords {
		if len(r.FunctionPOS) == 0 && r.FunctionReadings[w] == "" {
			return nil, fmt.Errorf("segment rules: function word %q has no part of speech list and no reading", w)
		}
	}
	for w, rd := range r.FunctionReadings {
		if rd == "" || !slices.Contains(r.FunctionWords, w) {
			return nil, fmt.Errorf("segment rules: function reading of %q", w)
		}
	}
	for _, w := range r.PartFunctionWords {
		if !slices.Contains(r.FunctionWords, w) {
			return nil, fmt.Errorf("segment rules: part function word %q is no function word", w)
		}
	}
	for w, rd := range r.Readings {
		if w == "" || rd == "" {
			return nil, errors.New("segment rules: empty reading")
		}
	}
	if r.Compounds != "" && r.Compounds != CompoundsParts {
		return nil, fmt.Errorf("segment rules: compounds %q", r.Compounds)
	}
	return &r, nil
}

// RulesFile returns the embedded rules file of language.
func RulesFile(language string) ([]byte, bool) {
	b, err := rulesFS.ReadFile("rules/" + language + ".json")
	return b, err == nil
}

var (
	rulesOnce sync.Once
	rulesBy   map[string]*Rules
)

// rulesFor returns the parsed rules of language, nil for none. The files
// are checked by the tests; one that fails to parse is a build defect.
func rulesFor(language string) *Rules {
	rulesOnce.Do(func() {
		rulesBy = map[string]*Rules{}
		files, _ := rulesFS.ReadDir("rules")
		for _, f := range files {
			b, _ := rulesFS.ReadFile("rules/" + f.Name())
			r, err := ParseRules(b)
			if err != nil {
				panic(fmt.Sprintf("segment: embedded %s: %v", f.Name(), err))
			}
			rulesBy[r.Language] = r
		}
	})
	return rulesBy[language]
}
