package lexicon

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"

	"qinqin/internal/lang"
)

// defaultSearchLimit caps a search whose query sets no Limit.
const defaultSearchLimit = 50

// maxSearchLimit caps any requested Limit: search is a public route, and
// every hit loads its entry.
const maxSearchLimit = 200

// ErrInvalidQuery reports a search query that cannot be run: no language,
// or a level name without a scheme.
var ErrInvalidQuery = errors.New("invalid search query")

// SearchQuery is one language-scoped lexicon search.
type SearchQuery struct {
	Text string
	// Lang is the language code candidates are scoped to; required.
	Lang string
	// Kind optionally narrows candidates to "character" or "word".
	Kind string
	// SchemeID is the manifest id (pack id) of a level scheme, e.g.
	// "hsk-mini". With LevelName it narrows candidates to that level's
	// members; alone it narrows them to any level of the scheme.
	SchemeID  string
	LevelName string
	// Limit caps the hits returned; 0 means 50, and at most 200 are
	// returned.
	Limit int
}

// SearchHit is one search result: the matching entry, fully loaded, and
// why it matched. Source is "written" (a form matched), "gloss", or the
// type of the matching reading ("pinyin", "bopomofo", "kana", ...).
type SearchHit struct {
	Entry  Entry
	Source string
}

// rankOrder orders one tier's entries: usually-kana entries that carry a
// priority first, then priority (higher first), then entry id — the
// order Best uses.
const rankOrder = ` ORDER BY (e.uk = 1 AND e.pri > 0) DESC, e.pri DESC, e.id`

// Search returns the entries matching q.Text, best match first. Candidates
// are scoped to q.Lang (and Kind and the scheme level, when set) before
// any text matching. Matches rank in tiers — exact form; exact plain
// reading; plain-reading prefix (bopomofo excluded); bopomofo prefix;
// gloss substring over active senses of active dictionaries — and within
// a tier by rank (see rankOrder). An entry appears once, at its best
// tier, with Source naming that match. The query text normalizes through
// the language pack's SearchPlain, so zh matches toneless pinyin and ja
// accepts romaji or kana; the bopomofo tier matches the lowercased query
// as typed, since bopomofo plain forms are the reading itself.
func (s Store) Search(ctx context.Context, q SearchQuery) ([]SearchHit, error) {
	text := strings.TrimSpace(q.Text)
	q.Lang = strings.ToLower(q.Lang)
	if q.Lang == "" {
		return nil, fmt.Errorf("%w: language required", ErrInvalidQuery)
	}
	if q.LevelName != "" && q.SchemeID == "" {
		return nil, fmt.Errorf("%w: level %q needs a scheme", ErrInvalidQuery, q.LevelName)
	}
	if text == "" {
		return []SearchHit{}, nil
	}
	limit := q.Limit
	if limit <= 0 {
		limit = defaultSearchLimit
	}
	limit = min(limit, maxSearchLimit)

	var (
		order  []int64
		source = map[int64]string{}
	)
	for _, t := range searchTiers(q, text) {
		if len(order) >= limit {
			break
		}
		// At most limit new ids can be needed, plus those already
		// collected by earlier tiers that this tier may repeat.
		rows, err := s.DB.QueryContext(ctx, t.query+` LIMIT ?`, append(t.args, limit+len(order))...)
		if err != nil {
			return nil, fmt.Errorf("search %q: %w", text, err)
		}
		err = eachRow(rows, func() error {
			var (
				id  int64
				src string
			)
			if err := rows.Scan(&id, &src); err != nil {
				return err
			}
			if _, seen := source[id]; !seen && len(order) < limit {
				source[id] = src
				order = append(order, id)
			}
			return nil
		})
		if err != nil {
			return nil, fmt.Errorf("search %q: %w", text, err)
		}
	}

	found, err := s.GetMany(ctx, order)
	if err != nil {
		return nil, fmt.Errorf("search %q: %w", text, err)
	}
	hits := make([]SearchHit, 0, len(found))
	for _, e := range found {
		hits = append(hits, SearchHit{Entry: e, Source: source[e.ID]})
	}
	return hits, nil
}

// searchTier is one ranked match query selecting (entry id, source),
// ordered best first; Search appends the LIMIT.
type searchTier struct {
	query string
	args  []any
}

// searchTiers builds the tier queries of a validated query whose trimmed
// text is text. The form and reading tiers are driven from the
// forms / readings text indexes: CROSS JOIN fixes the child table
// as the outer loop so the planner cannot switch to scanning every entry
// of the language (see byFormQuery). The gloss tier is a substring match
// and so a scan; it walks the language's entries and their senses by
// index.
func searchTiers(q SearchQuery, text string) []searchTier {
	filter, base := candidateFilter(q)
	with := func(args ...any) []any {
		return append(slices.Clone(args), base...)
	}
	readingTier := func(cond string, args ...any) searchTier {
		return searchTier{
			query: `SELECT e.id, MIN(r.type) FROM readings r
				CROSS JOIN entries e ON e.id = r.entry_id
				WHERE ` + cond + ` AND r.deleted_at IS NULL` + filter + `
				GROUP BY e.id` + rankOrder,
			args: with(args...),
		}
	}

	tiers := []searchTier{{
		query: `SELECT e.id, 'written' FROM forms f
			CROSS JOIN entries e ON e.id = f.entry_id
			WHERE f.text = ? AND f.deleted_at IS NULL` + filter + `
			GROUP BY e.id` + rankOrder,
		args: with(text),
	}}
	if plain := lang.For(q.Lang).SearchPlain(text); plain != "" {
		lo, hi := prefixRange(plain)
		tiers = append(tiers,
			readingTier(`r.plain = ?`, plain),
			readingTier(`r.plain >= ? AND r.plain < ? AND r.type != 'bopomofo'`, lo, hi),
		)
	}
	lo, hi := prefixRange(strings.ToLower(text))
	tiers = append(tiers,
		readingTier(`r.plain >= ? AND r.plain < ? AND r.type = 'bopomofo'`, lo, hi),
		glossTier(filter, with, text),
	)
	return tiers
}

