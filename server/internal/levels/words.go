package levels

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// LevelEntries is one level of a scheme with the entries it lists, in membership order.
type LevelEntries struct {
	Name     string
	EntryIDs []int64
}

// Words is a word scheme's levels with their listed members (derived characters left out) and the scheme's
// version (SchemeVersion), for the course fill rule (#221).
type Words struct {
	SchemeID int64
	Version  string
	Levels   []LevelEntries
}

// SchemeWords returns the live word scheme with pack id packID of the language. An unknown, uninstalled,
// character-unit or other-language scheme returns ErrNotFound.
func SchemeWords(ctx context.Context, sqlDB *sql.DB, packID, language string) (Words, error) {
	var (
		w   Words
		err error
	)
	if w.SchemeID, w.Version, err = WordSchemeVersion(ctx, sqlDB, packID, language); err != nil {
		return Words{}, err
	}
	rows, err := sqlDB.QueryContext(ctx, `
		SELECT l.ord, l.name, m.entry_id
		FROM levels l LEFT JOIN level_members m ON m.level_id = l.id AND m.deleted_at IS NULL AND m.derived = 0
		WHERE l.scheme_id = ? AND l.deleted_at IS NULL
		ORDER BY l.ord, m.id`, w.SchemeID)
	if err != nil {
		return Words{}, fmt.Errorf("words of scheme %s: %w", packID, err)
	}
	defer rows.Close()
	last := -1
	for rows.Next() {
		var (
			ord   int
			name  string
			entry sql.NullInt64
		)
		if err := rows.Scan(&ord, &name, &entry); err != nil {
			return Words{}, fmt.Errorf("words of scheme %s: %w", packID, err)
		}
		if ord != last {
			w.Levels = append(w.Levels, LevelEntries{Name: name, EntryIDs: []int64{}})
			last = ord
		}
		if entry.Valid {
			l := &w.Levels[len(w.Levels)-1]
			l.EntryIDs = append(l.EntryIDs, entry.Int64)
		}
	}
	if err := rows.Err(); err != nil {
		return Words{}, fmt.Errorf("words of scheme %s: %w", packID, err)
	}
	return w, nil
}

// WordSchemeVersion returns the id and SchemeVersion of the live word scheme with pack id packID of the language,
// without its members (a cache's cheap check); ErrNotFound as SchemeWords.
func WordSchemeVersion(ctx context.Context, sqlDB *sql.DB, packID, language string) (int64, string, error) {
	var id int64
	err := sqlDB.QueryRowContext(ctx, `SELECT id FROM schemes
		WHERE pack_id = ? AND language = ? AND unit = 'word' AND deleted_at IS NULL`, packID, language).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, "", ErrNotFound
	}
	if err != nil {
		return 0, "", fmt.Errorf("find scheme %s: %w", packID, err)
	}
	version, err := SchemeVersion(ctx, sqlDB, id)
	return id, version, err
}
