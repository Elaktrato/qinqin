// Package sync is the delta sync between the server and its clients: a
// pull that ships every row changed since a cursor — tombstones included,
// so deletions reach clients — and a push that applies a client's
// offline work: study events (idempotent by ULID) and plugin data
// (last-write-wins on updated_at).
//
// Timestamps are second-truncated server clock, so pulls are inclusive
// of the cursor second: a row written in the same second as the cursor
// is shipped again rather than risk being missed. Clients upsert by
// primary key, so the redelivery is harmless.
package sync

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"qinqin/internal/entries"
	"qinqin/internal/events"
	"qinqin/internal/model"
	"qinqin/internal/plugins"
)

var (
	// ErrNotFound reports a push referencing a workspace the caller does
	// not own or a plugin that does not exist. Unknown and foreign
	// workspaces are indistinguishable by design.
	ErrNotFound = errors.New("sync: not found")
	// ErrInvalid reports a malformed push item.
	ErrInvalid = errors.New("sync: invalid")
)

// Link is one entry_links row: a variant, radical, or word-char relation.
type Link struct {
	FromID    int64      `json:"fromId"`
	ToID      int64      `json:"toId"`
	Type      string     `json:"type"`
	UpdatedAt time.Time  `json:"updatedAt"`
	DeletedAt *time.Time `json:"deletedAt"`
}

// LevelMember is one level_members row: an entry's membership in a level.
type LevelMember struct {
	ID        int64      `json:"id"`
	LevelID   int64      `json:"levelId"`
	EntryID   int64      `json:"entryId"`
	Derived   bool       `json:"derived"`
	UpdatedAt time.Time  `json:"updatedAt"`
	DeletedAt *time.Time `json:"deletedAt"`
}

// Delta is everything that changed since a cursor. Every collection is
// non-nil. Entries, links, senses, and level members are shared content;
// sentences are the pack ones plus the caller's own; plugin data and
// states are the caller's. Rows carry updated_at and, when removed,
// deleted_at.
type Delta struct {
	Cursor       time.Time           `json:"cursor"`
	Entries      []model.Entry       `json:"entries"`
	Links        []Link              `json:"links"`
	Senses       []model.Sense       `json:"senses"`
	LevelMembers []LevelMember       `json:"levelMembers"`
	Sentences    []model.Sentence    `json:"sentences"`
	PluginData   []model.PluginData  `json:"pluginData"`
	PluginStates []model.PluginState `json:"pluginStates"`
}

// Pull returns every row changed at or after cursor (the zero time means
// everything), tombstones included. Cursor is the server clock read
// before any query ran, so a row written mid-pull is picked up by the
// next pull from it.
func Pull(ctx context.Context, sqlDB *sql.DB, userID int64, cursor time.Time) (Delta, error) {
	d := Delta{Cursor: time.Now().UTC().Truncate(time.Second)}
	since := cursor.UTC().Format(time.RFC3339)
	var err error

	if d.Entries, err = (entries.Store{DB: sqlDB}).ChangedSince(ctx, cursor); err != nil {
		return Delta{}, fmt.Errorf("sync pull: %w", err)
	}
	if d.Links, err = pullLinks(ctx, sqlDB, since); err != nil {
		return Delta{}, err
	}
	if d.Senses, err = pullSenses(ctx, sqlDB, since); err != nil {
		return Delta{}, err
	}
	if d.LevelMembers, err = pullLevelMembers(ctx, sqlDB, since); err != nil {
		return Delta{}, err
	}
	if d.Sentences, err = pullSentences(ctx, sqlDB, userID, since); err != nil {
		return Delta{}, err
	}
	if d.PluginData, err = plugins.PullData(ctx, sqlDB, userID, cursor); err != nil {
		return Delta{}, fmt.Errorf("sync pull: %w", err)
	}
	if d.PluginStates, err = pullPluginStates(ctx, sqlDB, userID, since); err != nil {
		return Delta{}, err
	}
	return d, nil
}

// PushBody is a client's offline work: study events and plugin data
// rows. Event users are forced to the caller; plugin data rows carry the
// client's updated_at (and deleted_at for a deletion) for last-write-wins.
type PushBody struct {
	Events     []model.StudyEvent `json:"events"`
	PluginData []model.PluginData `json:"pluginData"`
}