// glossTier matches text as a substring of any gloss of an active sense
// of an active dictionary. Glosses are stored as a JSON array, so the
// cheap LIKE over the column text (with text JSON-escaped the way the
// column stores it) prefilters, and json_each confirms the match lies
// within one gloss, not across the array's punctuation.
func glossTier(filter string, with func(...any) []any, text string) searchTier {
	encoded, _ := json.Marshal(text) // a string always marshals
	inColumn := "%" + likeEscape(string(encoded[1:len(encoded)-1])) + "%"
	inGloss := "%" + likeEscape(text) + "%"
	return searchTier{
		query: `SELECT e.id, 'gloss' FROM entries e
			JOIN senses s ON s.entry_id = e.id AND s.deleted_at IS NULL
			JOIN dictionaries d ON d.id = s.dictionary_id AND d.deleted_at IS NULL
			WHERE s.glosses LIKE ? ESCAPE '\'
			  AND EXISTS (SELECT 1 FROM json_each(s.glosses) g WHERE g.value LIKE ? ESCAPE '\')` + filter + `
			GROUP BY e.id` + rankOrder,
		args: with(inColumn, inGloss),
	}
}

// candidateFilter returns the conditions (each starting with AND, over
// alias e) and their arguments that scope candidates to q's language,
// kind, and scheme level, excluding soft-deleted entries.
func candidateFilter(q SearchQuery) (string, []any) {
	where := ` AND e.language = ? AND e.deleted_at IS NULL`
	args := []any{q.Lang}
	if q.Kind != "" {
		where += ` AND e.kind = ?`
		args = append(args, q.Kind)
	}
	if q.SchemeID != "" {
		where += ` AND e.id IN (
			SELECT m.entry_id FROM level_members m
			JOIN levels l ON l.id = m.level_id AND l.deleted_at IS NULL
			JOIN schemes sc ON sc.id = l.scheme_id AND sc.deleted_at IS NULL
			WHERE m.deleted_at IS NULL AND sc.pack_id = ?`
		args = append(args, q.SchemeID)
		if q.LevelName != "" {
			where += ` AND l.name = ?`
			args = append(args, q.LevelName)
		}
		where += `)`
	}
	return where, args
}

// prefixRange returns the half-open text range [lo, hi) holding every
// string that starts with prefix, so a prefix match can seek an index
// (LIKE with ESCAPE cannot). U+10FFFF is the greatest code point, so
// prefix followed by it bounds all the prefix's extensions.
func prefixRange(prefix string) (lo, hi string) {
	return prefix, prefix + "\U0010FFFF"
}

// likeEscape escapes LIKE wildcards in s for use with ESCAPE '\'.
func likeEscape(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}

// CharsUnder returns the active entries linked to the radical entry
// radicalID by a radical link (from the character to the radical), fully
// loaded, ordered by headword (first form, else first reading) then id.
// It returns a non-nil (possibly empty) slice.
func (s Store) CharsUnder(ctx context.Context, radicalID int64) ([]Entry, error) {
	ids, err := queryIDs(ctx, s.DB, `
		SELECT from_id FROM entry_links
		WHERE to_id = ? AND type = 'radical' AND deleted_at IS NULL
		ORDER BY from_id`, radicalID)
	if err != nil {
		return nil, fmt.Errorf("characters under %d: %w", radicalID, err)
	}
	es, err := s.GetMany(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("characters under %d: %w", radicalID, err)
	}
	slices.SortStableFunc(es, func(a, b Entry) int {
		return strings.Compare(a.Headword(), b.Headword())
	})
	return es, nil
}

// Radicals returns, for each of ids that has an active radical link to
// an active entry, the id of that radical entry; a character with several
// gets the lowest id. Ids without one are absent.
func (s Store) Radicals(ctx context.Context, ids []int64) (map[int64]int64, error) {
	out := make(map[int64]int64)
	for start := 0; start < len(ids); start += childChunk {
		chunk := ids[start:min(start+childChunk, len(ids))]
		args := make([]any, len(chunk))
		for i, id := range chunk {
			args[i] = id
		}
		rows, err := s.DB.QueryContext(ctx, `
			SELECT l.from_id, MIN(l.to_id) FROM entry_links l
			JOIN entries r ON r.id = l.to_id AND r.deleted_at IS NULL
			WHERE l.from_id IN (`+placeholders(len(chunk))+`)
			  AND l.type = 'radical' AND l.deleted_at IS NULL
			GROUP BY l.from_id`, args...)
		if err != nil {
			return nil, fmt.Errorf("radicals: %w", err)
		}
		err = eachRow(rows, func() error {
			var from, to int64
			if err := rows.Scan(&from, &to); err != nil {
				return err
			}
			out[from] = to
			return nil
		})
		if err != nil {
			return nil, fmt.Errorf("radicals: %w", err)
		}
	}
	return out, nil
}
