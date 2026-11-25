// Package journal holds the journal's documents (typed storage, store.go)
// and the checks the server applies to AI output before it is stored.
package journal

import (
	"qinqin/internal/ai"
)

// MaxGuidanceRunes caps the learner's guidance.
const MaxGuidanceRunes = 2000

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
	Kind        string `json:"kind"`
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
	Provider     string       `json:"provider,omitempty"`
	FallbackFrom string       `json:"fallbackFrom,omitempty"`
	Dropped      DropCounts   `json:"dropped"`
	CreatedAt    string       `json:"createdAt"`
}

// Suggestions is the stored topic ideas document.
type Suggestions struct {
	Items     []ai.SuggestionItem `json:"items"`
	Model     string              `json:"model"`
	Provider  string              `json:"provider,omitempty"`
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

func cutRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}
