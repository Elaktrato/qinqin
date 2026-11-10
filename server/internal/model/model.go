// Package model holds the domain types shared across the qinqin backend.
package model

import "time"

// User is an authenticated account. The first user registered on a fresh
// database becomes the instance admin.
type User struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
	Admin    bool   `json:"admin"`
}

// Entry is one written form in a language's dictionary: a single character
// or a multi-character word. The same written form in two languages is two
// entries. Readings and attrs are child rows; readings normalize through
// the entry's language pack. RadicalID points at the entry of the radical
// a character is classified under; it is nil for words and unclassified
// characters.
type Entry struct {
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

// Reading is one pronunciation of an entry. Type is pack-defined —
// "pinyin", "bopomofo", "kana", "on", "kun", "romaji", … — Value is the
// display form, Plain the normalized search form, Ord the position among
// the entry's readings.
type Reading struct {
	Type  string `json:"type"`
	Value string `json:"value"`
	Plain string `json:"plain"`
	Ord   int    `json:"ord"`
}

// EntryPatch is one user's edit of one shared entry — the per-user
// overlay stored beside the entry and layered on it at read time, never
// written back to the shared rows. Nil fields are untouched: the
// shared value shows. A non-nil Written replaces the user's view of
// the written form; non-nil Readings replace the user's view of the
// readings with exactly the list saved — stored and served verbatim,
// never re-derived through a language pack. Sense-level edits are out
// of scope.
type EntryPatch struct {
	Written  *string   `json:"written"`
	Readings []Reading `json:"readings"`
}

// Dictionary is the registry row one imported dictionary pack creates,
// keyed by the pack's manifest id. Re-imports upsert the row; uninstall
// soft-deletes it.
type Dictionary struct {
	ID          int64      `json:"id"`
	PackID      string     `json:"packId"`
	Name        string     `json:"name"`
	Version     string     `json:"version"`
	License     string     `json:"license"`
	Attribution string     `json:"attribution"`
	UpdatedAt   time.Time  `json:"updatedAt"`
	DeletedAt   *time.Time `json:"deletedAt"`
}

// Sense is one gloss of one entry under one dictionary. Imports replace
// a dictionary's senses wholesale — old rows are soft-deleted, new rows
// inserted — so re-imports never touch entries or user data.
type Sense struct {
	ID           int64      `json:"id"`
	DictionaryID int64      `json:"dictionaryId"`
	EntryID      int64      `json:"entryId"`
	Gloss        string     `json:"gloss"`
	Ord          int        `json:"ord"`
	UpdatedAt    time.Time  `json:"updatedAt"`
	DeletedAt    *time.Time `json:"deletedAt"`
}
