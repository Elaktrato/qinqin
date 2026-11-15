// Package journal holds the journal's plugin documents and the checks the
// server applies to AI output before it is stored.
package journal

import (
	"encoding/json"
	"errors"
	"slices"

	"qinqin/internal/ai"
)

// PluginID is the journal's plugin id; its data is workspace-scoped.
const PluginID = "qinqin-journal"

// SuggestionsKey and SettingsKey are the single-document keys.
const SuggestionsKey, SettingsKey = "suggestions", "settings"

// MaxGuidanceRunes caps the learner's guidance.
const MaxGuidanceRunes = 2000

// EntryKey is the plugin data key of an entry.
func EntryKey(id string) string { return "entry:" + id }

// ReviewKey is the plugin data key of an entry's review.
func ReviewKey(id string) string { return "review:" + id }

// Entry is one dated journal entry.
type Entry struct {
	ID        string `json:"id"`
	Date      string `json:"date"`
	Title     string `json:"title"`
	Text      string `json:"text"`
	Source    string `json:"source"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

// Annotation is one validated underline; Prefix and Suffix are computed by
// the server from the text, never taken from the model.
type Annotation struct {
	ID          string `json:"id"`
	Quote       string `json:"quote"`
	Prefix      string `json:"prefix"`
	Suffix      string `json:"suffix"`
	Correction  string `json:"correction"`
	Explanation string `json:"explanation"`
	Category    string `json:"category"`
}

// DropCounts says how many model annotations were discarded, and why.
type DropCounts struct {
	NotFound    int `json:"notFound"`
	WrongScript int `json:"wrongScript"`
	NoChange    int `json:"noChange"`
	Overlap     int `json:"overlap"`
	Empty       int `json:"empty"`
	TooMany     int `json:"tooMany"`
}

// Total is the number of dropped annotations.
func (d DropCounts) Total() int {
	return d.NotFound + d.WrongScript + d.NoChange + d.Overlap + d.Empty + d.TooMany
}

// Review is the stored review of one entry.
type Review struct {
	EntryID      string       `json:"entryId"`
	TextHash     string       `json:"textHash"`
	Annotations  []Annotation `json:"annotations"`
	Overall      ai.Overall   `json:"overall"`
	Model        string       `json:"model"`
	FallbackFrom string       `json:"fallbackFrom,omitempty"`
	Dropped      DropCounts   `json:"dropped"`
	CreatedAt    string       `json:"createdAt"`
}

// Suggestions is the stored topic ideas document.
type Suggestions struct {
	Items     []ai.SuggestionItem `json:"items"`
	Model     string              `json:"model"`
	CreatedAt string              `json:"createdAt"`
}

// Settings are the per-workspace journal settings.
type Settings struct {
	Guidance            string `json:"guidance"`
	ExplanationLanguage string `json:"explanationLanguage"`
}

// ExplanationLanguages is the fixed list of languages feedback may be
// written in; free text could become an injection channel.
var ExplanationLanguages = []string{"en", "de", "fr", "es", "it", "pt", "nl", "ru", "ja", "zh-Hans", "zh-Hant", "ko"}

// ParseEntry reads an entry document; it needs an id and a string text.
func ParseEntry(raw json.RawMessage) (Entry, error) {
	var e struct {
		Entry
		Text *string `json:"text"`
	}
	if err := json.Unmarshal(raw, &e); err != nil {
		return Entry{}, err
	}
	if e.ID == "" || e.Text == nil {
		return Entry{}, errors.New("journal: entry needs an id and a text")
	}
	e.Entry.Text = *e.Text
	return e.Entry, nil
}

// ParseSettings reads the settings leniently: anything unreadable gives the
// defaults, an unknown language reads as "en", guidance is cut to 2000 runes.
func ParseSettings(raw json.RawMessage) Settings {
	s := Settings{ExplanationLanguage: "en"}
	var in Settings
	if len(raw) == 0 || json.Unmarshal(raw, &in) != nil {
		return s
	}
	if slices.Contains(ExplanationLanguages, in.ExplanationLanguage) {
		s.ExplanationLanguage = in.ExplanationLanguage
	}
	s.Guidance = cutRunes(in.Guidance, MaxGuidanceRunes)
	return s
}

func cutRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}