// PushResult counts what a push did.
type PushResult struct {
	EventsAccepted  int `json:"eventsAccepted"`
	EventDuplicates int `json:"eventDuplicates"`
	DataAccepted    int `json:"dataAccepted"`
	DataSkipped     int `json:"dataSkipped"`
}

// Push applies body for userID. It validates the whole body first —
// event ids and timestamps, workspace ownership, plugin existence — and
// applies nothing if any item fails (ErrInvalid or ErrNotFound).
//
// Events append idempotently through events.Append. A plugin data row is
// accepted when the server's row for the same (plugin, workspace, key)
// is absent or no newer than the incoming updated_at, and is then
// written through the plugin store — so the server stamps its own
// updated_at and bumps the version — or tombstoned when the incoming row
// is a deletion. A newer server row, and a deletion of a row that is
// absent or already deleted, count as skipped.
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
		if ev.ID == "" || ev.TS.IsZero() {
			return PushResult{}, fmt.Errorf("%w: event %d needs an id and ts", ErrInvalid, i)
		}
		if err := checkWorkspace(ev.WorkspaceID); err != nil {
			return PushResult{}, err
		}
		ev.UserID = userID
	}
	knownPlugin := map[string]bool{}
	for i, row := range body.PluginData {
		if row.PluginID == "" || row.Key == "" {
			return PushResult{}, fmt.Errorf("%w: plugin data %d needs pluginId and key", ErrInvalid, i)
		}
		if row.WorkspaceID != nil {
			if err := checkWorkspace(*row.WorkspaceID); err != nil {
				return PushResult{}, err
			}
		}
		if !knownPlugin[row.PluginID] {
			ok, err := plugins.Exists(ctx, sqlDB, row.PluginID)
			if err != nil {
				return PushResult{}, fmt.Errorf("sync push: %w", err)
			}
			if !ok {
				return PushResult{}, fmt.Errorf("%w: plugin %q", ErrNotFound, row.PluginID)
			}
			knownPlugin[row.PluginID] = true
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
	for _, row := range body.PluginData {
		applied, err := applyData(ctx, sqlDB, userID, row)
		if err != nil {
			return res, err
		}
		if applied {
			res.DataAccepted++
		} else {
			res.DataSkipped++
		}
	}
	return res, nil
}

// applyData applies one incoming plugin data row under last-write-wins
// and reports whether it changed the server.
func applyData(ctx context.Context, sqlDB *sql.DB, userID int64, row model.PluginData) (bool, error) {
	var workspace any
	if row.WorkspaceID != nil {
		workspace = *row.WorkspaceID
	}
	var serverUpdated string
	var serverDeleted sql.NullString
	err := sqlDB.QueryRowContext(ctx, `
		SELECT updated_at, deleted_at FROM plugin_data
		WHERE pack_id = ? AND user_id = ? AND IFNULL(workspace_id, 0) = IFNULL(?, 0) AND key = ?`,
		row.PluginID, userID, workspace, row.Key).Scan(&serverUpdated, &serverDeleted)
	exists := !errors.Is(err, sql.ErrNoRows)
	if err != nil && exists {
		return false, fmt.Errorf("sync push: read data %s/%s: %w", row.PluginID, row.Key, err)
	}
	if exists {
		server, err := time.Parse(time.RFC3339, serverUpdated)
		if err != nil {
			return false, fmt.Errorf("sync push: parse updated_at %q of %s/%s: %w", serverUpdated, row.PluginID, row.Key, err)
		}
		// Server timestamps are second-truncated, so compare at that
		// precision: a same-second write by the client wins.
		if server.After(row.UpdatedAt.UTC().Truncate(time.Second)) {
			return false, nil
		}
	}
	if row.DeletedAt != nil {
		if !exists || serverDeleted.Valid {
			return false, nil
		}
		if err := plugins.DeleteData(ctx, sqlDB, userID, row.WorkspaceID, row.PluginID, row.Key); err != nil {
			return false, fmt.Errorf("sync push: %w", err)
		}
		return true, nil
	}
	if _, err := plugins.PutData(ctx, sqlDB, userID, row.WorkspaceID, row.PluginID, row.Key, row.Data); err != nil {
		return false, fmt.Errorf("sync push: %w", err)
	}
	return true, nil
}
