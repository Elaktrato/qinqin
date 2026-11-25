package levels

import (
	"context"
	"database/sql"
	"fmt"

	"qinqin/internal/pack"
)

// Level is one levels scheme's level of an entry: the scheme's name and the
// lowest level of that scheme the entry belongs to — the entry page's badge
// rule (ForEntry), one per scheme.
type Level struct {
	SchemeName string
	LevelName  string
}

// LowestPerScheme returns the levels of each entry id, in scheme order, from
// ONE query over all of them; an entry in no active scheme maps to nothing
// (callers turn that into an empty slice). Lookup and search share it.
func LowestPerScheme(ctx context.Context, db *sql.DB, ids []int64) (map[int64][]Level, error) {
	out := map[int64][]Level{}
	if len(ids) == 0 {
		return out, nil
	}
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	// The importer keeps one membership per entry and scheme (at its lowest
	// level); the MIN over the level order keeps that rule here too should a
	// scheme ever hold two. The level name is taken from the row holding the
	// minimum (SQLite's bare-column rule for MIN).
	rows, err := db.QueryContext(ctx, `
		SELECT m.entry_id, s.name, l.name, MIN(l.ord)
		FROM level_members m
		JOIN levels l ON l.id = m.level_id AND l.deleted_at IS NULL
		JOIN schemes s ON s.id = l.scheme_id AND s.deleted_at IS NULL
		WHERE m.deleted_at IS NULL AND m.entry_id IN (`+pack.Placeholders(len(ids))+`)
		GROUP BY m.entry_id, s.id
		ORDER BY m.entry_id, s.id`, args...)
	if err != nil {
		return nil, fmt.Errorf("levels: lowest per scheme: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			id           int64
			scheme, name string
			ord          int
		)
		if err := rows.Scan(&id, &scheme, &name, &ord); err != nil {
			return nil, fmt.Errorf("levels: lowest per scheme: %w", err)
		}
		out[id] = append(out[id], Level{SchemeName: scheme, LevelName: name})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("levels: lowest per scheme: %w", err)
	}
	return out, nil
}
