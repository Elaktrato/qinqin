// Package model holds the domain types shared across the qinqin backend.
package model

import (
	"encoding/json"
	"time"
)

// User is an authenticated account. A fresh database gets its first admin
// from the serve bootstrap or `qinqin adduser --admin`, never by registering.
type User struct {
	ID                 int64   `json:"id"`
	Username           string  `json:"username"`
	Admin              bool    `json:"admin"`
	Email              *string `json:"email"`
	EmailVerified      bool    `json:"emailVerified"`
	MustChangePassword bool    `json:"mustChangePassword"`
	CreatedAt          string  `json:"createdAt"`
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
	Notice      string     `json:"notice"`
	UpdatedAt   time.Time  `json:"updatedAt"`
	DeletedAt   *time.Time `json:"deletedAt"`
}

// StrokePack is one installed strokes pack (internal/strokes) as the
// Sources page credits it. Ord is its lookup priority: for a character
// several packs carry, the live pack with the lowest Ord serves it.
type StrokePack struct {
	PackID      string   `json:"packId"`
	Name        string   `json:"name"`
	Version     string   `json:"version"`
	Languages   []string `json:"languages"`
	License     string   `json:"license"`
	Attribution string   `json:"attribution"`
	Notice      string   `json:"notice"`
	Ord         int      `json:"ord"`
	UpdatedAt   string   `json:"updatedAt"`
}

// SenseView is one gloss of an entry with the dictionary it comes from:
// the shape a reader needs to show a gloss together with its source and
// license. It carries no row ids or timestamps — those are sync's
// business, not the entry view's.
type SenseView struct {
	DictionaryID   int64  `json:"dictionaryId"`
	DictionaryName string `json:"dictionaryName"`
	PackID         string `json:"packId"`
	License        string `json:"license"`
	Attribution    string `json:"attribution"`
	Gloss          string `json:"gloss"`
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
	Notice      string     `json:"notice"`
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

// StudyEvent is one recorded study action — a review, a lookup, a
// session tick — pushed by a client in batches and stored append-only:
// rows are never updated or deleted. ID is the client-generated ULID,
// so a retried push of the same batch counts as duplicates instead of
// errors. TS is the client's event time, stored as UTC whole seconds
// (fraction truncated); WorkspaceID
// scopes the event to one of the owner's language workspaces; Payload
// carries the event-type-specific details verbatim.
type StudyEvent struct {
	ID          string          `json:"id"`
	UserID      int64           `json:"userId"`
	WorkspaceID int64           `json:"workspaceId"`
	Device      string          `json:"device"`
	TS          time.Time       `json:"ts"`
	Type        string          `json:"type"`
	Payload     json.RawMessage `json:"payload"`
}

// KeyedRow is one row of the keyed settings store (internal/keyed): a
// small JSON document of one user under a key of an accepted family. A nil
// WorkspaceID is user-global; a non-nil one scopes the row to a workspace.
// Version increments on every write; DeletedAt set marks a tombstone.
type KeyedRow struct {
	Key         string          `json:"key"`
	UserID      int64           `json:"userId"`
	WorkspaceID *int64          `json:"workspaceId"`
	Data        json.RawMessage `json:"data"`
	Version     int             `json:"version"`
	UpdatedAt   time.Time       `json:"updatedAt"`
	DeletedAt   *time.Time      `json:"deletedAt"`
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
	// AI marks a sentence an AI wrote (#186, docs/contracts/examples/): the
	// learner's own kept example, with the provider and model; nil for every
	// other sentence.
	AI *SentenceAI `json:"ai"`
}

// SentenceAI is who wrote an AI example: the provider id and the model.
type SentenceAI struct {
	Provider string `json:"provider"`
	Model    string `json:"model"`
}
