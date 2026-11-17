package sync

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"
)

// The paged pull (sync v2, GET /api/sync/pull?v=2): the caller's own rows,
// one collection after another in a fixed round order, each walked by
// keyset over (stamp, rowid) inside a window since <= stamp < until that
// the round fixes at its first page. Contract: docs/contracts/sync/.

var (
	// ErrPageInvalid is a v2 request whose parameters are wrong: a bad or
	// foreign token, a cursor of other filters, a continuation that repeats
	// a filter, a limit outside 1..MaxPageLimit or an unknown collection.
	ErrPageInvalid = errors.New("sync: invalid page request")
	// ErrMoved is a request for a lexicon collection; those are in packages.
	ErrMoved = errors.New("sync: collection moved to packages")
	// ErrCursorExpired tells a client to discard its local user data and
	// pull without since. Defined for a later tombstone purge; not sent yet.
	ErrCursorExpired = errors.New("sync: cursor expired")
)

// V2Collections are the collections of a round, in round order.
var V2Collections = []string{"workspaces", "pluginStates", "pluginData", "cards", "decks", "deckSettings", "limits",
	"fsrsSets", "fsrsActive", "books", "bookmarks", "highlights", "overlays", "sentences", "events"}

// MovedCollections are the lexicon collections that left the pull.
var MovedCollections = []string{"entries", "links", "senses", "levelMembers", "dictionaries", "schemes", "levels"}

// Page budget: rows per page and encoded row bytes per page. A page always
// holds at least one row while rows remain, so a single row above
// MaxPageBytes ships alone.
const (
	DefaultPageLimit = 500
	MaxPageLimit     = 2000
	MaxPageBytes     = 4 << 20
)

// PageRequest is one v2 pull request. A continuation carries only Page (the
// round's filters are inside it). Limit 0 is the default; Only nil (or
// empty) is every collection; Workspace 0 is none. Now is the server clock
// (zero: time.Now); tests set it.
type PageRequest struct {
	Since     string
	Page      string
	Limit     int
	Only      map[string]bool
	Workspace int64
	Now       time.Time
}

// Page is one answer. Collections holds every requested name as an encoded
// JSON array. Scope is set on a round's first page only.
type Page struct {
	Format      int                        `json:"format"`
	InstanceID  string                     `json:"instanceId"`
	Until       time.Time                  `json:"until"`
	Scope       *Scope                     `json:"scope"`
	Restarted   []string                   `json:"restarted"`
	Collections map[string]json.RawMessage `json:"collections"`
	More        bool                       `json:"more"`
	Next        *string                    `json:"next"`
	Cursor      *string                    `json:"cursor"`
}

// Scope is what a client needs at a round's start: every workspace of the
// caller (whatever workspace= says), the round's language set, and the ETag
// of the caller's default package catalogue.
type Scope struct {
	Workspaces []WorkspaceRef `json:"workspaces"`
	Languages  []string       `json:"languages"`
	Catalogue  string         `json:"catalogue"`
}

// WorkspaceRef is one workspace in a scope.
type WorkspaceRef struct {
	ID       int64  `json:"id"`
	Language string `json:"language"`
}

// CatalogueFunc returns the catalogue ETag for a language set.
type CatalogueFunc func(ctx context.Context, languages []string) (string, error)

// ParsePageRequest reads the v2 query parameters (v itself is the caller's
// business). A continuation (page) may repeat none of since, collections,
// workspace and limit.
func ParsePageRequest(q url.Values) (PageRequest, error) {
	if q.Has("page") {
		for _, name := range []string{"since", "collections", "workspace", "limit"} {
			if q.Has(name) {
				return PageRequest{}, fmt.Errorf("%w: a continuation repeats %s", ErrPageInvalid, name)
			}
		}
		if q.Get("page") == "" {
			return PageRequest{}, fmt.Errorf("%w: empty page", ErrPageInvalid)
		}
		return PageRequest{Page: q.Get("page")}, nil
	}
	req := PageRequest{Since: q.Get("since")}
	if q.Has("limit") {
		n, err := strconv.Atoi(q.Get("limit"))
		if err != nil || n < 1 || n > MaxPageLimit {
			return PageRequest{}, fmt.Errorf("%w: limit must be 1..%d", ErrPageInvalid, MaxPageLimit)
		}
		req.Limit = n
	}
	if list := strings.TrimSpace(q.Get("collections")); list != "" {
		names := strings.Split(list, ",")
		for i := range names {
			names[i] = strings.TrimSpace(names[i])
		}
		only, err := collectionSet(names, V2Collections)
		if err != nil {
			return PageRequest{}, err
		}
		req.Only = only
	}
	if q.Has("workspace") {
		id, err := strconv.ParseInt(q.Get("workspace"), 10, 64)
		if err != nil || id < 1 {
			return PageRequest{}, fmt.Errorf("%w: workspace must be an id", ErrPageInvalid)
		}
		req.Workspace = id
	}
	return req, nil
}

