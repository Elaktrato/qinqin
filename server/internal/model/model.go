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

// Entry is one written form in the dictionary: a single hanzi or a
// multi-character word. Simplified and traditional spellings are separate
// entries linked to each other as variants. RadicalID points at the entry
// of the radical a character is classified under; it is nil for words and
// unclassified characters.
type Entry struct {
	ID          int64      `json:"id"`
	Kind        string     `json:"kind"` // "hanzi" or "word"
	Written     string     `json:"written"`
	Pinyin      string     `json:"pinyin"`
	PinyinPlain string     `json:"pinyinPlain"`
	Bopomofo    string     `json:"bopomofo"`
	Strokes     int        `json:"strokes"`
	RadicalID   *int64     `json:"radicalId"`
	UpdatedAt   time.Time  `json:"updatedAt"`
	DeletedAt   *time.Time `json:"deletedAt"`
}
