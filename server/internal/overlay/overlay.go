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
// as untouched: that field shows its shared value.
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

// now returns the server clock as UTC RFC 3339, the timestamp
// convention for every write.
func now() string {
	return time.Now().UTC().Format(time.RFC3339)
}
