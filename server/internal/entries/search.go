package entries

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"qinqin/internal/lang"
	"qinqin/internal/model"
)

// defaultSearchLimit caps a search whose query sets no Limit.
const defaultSearchLimit = 50

// maxSearchLimit caps any requested Limit: search is a public route, and
// every hit loads its entry.
const maxSearchLimit = 200

// ErrInvalidQuery reports a search query that cannot be run: no language,
// or a level name without a scheme.
var ErrInvalidQuery = errors.New("invalid search query")

// SearchQuery is one language-scoped entry search.
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
	// Limit caps the hits returned; 0 means 50.
	Limit int
}

// Search returns the entries matching q.Text, best match first. Candidates
// are scoped to q.Lang (and Kind and the scheme level, when set) before
// any text matching. Matches rank in tiers — exact written form; exact
// plain reading; plain-reading prefix; bopomofo prefix; gloss substring
// over active senses — and an entry appears once, at its best tier, with
// Source naming that match: "written", "gloss", or the matching reading's
// type ("pinyin", "bopomofo", "kana", ...). The query text normalizes
// through the language pack's SearchPlain, so zh matches toneless pinyin
// and ja accepts romaji or kana.
func (s Store) Search(ctx context.Context, q SearchQuery) ([]model.SearchHit, error) {
	text := strings.TrimSpace(q.Text)
	if q.Lang == "" {
		return nil, fmt.Errorf("%w: language required", ErrInvalidQuery)
	}
	if q.LevelName != "" && q.SchemeID == "" {
		return nil, fmt.Errorf("%w: level %q needs a scheme", ErrInvalidQuery, q.LevelName)
	}
	if text == "" {
		return []model.SearchHit{}, nil
	}
	limit := q.Limit
	if limit <= 0 {
		limit = defaultSearchLimit
	}
	limit = min(limit, maxSearchLimit)

	where, base := candidateFilter(q)
	plain := lang.For(q.Lang).SearchPlain(text)
	tiers := []searchTier{
		{`SELECT DISTINCT e.id, 'written' FROM entries e` + where + ` AND e.written = ?`,
			append(base[:len(base):len(base)], text)},
	}
	if plain != "" {
		tiers = append(tiers,
			searchTier{`SELECT DISTINCT e.id, r.type FROM entries e JOIN readings r ON r.entry_id = e.id` +
				where + ` AND r.deleted_at IS NULL AND r.plain = ?`,
				append(base[:len(base):len(base)], plain)},
			searchTier{`SELECT DISTINCT e.id, r.type FROM entries e JOIN readings r ON r.entry_id = e.id` +
				where + ` AND r.deleted_at IS NULL AND r.type != 'bopomofo' AND r.plain LIKE ? ESCAPE '\'`,
				append(base[:len(base):len(base)], likeEscape(plain)+"%")},
		)
	}
	// Bopomofo plain forms are the stored reading itself, so the prefix
	// tier matches the lowercased query as typed, not its SearchPlain form.
	tiers = append(tiers,
		searchTier{`SELECT DISTINCT e.id, r.type FROM entries e JOIN readings r ON r.entry_id = e.id` +
			where + ` AND r.deleted_at IS NULL AND r.type = 'bopomofo' AND r.plain LIKE ? ESCAPE '\'`,
			append(base[:len(base):len(base)], likeEscape(strings.ToLower(text))+"%")},
		searchTier{`SELECT DISTINCT e.id, 'gloss' FROM entries e` +
			` JOIN senses sn ON sn.entry_id = e.id AND sn.deleted_at IS NULL` +
			` JOIN dictionaries d ON d.id = sn.dictionary_id AND d.deleted_at IS NULL` +
			where + ` AND sn.gloss LIKE ? ESCAPE '\'`,
			append(base[:len(base):len(base)], "%"+likeEscape(text)+"%")},
	)

	var order []int64
	source := map[int64]string{}
	for _, t := range tiers {
		if len(order) >= limit {
			break
		}
		// At most limit new ids can be needed, plus those already
		// collected by earlier tiers that this tier may repeat.
		rows, err := s.DB.QueryContext(ctx, t.query+` ORDER BY e.id LIMIT ?`,
			append(t.args[:len(t.args):len(t.args)], limit+len(order))...)
		if err != nil {
			return nil, fmt.Errorf("search %q: %w", text, err)
		}
		for rows.Next() {
			var id int64
			var src string
			if err := rows.Scan(&id, &src); err != nil {
				rows.Close()
				return nil, fmt.Errorf("search %q: %w", text, err)
			}
			if _, seen := source[id]; !seen && len(order) < limit {
				source[id] = src
				order = append(order, id)
			}
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, fmt.Errorf("search %q: %w", text, err)
		}
	}

	hits := make([]model.SearchHit, 0, len(order))
	if len(order) == 0 {
		return hits, nil
	}
	marks := strings.TrimSuffix(strings.Repeat("?,", len(order)), ",")
	args := make([]any, len(order))
	for i, id := range order {
		args[i] = id
	}
	found, err := s.listEntries(ctx, entrySelect+` WHERE e.id IN (`+marks+`)`, args...)
	if err != nil {
		return nil, fmt.Errorf("search %q: load hits: %w", text, err)
	}
	byID := make(map[int64]model.Entry, len(found))
	for _, e := range found {
		byID[e.ID] = e
	}
	for _, id := range order {
		hits = append(hits, model.SearchHit{Entry: byID[id], Source: source[id]})
	}
	return hits, nil
}

// searchTier is one ranked match query: it selects (entry id, source).
type searchTier struct {
	query string
	args  []any
}

// candidateFilter returns the WHERE clause (starting at "WHERE", over
// alias e) and its arguments that scope candidates to q's language, kind,
// and scheme level, excluding soft-deleted entries.
func candidateFilter(q SearchQuery) (string, []any) {
	where := ` WHERE e.language = ? AND e.deleted_at IS NULL`
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

// likeEscape escapes LIKE wildcards in s for use with ESCAPE '\'.
func likeEscape(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}
