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

// Scheme is the registry row one imported levels pack creates — HSK,
// JLPT, a curriculum table: any ordered ladder of levels over one
// language's entries — keyed by the pack's manifest id. Re-imports
// upsert the row and replace its levels and memberships; uninstall
// soft-deletes them. Entries survive both.
type Scheme struct {
	ID          int64      `json:"id"`
	PackID      string     `json:"packId"`
	Name        string     `json:"name"`
	Unit        string     `json:"unit"` // "word" or "character"
	Language    string     `json:"language"`
	Version     string     `json:"version"`
	License     string     `json:"license"`
	Attribution string     `json:"attribution"`
	Levels      []Level    `json:"levels"`
	UpdatedAt   time.Time  `json:"updatedAt"`
	DeletedAt   *time.Time `json:"deletedAt"`
}

// Level is one rung of a scheme's ladder, ordered by Ord.
type Level struct {
	ID        int64      `json:"id"`
	SchemeID  int64      `json:"schemeId"`
	Ord       int        `json:"ord"`
	Name      string     `json:"name"`
	UpdatedAt time.Time  `json:"updatedAt"`
	DeletedAt *time.Time `json:"deletedAt"`
}

// Badge is one scheme's tag on an entry: the scheme, the level the entry
// belongs to, and whether that membership was derived from a member
// word's characters rather than listed by the pack.
type Badge struct {
	SchemeID   int64  `json:"schemeId"`
	SchemeName string `json:"schemeName"`
	LevelName  string `json:"levelName"`
	Derived    bool   `json:"derived"`
}

// Sentence is one example sentence on an entry: a pack-provided one
// carries its source pack and no owner; a user-added one carries the
// owning user and no pack. Pack imports replace that pack's sentences
// wholesale and never touch user-owned rows, so a user's sentence
// survives pack re-imports.
type Sentence struct {
	ID          int64      `json:"id"`
	EntryID     int64      `json:"entryId"`
	SourcePack  string     `json:"sourcePack"`
	UserID      *int64     `json:"userId"`
	Hanzi       string     `json:"hanzi"`
	Pinyin      string     `json:"pinyin"`
	Translation string     `json:"translation"`
	UpdatedAt   time.Time  `json:"updatedAt"`
	DeletedAt   *time.Time `json:"deletedAt"`
}
