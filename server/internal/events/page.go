package events

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// The paged form of GET /api/events (issue #110, docs/contracts/events/):
// the caller's events in (ts, id) order, a keyset walk whose position is
// the last shipped (ts, id). Events are immutable, so a position never
// moves. Design: docs/superpowers/specs/2026-11-22-events-paging-design.md.

var (
	// ErrPageInvalid is a paged request whose parameters are wrong: a bad,
	// garbled or foreign page token, a continuation that repeats since or
	// limit or names another workspace, or a limit outside 1..MaxPageLimit.
	ErrPageInvalid = errors.New("events: invalid page request")
	// ErrSinceInvalid is a since that is not RFC 3339.
	ErrSinceInvalid = errors.New("since must be RFC 3339")
)

// Page budget: the pull v2's (sync.MaxPageLimit, sync.MaxPageBytes; a test
// in api keeps them equal). A page always holds at least one row while rows
// remain, so a single row above MaxPageBytes ships alone.
const (
	MaxPageLimit = 2000
	MaxPageBytes = 4 << 20
)

const pagePrefix = "e1."

// PageRequest is one GET /api/events request. Paged is the paged form
// (limit or page given); the legacy form uses Since alone. A continuation
// carries Page (its since and limit are inside it). Workspace is the
// caller's checked workspace= (0: none); the handler sets it.
type PageRequest struct {
	Paged     bool
	Since     time.Time
	Limit     int
	Page      string
	Workspace int64
}

// ParsePageRequest reads since, limit and page (workspace is the caller's
// business: it needs an ownership check). A continuation may repeat
// neither since nor limit; a parameter given twice is invalid.
func ParsePageRequest(q url.Values) (PageRequest, error) {
	for _, name := range []string{"since", "limit", "page"} {
		if len(q[name]) > 1 {
			return PageRequest{}, fmt.Errorf("%w: %s given twice", ErrPageInvalid, name)
		}
	}
	if q.Has("page") {
		for _, name := range []string{"since", "limit"} {
			if q.Has(name) {
				return PageRequest{}, fmt.Errorf("%w: a continuation repeats %s", ErrPageInvalid, name)
			}
		}
		if q.Get("page") == "" {
			return PageRequest{}, fmt.Errorf("%w: empty page", ErrPageInvalid)
		}
		return PageRequest{Paged: true, Page: q.Get("page")}, nil
	}
	var req PageRequest
	if raw := q.Get("since"); raw != "" {
		t, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			return PageRequest{}, ErrSinceInvalid
		}
		// Stored ts are whole seconds: the second of since is included.
		req.Since = t.UTC().Truncate(time.Second)
	}
	if q.Has("limit") {
		n, err := strconv.Atoi(q.Get("limit"))
		if err != nil || n < 1 || n > MaxPageLimit {
			return PageRequest{}, fmt.Errorf("%w: limit must be 1..%d", ErrPageInvalid, MaxPageLimit)
		}
		req.Paged, req.Limit = true, n
	}
	return req, nil
}

// pageToken is a walk between two pages: the user, the filters and the
// last shipped (ts, id). It is not signed: every request re-derives the
// user from its credential, filters by it and re-checks the workspace, so
// a forged token can only move a position inside the caller's own rows.
type pageToken struct {
	User      int64  `json:"u"`
	Workspace int64  `json:"w"`
	Since     string `json:"s"`
	Limit     int    `json:"m"`
	TS        string `json:"t"`
	ID        string `json:"i"`
}

func (t pageToken) encode() string {
	raw, err := json.Marshal(t)
	if err != nil {
		panic(fmt.Sprintf("events: encode page token: %v", err)) // a plain struct: cannot fail
	}
	return pagePrefix + base64.RawURLEncoding.EncodeToString(raw)
}

// decodePageToken parses a page token of user and checks it is well formed.
func decodePageToken(s string, user int64) (pageToken, error) {
	body, ok := strings.CutPrefix(s, pagePrefix)
	if !ok {
		return pageToken{}, fmt.Errorf("%w: token prefix", ErrPageInvalid)
	}
	raw, err := base64.RawURLEncoding.DecodeString(body)
	if err != nil {
		return pageToken{}, fmt.Errorf("%w: token encoding", ErrPageInvalid)
	}
	var t pageToken
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&t); err != nil || dec.More() {
		return pageToken{}, fmt.Errorf("%w: token body", ErrPageInvalid)
	}
	switch {
	case t.User != user:
		return pageToken{}, fmt.Errorf("%w: token of another user", ErrPageInvalid)
	case t.Limit < 1 || t.Limit > MaxPageLimit, t.Workspace < 0, !wholeSecond(t.Since):
		return pageToken{}, fmt.Errorf("%w: token filters", ErrPageInvalid)
	case !wholeSecond(t.TS) || t.ID == "":
		return pageToken{}, fmt.Errorf("%w: token position", ErrPageInvalid)
	}
	return t, nil
}

// wholeSecond reports whether s is a stored timestamp: UTC RFC 3339
// without a fraction.
func wholeSecond(s string) bool {
	t, err := time.Parse(time.RFC3339, s)
	return err == nil && t.UTC().Format(time.RFC3339) == s
}
