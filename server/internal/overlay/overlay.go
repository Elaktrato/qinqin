// Package overlay stores per-user edits of shared dictionary entries:
// patches layered on the shared rows at read time, never written back
// to them, so re-importing the underlying dictionary pack never
// clobbers a user's edits.
package overlay

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"qinqin/internal/model"
)

// Put upserts user userID's patch of lexicon entry entryID, replacing any
// previous patch wholesale and stamping updated_at with the server
// clock — the LWW timestamp. Nil fields store NULL, which Apply reads
// as untouched: that field shows its shared value. An all-nil patch is a
// revert and deliberately keeps its row with a fresh updated_at: sync
// ships user_edits rows, so that row is how other devices learn to drop
// their copy of the old patch.
func Put(ctx context.Context, sqlDB *sql.DB, userID, entryID int64, patch model.EntryPatch) error {
	var written, readings any // nil args bind as NULL: the untouched case
	if patch.Written != nil {
		written = *patch.Written
	}
	if patch.Readings != nil {
		blob, err := json.Marshal(patch.Readings)
		if err != nil {
			return fmt.Errorf("put patch of user %d on entry %d: %w", userID, entryID, err)
		}
		readings = string(blob)
	}
	if _, err := sqlDB.ExecContext(ctx, `
		INSERT INTO user_edits (user_id, entry_id, written, readings, updated_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT (user_id, entry_id) DO UPDATE SET
			written = excluded.written,
			readings = excluded.readings,
			updated_at = excluded.updated_at`,
		userID, entryID, written, readings, now()); err != nil {
		return fmt.Errorf("put patch of user %d on entry %d: %w", userID, entryID, err)
	}
	return nil
}

// Apply mutates e — the response view of lexicon entry e.ID — in place
// per user userID's saved patch of it: a non-nil written form replaces
// e.Written, saved readings replace e.Readings exactly as stored — never
// re-derived. A user with no saved patch — or whose stored row holds
// only NULLs — leaves e unchanged. Only these two fields are patched:
// the rest of an entry response (forms, senses, sense groups) keeps the
// shared dictionary values.
func Apply(ctx context.Context, sqlDB *sql.DB, userID int64, e *model.EntryBase) error {
	var written, readings sql.NullString
	err := sqlDB.QueryRowContext(ctx, `
		SELECT written, readings FROM user_edits
		WHERE user_id = ? AND entry_id = ?`, userID, e.ID).
		Scan(&written, &readings)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("load patch of user %d on entry %d: %w", userID, e.ID, err)
	}
	if written.Valid {
		e.Written = written.String
	}
	if readings.Valid {
		var rs []model.Reading
		if err := json.Unmarshal([]byte(readings.String), &rs); err != nil {
			return fmt.Errorf("unmarshal readings of user %d on entry %d: %w", userID, e.ID, err)
		}
		e.Readings = rs
	}
	return nil
}

// Readings returns the saved readings of user userID's patches of the
// given entries, decoded exactly like Apply, keyed by entry id. Entries
// without a patch or whose patch leaves readings untouched are absent.
// One query per 500 ids.
func Readings(ctx context.Context, sqlDB *sql.DB, userID int64, ids []int64) (map[int64][]model.Reading, error) {
	out := map[int64][]model.Reading{}
	const chunk = 500
	for start := 0; start < len(ids); start += chunk {
		part := ids[start:min(start+chunk, len(ids))]
		args := make([]any, 0, len(part)+1)
		args = append(args, userID)
		marks := make([]byte, 0, 2*len(part))
		for i, id := range part {
			if i > 0 {
				marks = append(marks, ',')
			}
			marks = append(marks, '?')
			args = append(args, id)
		}
		rows, err := sqlDB.QueryContext(ctx, `
			SELECT entry_id, readings FROM user_edits
			WHERE user_id = ? AND readings IS NOT NULL AND entry_id IN (`+string(marks)+`)`, args...)
		if err != nil {
			return nil, fmt.Errorf("load readings of user %d: %w", userID, err)
		}
		for rows.Next() {
			var id int64
			var blob string
			if err := rows.Scan(&id, &blob); err != nil {
				rows.Close()
				return nil, fmt.Errorf("scan readings of user %d: %w", userID, err)
			}
			var rs []model.Reading
			if err := json.Unmarshal([]byte(blob), &rs); err != nil {
				rows.Close()
				return nil, fmt.Errorf("unmarshal readings of user %d on entry %d: %w", userID, id, err)
			}
			out[id] = rs
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, fmt.Errorf("load readings of user %d: %w", userID, err)
		}
	}
	return out, nil
}

// now returns the server clock as UTC RFC 3339, the timestamp
// convention for every write.
func now() string {
	return time.Now().UTC().Format(time.RFC3339)
}