// collectionSet checks names against a round's collections: a moved
// lexicon name is ErrMoved, any other unknown name ErrPageInvalid.
func collectionSet(names, order []string) (map[string]bool, error) {
	for _, n := range names {
		if slices.Contains(MovedCollections, n) {
			return nil, fmt.Errorf("%w: %s (GET /api/packages)", ErrMoved, n)
		}
	}
	set := map[string]bool{}
	for _, n := range names {
		if !slices.Contains(order, n) {
			return nil, fmt.Errorf("%w: unknown collection %q", ErrPageInvalid, n)
		}
		set[n] = true
	}
	return set, nil
}

// scanner is *sql.Rows (or *sql.Row).
type scanner interface{ Scan(dest ...any) error }

// segment is one keyset walk of a collection over one table. A collection
// may have several (library rows, then their deletion log).
type segment struct {
	coll  string
	table string
	stamp string // the column paged over
	cols  string // the select list after rowid
	tomb  bool   // the table has deleted_at: live rows only without since
	log   bool   // a deletion log: walked only with since
	// extra is the WHERE fragment that narrows the segment; it may use ?7
	// (the workspace id, 0 for none) and ?8 (the language set, a JSON array).
	extra func(workspace int64) string
	// encode scans one row (rowid first, then cols) into its wire JSON.
	encode func(sc scanner) (stamp string, rowid int64, raw []byte, err error)
}

// roundSet is the collection set a round walks.
type roundSet struct {
	order       []string  // collection names, round order
	segs        []segment // segments, round order
	restartable []string  // collections restarted from no since when the language set changed
	// scope checks the workspace filter (ErrNotFound for a foreign or
	// unknown one) and returns the round's language set and the scope
	// (catalogue unset).
	scope func(ctx context.Context, q *sql.DB, userID, workspace int64) ([]string, Scope, error)
}

// keysetQuery is the scan of one segment page. The WHERE and ORDER BY shape
// is the one server/internal/db/migrate_039_test.go (keysetQuery) proves to
// run on an index without a sort: keep them in step.
func keysetQuery(cols, table, stamp, extra string) string {
	return fmt.Sprintf(`SELECT rowid, %[4]s FROM %[1]s
		WHERE user_id = ?1 AND %[2]s >= ?2 AND %[2]s < ?3%[3]s
		  AND (%[2]s > ?4 OR (%[2]s = ?4 AND rowid > ?5))
		ORDER BY %[2]s, rowid LIMIT ?6`, table, stamp, extra, cols)
}

// query is the segment's keyset scan for a round from since ("" = none:
// live rows only) under the workspace filter.
func (s segment) query(since string, workspace int64) string {
	extra := ""
	if s.extra != nil {
		extra = s.extra(workspace)
	}
	if s.tomb && since == "" {
		extra += " AND deleted_at IS NULL"
	}
	return keysetQuery(s.cols, s.table, s.stamp, extra)
}

// args binds query: ?1..?6 always, ?7 (workspace) and ?8 (languages as a
// JSON array) when the narrowing uses them.
func (s segment) args(query string, user int64, since, until string, from position, n int, workspace int64, languages []string) []any {
	args := []any{user, since, until, from.Stamp, from.RowID, n}
	if strings.Contains(query, "?8") {
		langs, _ := json.Marshal(languages)
		args = append(args, workspace, string(langs))
	} else if strings.Contains(query, "?7") {
		args = append(args, workspace)
	}
	return args
}

// pullPage answers one v2 request over set.
func pullPage(ctx context.Context, sqlDB *sql.DB, userID int64, req PageRequest, set roundSet, cat CatalogueFunc) (Page, error) {
	now := req.Now
	if now.IsZero() {
		now = time.Now()
	}
	var st pageToken
	var scope *Scope
	if req.Page != "" {
		if req.Since != "" || req.Only != nil || req.Workspace != 0 || req.Limit != 0 {
			return Page{}, fmt.Errorf("%w: a continuation repeats a filter", ErrPageInvalid)
		}
		var err error
		if st, err = decodePage(req.Page, userID, len(set.segs)); err != nil {
			return Page{}, err
		}
		if !isOrderedSubset(st.Filters.Collections, set.order) {
			return Page{}, fmt.Errorf("%w: token collections", ErrPageInvalid)
		}
		if _, _, err := set.scope(ctx, sqlDB, userID, st.Filters.Workspace); err != nil {
			return Page{}, err
		}
	} else {
		limit := req.Limit
		if limit == 0 {
			limit = DefaultPageLimit
		}
		if limit < 1 || limit > MaxPageLimit {
			return Page{}, fmt.Errorf("%w: limit must be 1..%d", ErrPageInvalid, MaxPageLimit)
		}
		if req.Workspace < 0 {
			return Page{}, fmt.Errorf("%w: workspace must be an id", ErrPageInvalid)
		}
		colls := slices.Clone(set.order)
		if len(req.Only) > 0 {
			only, err := collectionSet(mapKeys(req.Only), set.order)
			if err != nil {
				return Page{}, err
			}
			colls = slices.DeleteFunc(colls, func(c string) bool { return !only[c] })
		}
		f := filters{Collections: colls, Workspace: req.Workspace}
		var cur cursorToken
		if req.Since != "" {
			var err error
			if cur, err = decodeCursor(req.Since, userID, f); err != nil {
				return Page{}, err
			}
		}
		langs, sc, err := set.scope(ctx, sqlDB, userID, req.Workspace)
		if err != nil {
			return Page{}, err
		}
		if langs == nil {
			langs = []string{}
		}
		if cat != nil {
			if sc.Catalogue, err = cat(ctx, workspaceLanguages(sc.Workspaces)); err != nil {
				return Page{}, fmt.Errorf("sync pull: catalogue: %w", err)
			}
		}
		scope = &sc
		st = pageToken{User: userID, Since: cur.Time, Until: now.UTC().Truncate(time.Second).Format(time.RFC3339),
			Filters: f, Limit: limit, Languages: langs}
		st.Restarted = req.Since != "" && !slices.Equal(cur.Languages, langs)
	}

	page, err := walk(ctx, sqlDB, st, set)
	if err != nil {
		return Page{}, err
	}
	page.Scope = scope
	if err := sqlDB.QueryRowContext(ctx, `SELECT value FROM server_meta WHERE key = 'instance_id'`).Scan(&page.InstanceID); err != nil {
		return Page{}, fmt.Errorf("sync pull: instance id: %w", err)
	}
	return page, nil
}

