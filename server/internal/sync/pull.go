package sync

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"qinqin/internal/model"
)

// parseTS parses a stored RFC 3339 timestamp.
func parseTS(s string) (time.Time, error) {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return time.Time{}, fmt.Errorf("sync: parse timestamp %q: %w", s, err)
	}
	return t, nil
}

// parseDeleted parses an optional stored deleted_at.
func parseDeleted(s sql.NullString) (*time.Time, error) {
	if !s.Valid {
		return nil, nil
	}
	t, err := parseTS(s.String)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// The pull helpers take live, an extra WHERE fragment — " AND deleted_at
// IS NULL" for a pull from the zero cursor, empty otherwise.

func pullLinks(ctx context.Context, sqlDB *sql.DB, since, live string) ([]Link, error) {
	rows, err := sqlDB.QueryContext(ctx, `
		SELECT from_id, to_id, type, updated_at, deleted_at FROM entry_links
		WHERE updated_at >= ?`+live+` ORDER BY from_id, to_id, type`, since)
	if err != nil {
		return nil, fmt.Errorf("sync pull links: %w", err)
	}
	defer rows.Close()
	list := make([]Link, 0)
	for rows.Next() {
		var l Link
		var updated string
		var deleted sql.NullString
		if err := rows.Scan(&l.FromID, &l.ToID, &l.Type, &updated, &deleted); err != nil {
			return nil, fmt.Errorf("sync pull links: %w", err)
		}
		if l.UpdatedAt, err = parseTS(updated); err != nil {
			return nil, err
		}
		if l.DeletedAt, err = parseDeleted(deleted); err != nil {
			return nil, err
		}
		list = append(list, l)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("sync pull links: %w", err)
	}
	return list, nil
}

func pullSenses(ctx context.Context, sqlDB *sql.DB, since, live string) ([]model.Sense, error) {
	rows, err := sqlDB.QueryContext(ctx, `
		SELECT id, dictionary_id, entry_id, gloss, ord, updated_at, deleted_at FROM senses
		WHERE updated_at >= ?`+live+` ORDER BY id`, since)
	if err != nil {
		return nil, fmt.Errorf("sync pull senses: %w", err)
	}
	defer rows.Close()
	list := make([]model.Sense, 0)
	for rows.Next() {
		var s model.Sense
		var updated string
		var deleted sql.NullString
		if err := rows.Scan(&s.ID, &s.DictionaryID, &s.EntryID, &s.Gloss, &s.Ord, &updated, &deleted); err != nil {
			return nil, fmt.Errorf("sync pull senses: %w", err)
		}
		if s.UpdatedAt, err = parseTS(updated); err != nil {
			return nil, err
		}
		if s.DeletedAt, err = parseDeleted(deleted); err != nil {
			return nil, err
		}
		list = append(list, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("sync pull senses: %w", err)
	}
	return list, nil
}

func pullLevelMembers(ctx context.Context, sqlDB *sql.DB, since, live string) ([]LevelMember, error) {
	rows, err := sqlDB.QueryContext(ctx, `
		SELECT id, level_id, entry_id, derived, updated_at, deleted_at FROM level_members
		WHERE updated_at >= ?`+live+` ORDER BY id`, since)
	if err != nil {
		return nil, fmt.Errorf("sync pull level members: %w", err)
	}
	defer rows.Close()
	list := make([]LevelMember, 0)
	for rows.Next() {
		var m LevelMember
		var derived int
		var updated string
		var deleted sql.NullString
		if err := rows.Scan(&m.ID, &m.LevelID, &m.EntryID, &derived, &updated, &deleted); err != nil {
			return nil, fmt.Errorf("sync pull level members: %w", err)
		}
		m.Derived = derived != 0
		if m.UpdatedAt, err = parseTS(updated); err != nil {
			return nil, err
		}
		if m.DeletedAt, err = parseDeleted(deleted); err != nil {
			return nil, err
		}
		list = append(list, m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("sync pull level members: %w", err)
	}
	return list, nil
}

// pullSentences returns the changed pack sentences and the caller's own;
// other users' sentences never leave the server.
func pullSentences(ctx context.Context, sqlDB *sql.DB, userID int64, since, live string) ([]model.Sentence, error) {
	rows, err := sqlDB.QueryContext(ctx, `
		SELECT id, entry_id, source_pack, user_id, hanzi, pinyin, translation, updated_at, deleted_at
		FROM sentences
		WHERE updated_at >= ?`+live+` AND (user_id IS NULL OR user_id = ?) ORDER BY id`, since, userID)
	if err != nil {
		return nil, fmt.Errorf("sync pull sentences: %w", err)
	}
	defer rows.Close()
	list := make([]model.Sentence, 0)
	for rows.Next() {
		var s model.Sentence
		var owner sql.NullInt64
		var updated string
		var deleted sql.NullString
		if err := rows.Scan(&s.ID, &s.EntryID, &s.SourcePack, &owner, &s.Hanzi, &s.Pinyin, &s.Translation, &updated, &deleted); err != nil {
			return nil, fmt.Errorf("sync pull sentences: %w", err)
		}
		if owner.Valid {
			id := owner.Int64
			s.UserID = &id
		}
		if s.UpdatedAt, err = parseTS(updated); err != nil {
			return nil, err
		}
		if s.DeletedAt, err = parseDeleted(deleted); err != nil {
			return nil, err
		}
		list = append(list, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("sync pull sentences: %w", err)
	}
	return list, nil
}

// pullOverlays returns the caller's changed entry overlays; other users'
// edits never leave the server.
func pullOverlays(ctx context.Context, sqlDB *sql.DB, userID int64, since string) ([]Overlay, error) {
	rows, err := sqlDB.QueryContext(ctx, `
		SELECT entry_id, written, readings, updated_at FROM user_edits
		WHERE user_id = ? AND updated_at >= ? ORDER BY entry_id`, userID, since)
	if err != nil {
		return nil, fmt.Errorf("sync pull overlays: %w", err)
	}
	defer rows.Close()
	list := make([]Overlay, 0)
	for rows.Next() {
		var o Overlay
		var written, readings sql.NullString
		var updated string
		if err := rows.Scan(&o.EntryID, &written, &readings, &updated); err != nil {
			return nil, fmt.Errorf("sync pull overlays: %w", err)
		}
		if written.Valid {
			w := written.String
			o.Written = &w
		}
		if readings.Valid {
			if err := json.Unmarshal([]byte(readings.String), &o.Readings); err != nil {
				return nil, fmt.Errorf("sync pull overlays: readings of entry %d: %w", o.EntryID, err)
			}
		}
		if o.UpdatedAt, err = parseTS(updated); err != nil {
			return nil, err
		}
		list = append(list, o)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("sync pull overlays: %w", err)
	}
	return list, nil
}

func pullPluginStates(ctx context.Context, sqlDB *sql.DB, userID int64, since string) ([]model.PluginState, error) {
	rows, err := sqlDB.QueryContext(ctx, `
		SELECT pack_id, user_id, enabled, ord, updated_at FROM plugin_states
		WHERE user_id = ? AND updated_at >= ? ORDER BY pack_id`, userID, since)
	if err != nil {
		return nil, fmt.Errorf("sync pull plugin states: %w", err)
	}
	defer rows.Close()
	list := make([]model.PluginState, 0)
	for rows.Next() {
		var s model.PluginState
		var enabled int
		var updated string
		if err := rows.Scan(&s.PluginID, &s.UserID, &enabled, &s.Order, &updated); err != nil {
			return nil, fmt.Errorf("sync pull plugin states: %w", err)
		}
		s.Enabled = enabled != 0
		if s.UpdatedAt, err = parseTS(updated); err != nil {
			return nil, err
		}
		list = append(list, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("sync pull plugin states: %w", err)
	}
	return list, nil
}
