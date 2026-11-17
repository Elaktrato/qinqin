package sync

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"time"
)

// Token prefixes: a page token continues a round, a cursor starts the next
// one. Only the prefixes are a contract; the rest is opaque base64url JSON.
const (
	pagePrefix   = "p2."
	cursorPrefix = "c2."
)

// position is where a round continues: the segment index and the last
// shipped key inside it ((stamp, rowid); the zero key is the segment start).
// rowid never leaves the server except inside an opaque token.
type position struct {
	Seg   int    `json:"i"`
	Stamp string `json:"t"`
	RowID int64  `json:"r"`
}

// filters are the request parameters a round is bound to. Collections is
// the canonical list (round order, every requested name); Workspace 0 is
// none; Tombstones is tombstones=1 (omitted when false, so tokens of rounds
// without it keep their bytes).
type filters struct {
	Collections []string `json:"c"`
	Workspace   int64    `json:"w"`
	Tombstones  bool     `json:"t,omitempty"`
}

func (f filters) equal(o filters) bool {
	return f.Workspace == o.Workspace && f.Tombstones == o.Tombstones && slices.Equal(f.Collections, o.Collections)
}

// pageToken is the state of a round between two pages. It is not signed:
// every request re-derives authorization from the session and filters by
// the session's user, so a forged token can only move a position inside
// the caller's own rows (and a workspace in it is re-checked).
type pageToken struct {
	User      int64    `json:"u"`
	Since     string   `json:"s"`
	Until     string   `json:"n"`
	Pos       position `json:"k"`
	Filters   filters  `json:"f"`
	Limit     int      `json:"m"`
	Languages []string `json:"l"`
	Restarted bool     `json:"x"`
}

// cursorToken is the since of the next round: the time, the filters and
// language set it was made for, and its user.
type cursorToken struct {
	User      int64    `json:"u"`
	Time      string   `json:"t"`
	Filters   filters  `json:"f"`
	Languages []string `json:"l"`
}

func encodeToken(prefix string, v any) string {
	raw, err := json.Marshal(v)
	if err != nil {
		panic(fmt.Sprintf("sync: encode token: %v", err)) // plain structs: cannot fail
	}
	return prefix + base64.RawURLEncoding.EncodeToString(raw)
}

func decodeToken(prefix, s string, v any) error {
	body, ok := strings.CutPrefix(s, prefix)
	if !ok {
		return fmt.Errorf("%w: token prefix", ErrPageInvalid)
	}
	raw, err := base64.RawURLEncoding.DecodeString(body)
	if err != nil {
		return fmt.Errorf("%w: token encoding", ErrPageInvalid)
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return fmt.Errorf("%w: token body", ErrPageInvalid)
	}
	if dec.More() {
		return fmt.Errorf("%w: token body", ErrPageInvalid)
	}
	return nil
}

func validStamp(s string) bool {
	t, err := time.Parse(time.RFC3339, s)
	return err == nil && t.UTC().Format(time.RFC3339) == s
}

func validLanguages(l []string) bool {
	return slices.IsSorted(l) && len(slices.Compact(slices.Clone(l))) == len(l)
}

func (t pageToken) encode() string { return encodeToken(pagePrefix, t) }

// decodePage parses a page token of user and checks it is well formed for
// a round over nSegs segments.
func decodePage(s string, user int64, nSegs int) (pageToken, error) {
	var t pageToken
	if err := decodeToken(pagePrefix, s, &t); err != nil {
		return pageToken{}, err
	}
	switch {
	case t.User != user:
		return pageToken{}, fmt.Errorf("%w: token of another user", ErrPageInvalid)
	case t.Since != "" && !validStamp(t.Since), !validStamp(t.Until):
		return pageToken{}, fmt.Errorf("%w: token window", ErrPageInvalid)
	case t.Pos.Seg < 0 || t.Pos.Seg >= nSegs || t.Pos.RowID < 0 || (t.Pos.Stamp != "" && !validStamp(t.Pos.Stamp)):
		return pageToken{}, fmt.Errorf("%w: token position", ErrPageInvalid)
	case t.Limit < 1 || t.Limit > MaxPageLimit, t.Filters.Workspace < 0, len(t.Filters.Collections) == 0:
		return pageToken{}, fmt.Errorf("%w: token filters", ErrPageInvalid)
	case !validLanguages(t.Languages):
		return pageToken{}, fmt.Errorf("%w: token languages", ErrPageInvalid)
	}
	return t, nil
}

func (t cursorToken) encode() string { return encodeToken(cursorPrefix, t) }

// decodeCursor parses a since cursor and checks it belongs to user and to
// exactly these filters (a client keeps one cursor per filter set).
func decodeCursor(s string, user int64, f filters) (cursorToken, error) {
	var t cursorToken
	if err := decodeToken(cursorPrefix, s, &t); err != nil {
		return cursorToken{}, err
	}
	switch {
	case t.User != user:
		return cursorToken{}, fmt.Errorf("%w: cursor of another user", ErrPageInvalid)
	case !t.Filters.equal(f):
		return cursorToken{}, fmt.Errorf("%w: cursor of other filters", ErrPageInvalid)
	case !validStamp(t.Time), !validLanguages(t.Languages):
		return cursorToken{}, fmt.Errorf("%w: cursor body", ErrPageInvalid)
	}
	return t, nil
}
