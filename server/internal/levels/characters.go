package levels

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

// LevelChars is one level of a scheme with the Han characters it holds,
// for the mastery map's scheme grouping.
type LevelChars struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Chars string `json:"chars"` // each character once, in order of first appearance
}

// SchemeCharacters returns the active levels of the scheme in level order,
// each with the Han characters of its active member entries' headwords
// (first written form): every character of a member word, and the
// characters derived from the words or listed by a character-unit scheme.
// A character belongs to the lowest level that holds it, the rule the
// importer derives badges by; a level whose characters all sit lower has
// an empty string. The iteration mark 々 and non-Han script are left out.
// A character-unit scheme contributes its character entries only. One
// query reads every member; an unknown or uninstalled scheme returns
// ErrNotFound.
func SchemeCharacters(ctx context.Context, sqlDB *sql.DB, schemeID int64) ([]LevelChars, error) {
	var unit string
	err := sqlDB.QueryRowContext(ctx, `
		SELECT unit FROM schemes WHERE id = ? AND deleted_at IS NULL`, schemeID).Scan(&unit)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("find scheme %d: %w", schemeID, err)
	}

	// Every active level with its active members' kind and headword;
	// a level without members yields one row of NULLs, so it is listed.
	rows, err := sqlDB.QueryContext(ctx, `
		SELECT l.id, l.name, e.kind,
			(SELECT f.text FROM forms f
				WHERE f.entry_id = e.id AND f.deleted_at IS NULL
				ORDER BY f.ord, f.id LIMIT 1)
		FROM levels l
		LEFT JOIN level_members m ON m.level_id = l.id AND m.deleted_at IS NULL
			AND EXISTS (SELECT 1 FROM entries x WHERE x.id = m.entry_id AND x.deleted_at IS NULL)
		LEFT JOIN entries e ON e.id = m.entry_id
		WHERE l.scheme_id = ? AND l.deleted_at IS NULL
		ORDER BY l.ord, l.id, m.id`, schemeID)
	if err != nil {
		return nil, fmt.Errorf("characters of scheme %d: %w", schemeID, err)
	}
	defer rows.Close()

	out := make([]LevelChars, 0)
	var (
		sb   strings.Builder
		seen = map[rune]bool{}
	)
	flush := func() {
		if len(out) > 0 {
			out[len(out)-1].Chars = sb.String()
		}
		sb.Reset()
	}
	for rows.Next() {
		var (
			levelID    int64
			name       string
			kind, head sql.NullString
		)
		if err := rows.Scan(&levelID, &name, &kind, &head); err != nil {
			return nil, fmt.Errorf("characters of scheme %d: %w", schemeID, err)
		}
		if len(out) == 0 || out[len(out)-1].ID != levelID {
			flush()
			out = append(out, LevelChars{ID: levelID, Name: name})
		}
		if !head.Valid || (unit == UnitCharacter && kind.String != UnitCharacter) {
			continue
		}
		for _, r := range distinctHan(head.String) {
			if !seen[r] {
				seen[r] = true
				sb.WriteRune(r)
			}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("characters of scheme %d: %w", schemeID, err)
	}
	flush()
	return out, nil
}

// SchemeVersion returns a validator of what SchemeCharacters serves for
// the scheme: the latest stamp over its levels and memberships (a
// tombstone stamps too) and its active level and member counts. An
// identical re-import writes none of those rows, so the version holds;
// the scheme row's own stamp, which every import renews, is left out. An
// unknown or uninstalled scheme returns ErrNotFound.
func SchemeVersion(ctx context.Context, sqlDB *sql.DB, schemeID int64) (string, error) {
	var (
		exists            int
		levelStamp        sql.NullString
		memberStamp       sql.NullString
		nLevels, nMembers int64
	)
	err := sqlDB.QueryRowContext(ctx, `
		SELECT 1 FROM schemes WHERE id = ? AND deleted_at IS NULL`, schemeID).Scan(&exists)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("find scheme %d: %w", schemeID, err)
	}
	if err := sqlDB.QueryRowContext(ctx, `
		SELECT
			(SELECT MAX(updated_at) FROM levels WHERE scheme_id = ?1),
			(SELECT COUNT(*) FROM levels WHERE scheme_id = ?1 AND deleted_at IS NULL),
			(SELECT MAX(m.updated_at) FROM level_members m
				JOIN levels l ON l.id = m.level_id WHERE l.scheme_id = ?1),
			(SELECT COUNT(*) FROM level_members m
				JOIN levels l ON l.id = m.level_id
				WHERE l.scheme_id = ?1 AND m.deleted_at IS NULL)`,
		schemeID).Scan(&levelStamp, &nLevels, &memberStamp, &nMembers); err != nil {
		return "", fmt.Errorf("version of scheme %d: %w", schemeID, err)
	}
	return fmt.Sprintf("%s|%d|%s|%d", levelStamp.String, nLevels, memberStamp.String, nMembers), nil
}