// walk ships the rows of one page from st's position and sets more, next
// and cursor.
func walk(ctx context.Context, sqlDB *sql.DB, st pageToken, set roundSet) (Page, error) {
	until, _ := time.Parse(time.RFC3339, st.Until)
	page := Page{Format: 2, Until: until, Restarted: []string{}, Collections: map[string]json.RawMessage{}}
	requested := map[string]bool{}
	bufs := map[string]*bytes.Buffer{}
	for _, c := range st.Filters.Collections {
		requested[c] = true
		bufs[c] = bytes.NewBufferString("[")
		if st.Restarted && slices.Contains(set.restartable, c) {
			page.Restarted = append(page.Restarted, c)
		}
	}
	shipped, size := 0, 0
	pos := st.Pos
	more := false
	for seg := st.Pos.Seg; seg < len(set.segs) && !more; seg++ {
		s := set.segs[seg]
		if !requested[s.coll] {
			continue
		}
		since := st.Since
		if slices.Contains(page.Restarted, s.coll) {
			since = ""
		}
		if s.log && since == "" {
			continue
		}
		if seg != st.Pos.Seg {
			pos = position{Seg: seg}
		}
		query := s.query(since, st.Filters.Workspace)
		args := s.args(query, st.User, since, st.Until, pos, st.Limit-shipped+1, st.Filters.Workspace, st.Languages)
		stop, err := func() (bool, error) {
			rows, err := sqlDB.QueryContext(ctx, query, args...)
			if err != nil {
				return false, fmt.Errorf("sync pull %s: %w", s.coll, err)
			}
			defer rows.Close()
			buf := bufs[s.coll]
			for rows.Next() {
				stamp, rowid, raw, err := s.encode(rows)
				if err != nil {
					return false, fmt.Errorf("sync pull %s: %w", s.coll, err)
				}
				if shipped == st.Limit || (shipped > 0 && size+len(raw) > MaxPageBytes) {
					return true, nil
				}
				if buf.Len() > 1 {
					buf.WriteByte(',')
				}
				buf.Write(raw)
				shipped++
				size += len(raw)
				pos = position{Seg: seg, Stamp: stamp, RowID: rowid}
			}
			if err := rows.Err(); err != nil {
				return false, fmt.Errorf("sync pull %s: %w", s.coll, err)
			}
			return false, nil
		}()
		if err != nil {
			return Page{}, err
		}
		more = stop
	}
	for c, buf := range bufs {
		buf.WriteByte(']')
		page.Collections[c] = buf.Bytes()
	}
	page.More = more
	if more {
		nt := st
		nt.Pos = pos
		s := nt.encode()
		page.Next = &s
	} else {
		ct := cursorToken{User: st.User, Time: until.Add(-cursorMargin).Format(time.RFC3339), Filters: st.Filters, Languages: st.Languages}
		s := ct.encode()
		page.Cursor = &s
	}
	return page, nil
}

func mapKeys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	slices.Sort(out)
	return out
}

// isOrderedSubset reports whether list is a non-empty, duplicate-free
// subsequence of order.
func isOrderedSubset(list, order []string) bool {
	i := 0
	for _, c := range list {
		for i < len(order) && order[i] != c {
			i++
		}
		if i == len(order) {
			return false
		}
		i++
	}
	return len(list) > 0
}

// workspaceLanguages is the sorted language set of workspaces.
func workspaceLanguages(ws []WorkspaceRef) []string {
	out := []string{}
	for _, w := range ws {
		out = append(out, w.Language)
	}
	slices.Sort(out)
	return slices.Compact(out)
}
