// Package sync is the delta sync between the server and its clients: a
// pull that ships every row changed since a cursor — tombstones included,
// so deletions reach clients — and a push that applies a client's
// offline work: study events (idempotent by ULID), keyed rows and typed
// study rows (last-write-wins on the edit time).
//
// Timestamps are second-truncated server clock, so pulls are inclusive
// of the cursor second: a row written in the same second as the cursor
// is shipped again rather than risk being missed. Clients upsert by
// primary key, so the redelivery is harmless.
package sync

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"qinqin/internal/events"
	"qinqin/internal/keyed"
	"qinqin/internal/model"
	"qinqin/internal/study"
	"qinqin/internal/study/rows"
)

var (
	// ErrNotFound reports a push referencing a workspace the caller does
	// not own. Unknown and foreign workspaces are indistinguishable by design.
	ErrNotFound = errors.New("sync: not found")
	// ErrInvalid reports a malformed push item.
	ErrInvalid = errors.New("sync: invalid")
	// ErrStoredUnreadable reports a push item whose stored row this server
	// cannot read back (study.ErrUnreadableStored): the push is refused
	// whole, before anything applies, and the stored row is kept as it is.
	ErrStoredUnreadable = errors.New("sync: stored row unreadable")
)

// Overlay is one of the caller's per-user entry edits (user_edits row):
// nil Written and nil Readings are untouched fields, as in
// model.EntryPatch.
type Overlay struct {
	EntryID   int64           `json:"entryId"`
	Written   *string         `json:"written"`
	Readings  []model.Reading `json:"readings"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

// cursorMargin is how far a pull's returned cursor lags the server
// clock. A writer stamps its rows before it commits (an import
// transaction can run for many seconds, a write can wait out the busy
// timeout), so a row can commit after a pull while carrying an earlier
// stamp; with the cursor at "now" the next pull would skip it. The
// margin exceeds any such delay, and the redelivery it causes is
// harmless: clients upsert by key.
const cursorMargin = 30 * time.Second

// PushBody is a client's offline work: study events, keyed rows and typed
// study rows. Event users are forced to the caller; keyed and typed rows
// carry the client's updatedAt (and deletedAt for a deletion) for
// last-write-wins. Typed rows are decoded strictly (rows.Decode).
type PushBody struct {
	Events []model.StudyEvent `json:"events"`
	Rows   []model.KeyedRow   `json:"rows"`

	Cards        []json.RawMessage `json:"cards"`
	Decks        []json.RawMessage `json:"decks"`
	DeckSettings []json.RawMessage `json:"deckSettings"`
	Limits       []json.RawMessage `json:"limits"`
	FsrsSets     []json.RawMessage `json:"fsrsSets"`
	FsrsActive   []json.RawMessage `json:"fsrsActive"`
}

// Typed returns the typed items of the body by collection, in wire order.
func (b PushBody) Typed() []struct {
	Family rows.Family
	Items  []json.RawMessage
} {
	return []struct {
		Family rows.Family
		Items  []json.RawMessage
	}{{rows.Cards, b.Cards}, {rows.Decks, b.Decks}, {rows.DeckSettings, b.DeckSettings},
		{rows.Limits, b.Limits}, {rows.FsrsSets, b.FsrsSets}, {rows.FsrsActive, b.FsrsActive}}
}

// PushResult counts what a push did.
type PushResult struct {
	EventsAccepted  int `json:"eventsAccepted"`
	EventDuplicates int `json:"eventDuplicates"`
	DataAccepted    int `json:"dataAccepted"`
	DataSkipped     int `json:"dataSkipped"`
	// DataRefused counts keyed rows of a key no family accepts, or in the
	// wrong scope (keyed.Check); they are not applied, the rest of the push
	// is.
	DataRefused int `json:"dataRefused"`
}

// typedItem is one decoded typed push item and its edit.
type typedItem struct {
	row     rows.Row
	edited  time.Time
	deleted bool
}

// Push applies body for userID. It validates the whole body first —
// event ids and timestamps, workspace ownership, typed rows — and applies
// nothing if any item fails (ErrInvalid or ErrNotFound).
//
// Events append idempotently through events.Append. A keyed row applies
// under last write wins (keyed.Apply): accepted when the server's row is
// absent or no newer, skipped otherwise, and a deletion of an absent or
// deleted row is skipped. A keyed row of a key no family accepts, or in the
// wrong scope, is refused alone (DataRefused): the events and every other
// row still apply.
func Push(ctx context.Context, sqlDB *sql.DB, userID int64, body PushBody) (PushResult, error) {
	owned := map[int64]bool{}
	checkWorkspace := func(id int64) error {
		if owned[id] {
			return nil
		}
		var one int
		err := sqlDB.QueryRowContext(ctx,
			`SELECT 1 FROM workspaces WHERE id = ? AND user_id = ?`, id, userID).Scan(&one)
		if errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("%w: workspace %d", ErrNotFound, id)
		}
		if err != nil {
			return fmt.Errorf("sync push: check workspace %d: %w", id, err)
		}
		owned[id] = true
		return nil
	}

	evts := make([]model.StudyEvent, len(body.Events))
	copy(evts, body.Events)
	for i := range evts {
		ev := &evts[i]
		if !events.ValidID(ev.ID) || ev.TS.IsZero() {
			return PushResult{}, fmt.Errorf("%w: event %d needs a ULID id and a ts", ErrInvalid, i)
		}
		if ev.WorkspaceID <= 0 {
			// The same validation error as POST /api/events/batch.
			return PushResult{}, fmt.Errorf("%w: event %d needs a workspaceId", ErrInvalid, i)
		}
		if err := checkWorkspace(ev.WorkspaceID); err != nil {
			return PushResult{}, err
		}
		ev.UserID = userID
	}
	for i, row := range body.Rows {
		if row.Key == "" {
			return PushResult{}, fmt.Errorf("%w: row %d needs a key", ErrInvalid, i)
		}
		if keyed.EditTime(row).IsZero() {
			return PushResult{}, fmt.Errorf("%w: row %d needs updatedAt or deletedAt to order it", ErrInvalid, i)
		}
		if row.WorkspaceID != nil {
			if err := checkWorkspace(*row.WorkspaceID); err != nil {
				return PushResult{}, err
			}
		}
	}

	var typed []typedItem
	for _, coll := range body.Typed() {
		for i, raw := range coll.Items {
			r, err := rows.Decode(coll.Family, raw)
			if err != nil {
				return PushResult{}, fmt.Errorf("%w: %s %d: %v", ErrInvalid, coll.Family, i, err)
			}
			if err := checkWorkspace(r.M().WorkspaceID); err != nil {
				return PushResult{}, err
			}
			m := r.M()
			typed = append(typed, typedItem{row: r, edited: study.EditTime(m.UpdatedAt, m.DeletedAt), deleted: m.DeletedAt != nil})
		}
	}
	// A typed item whose stored row this server cannot read back would
	// replace data it does not understand: the push is refused whole, before
	// anything applies, like a malformed item.
	for _, it := range typed {
		if _, _, err := study.Load(ctx, sqlDB, userID, it.row.M().WorkspaceID, it.row.Family(), it.row.Identity()); err != nil {
			if errors.Is(err, study.ErrUnreadableStored) {
				return PushResult{}, fmt.Errorf("%w: %s %q", ErrStoredUnreadable, it.row.Family(), it.row.Identity())
			}
			return PushResult{}, fmt.Errorf("sync push: %w", err)
		}
	}

	var res PushResult
	if len(evts) > 0 {
		accepted, dups, err := events.Append(ctx, sqlDB, evts)
		if err != nil {
			return PushResult{}, fmt.Errorf("sync push: %w", err)
		}
		res.EventsAccepted, res.EventDuplicates = accepted, dups
	}
	for _, row := range body.Rows {
		if keyed.Check(row.Key, row.WorkspaceID) != nil {
			res.DataRefused++
			continue
		}
		applied, err := keyed.Apply(ctx, sqlDB, userID, row)
		if err != nil {
			return res, fmt.Errorf("sync push: %w", err)
		}
		if applied {
			res.DataAccepted++
		} else {
			res.DataSkipped++
		}
	}
	for _, it := range typed {
		outcome, err := study.ApplyOutcome(ctx, sqlDB, userID, it.row, it.edited, it.deleted)
		if err != nil {
			return res, fmt.Errorf("sync push: %w", err)
		}
		if outcome == study.Skipped {
			res.DataSkipped++
		} else {
			res.DataAccepted++ // applied, or equal content that needed no write
		}
	}
	return res, nil
}
