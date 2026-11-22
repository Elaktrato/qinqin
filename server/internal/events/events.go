// Package events stores study events: append-only, immutable rows keyed
// by the client-generated event id, so a retried batch counts its
// already-stored events as duplicates instead of failing. The one
// exception is DeleteLookups (the owner erasing their lookup events).
package events

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"qinqin/internal/model"

	"github.com/oklog/ulid/v2"
)

// ValidID reports whether id is a well-formed ULID — the form every
// client-generated event id takes. Anything else is rejected at the API
// door rather than stored.
func ValidID(id string) bool {
	_, err := ulid.ParseStrict(id)
	return err == nil
}

// Append inserts evts as new study_events rows inside one transaction,
// counting rows whose id already exists as duplicates — a retried batch
// is never an error. It returns how many events were stored and how
// many were duplicates. Events are immutable: nothing here updates them,
// and only DeleteLookups deletes (the "lookup" type, for privacy). Callers validate that each event's WorkspaceID belongs
// to its UserID; Append trusts its inputs.
func Append(ctx context.Context, sqlDB *sql.DB, evts []model.StudyEvent) (accepted, duplicates int, err error) {
	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return 0, 0, fmt.Errorf("append study events: %w", err)
	}
	defer tx.Rollback()

	stamp := now()
	for _, ev := range evts {
		// ON CONFLICT (id) DO NOTHING turns a retried id into a no-op
		// row: zero rows affected means the event was already stored.
		res, err := tx.ExecContext(ctx, `
			INSERT INTO study_events (id, user_id, workspace_id, device, ts, type, payload, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT (id) DO NOTHING`,
			ev.ID, ev.UserID, ev.WorkspaceID, ev.Device,
			ev.TS.UTC().Format(time.RFC3339), ev.Type, payloadOf(ev), stamp)
		if err != nil {
			return 0, 0, fmt.Errorf("append study event %s: %w", ev.ID, err)
		}
		n, err := res.RowsAffected()
		if err != nil {
			return 0, 0, fmt.Errorf("append study event %s: %w", ev.ID, err)
		}
		if n > 0 {
			accepted++
		} else {
			duplicates++
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, 0, fmt.Errorf("append study events: %w", err)
	}
	return accepted, duplicates, nil
}

// DeleteLookups deletes the user's events of type "lookup" in one
// workspace and returns how many rows it deleted. It is the only deletion
// of events (privacy, #72): nothing derives from lookup events (no activity
// rule, no replay) and older web clients stored free-text search queries in
// them. Callers check that the workspace is the user's; a workspace of
// another user matches no row anyway.
func DeleteLookups(ctx context.Context, sqlDB *sql.DB, userID, workspaceID int64) (int64, error) {
	res, err := sqlDB.ExecContext(ctx,
		`DELETE FROM study_events WHERE user_id = ? AND workspace_id = ? AND type = 'lookup'`,
		userID, workspaceID)
	if err != nil {
		return 0, fmt.Errorf("delete lookup events: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("delete lookup events: %w", err)
	}
	return n, nil
}

// Since returns the user's study events from since (inclusive) onward,
// in ts then id order. A nil workspaceID spans all the user's
// workspaces — the combined cross-language view; a non-nil one returns
// that workspace's events alone.
func Since(ctx context.Context, sqlDB *sql.DB, userID int64, since time.Time, workspaceID *int64) ([]model.StudyEvent, error) {
	// Timestamps are stored uniformly as UTC RFC 3339, so comparing the
	// text columns is chronological.
	query := `SELECT id, user_id, workspace_id, device, ts, type, payload
		FROM study_events
		WHERE user_id = ? AND ts >= ?`
	args := []any{userID, since.UTC().Format(time.RFC3339)}
	if workspaceID != nil {
		query += ` AND workspace_id = ?`
		args = append(args, *workspaceID)
	}
	query += ` ORDER BY ts, id`

	rows, err := sqlDB.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("read study events of user %d: %w", userID, err)
	}
	defer rows.Close()

	list := make([]model.StudyEvent, 0)
	for rows.Next() {
		ev, err := scanEvent(rows, userID)
		if err != nil {
			return nil, err
		}
		list = append(list, ev)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read study events of user %d: %w", userID, err)
	}
	return list, nil
}

// scanEvent reads one row of id, user_id, workspace_id, device, ts, type,
// payload (the select list of Since, ListPage and StreamSince).
func scanEvent(rows *sql.Rows, userID int64) (model.StudyEvent, error) {
	var (
		ev      model.StudyEvent
		ts      string
		payload string
	)
	if err := rows.Scan(&ev.ID, &ev.UserID, &ev.WorkspaceID, &ev.Device, &ts, &ev.Type, &payload); err != nil {
		return model.StudyEvent{}, fmt.Errorf("scan study event of user %d: %w", userID, err)
	}
	parsed, err := time.Parse(time.RFC3339, ts)
	if err != nil {
		return model.StudyEvent{}, fmt.Errorf("scan study event %s of user %d: %w", ev.ID, userID, err)
	}
	ev.TS = parsed
	ev.Payload = json.RawMessage(payload)
	return ev, nil
}

// payloadOf returns the event's payload as stored text, normalizing an
// absent payload to JSON null.
func payloadOf(ev model.StudyEvent) string {
	if len(ev.Payload) == 0 {
		return "null"
	}
	return string(ev.Payload)
}

// now returns the server clock as UTC RFC 3339, the timestamp
// convention for every write.
func now() string {
	return time.Now().UTC().Format(time.RFC3339)
}
