package model

import "time"

// EntryBase is a lexicon entry as the API lists it: its id, language and
// kind, its headword (Written: its display form, lexicon.Entry.Headword —
// the kana of a usually-kana word, never a search-only form), its
// readings in stored order, its attrs, and the radical entry a character
// is classified under (nil for words and unclassified characters). A user's overlay (see the overlay package) replaces
// Written and Readings on this struct. DeletedAt is always nil: only
// active entries are served.
type EntryBase struct {
	ID        int64             `json:"id"`
	Language  string            `json:"language"`
	Kind      string            `json:"kind"` // "character" or "word"
	Written   string            `json:"written"`
	Readings  []Reading         `json:"readings"`
	Attrs     map[string]string `json:"attrs"`
	RadicalID *int64            `json:"radicalId"`
	UpdatedAt time.Time         `json:"updatedAt"`
	DeletedAt *time.Time        `json:"deletedAt"`
}
