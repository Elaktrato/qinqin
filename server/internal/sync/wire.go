package sync

import "time"

// The lexicon wire format. These structs are the contract with clients
// (the future mobile app stores them as they arrive); they map the
// lexicon tables explicitly instead of exposing the lexicon package's Go
// types, so either side can change without breaking the other. Frequency
// data is not synced: ranking is server-side only.

// Entry is one lexicon headword with its written forms and readings.
// Its senses and links ship in their own Delta collections. An entry is
// shipped again whenever the entry row, its forms or its readings
// change (the lexicon restamps the entry on a child change), so a client
// replaces its forms and readings wholesale with the shipped ones.
// DeletedAt marks a tombstone (shipped on incremental pulls only; a
// tombstone carries no forms or readings).
type Entry struct {
	ID        int64             `json:"id"`
	Language  string            `json:"language"`
	Kind      string            `json:"kind"` // word or character
	Key       string            `json:"key"`  // the source's external key
	Forms     []Form            `json:"forms"`
	Readings  []Reading         `json:"readings"`
	Pri       int               `json:"pri"`
	UK        bool              `json:"uk"` // usually written in kana
	Attrs     map[string]string `json:"attrs"`
	UpdatedAt time.Time         `json:"updatedAt"`
	DeletedAt *time.Time        `json:"deletedAt,omitempty"`
}

// Form is one written form of an entry.
type Form struct {
	Text  string   `json:"text"`
	Ord   int      `json:"ord"`
	Flags []string `json:"flags"`
	Pri   int      `json:"pri"`
}

// Reading is one pronunciation of an entry: Type is pinyin, kana, ...;
// Value is the display form, Plain the normalized form lookups match.
type Reading struct {
	Type  string   `json:"type"`
	Value string   `json:"value"`
	Plain string   `json:"plain"`
	Ord   int      `json:"ord"`
	Flags []string `json:"flags"`
	Pri   int      `json:"pri"`
}

// Sense is one meaning of an entry as one dictionary gives it.
//
// Sense ids are NOT stable: the lexicon retires and re-inserts all of a
// dictionary's senses of an entry whenever any of them changes, so the
// ids churn. Clients must key senses by (entryId, dictionaryId, ord),
// never by id. Apply a delta's senses in order (updatedAt, then id). A
// tombstone without a live row at its key in the same delta removes the
// sense at that key; the server drops a tombstone that a live
// replacement at the same key supersedes, so a delta never holds both.
// A sense whose dictionary was uninstalled, or that a re-import no
// longer has, is a tombstone.
type Sense struct {
	ID           int64      `json:"id"`
	DictionaryID int64      `json:"dictionaryId"`
	EntryID      int64      `json:"entryId"`
	Ord          int        `json:"ord"`
	POS          []string   `json:"pos"`
	Tags         []string   `json:"tags"`
	Glosses      []string   `json:"glosses"`
	Xrefs        []string   `json:"xrefs"`
	UpdatedAt    time.Time  `json:"updatedAt"`
	DeletedAt    *time.Time `json:"deletedAt,omitempty"`
}

// Link is one lexicon link between entries: a variant (stored in both
// directions) or a radical (character to its radical). Links are keyed
// by (fromId, toId, type).
type Link struct {
	FromID    int64      `json:"fromId"`
	ToID      int64      `json:"toId"`
	Type      string     `json:"type"`
	UpdatedAt time.Time  `json:"updatedAt"`
	DeletedAt *time.Time `json:"deletedAt,omitempty"`
}
