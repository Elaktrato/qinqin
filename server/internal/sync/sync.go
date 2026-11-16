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
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	"qinqin/internal/events"
	"qinqin/internal/model"
	"qinqin/internal/plugins"
	"qinqin/internal/study"
	"qinqin/internal/study/rows"
)

var (
	// ErrNotFound reports a push referencing a workspace the caller does
	// not own or a plugin that does not exist. Unknown and foreign
	// workspaces are indistinguishable by design.
	ErrNotFound = errors.New("sync: not found")
	// ErrInvalid reports a malformed push item.
	ErrInvalid = errors.New("sync: invalid")
)

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
	Entries      []Entry             `json:"entries"`
	Links        []Link              `json:"links"`
	Senses       []Sense             `json:"senses"`
	LevelMembers []LevelMember       `json:"levelMembers"`
	Sentences    []model.Sentence    `json:"sentences"`
	PluginData   []model.PluginData  `json:"pluginData"`
	PluginStates []model.PluginState `json:"pluginStates"`
	Overlays     []Overlay           `json:"overlays"`

	// The registry rows the rows above reference — senses point at a
	// dictionary id, level members at a level id — so a client holding
	// only the delta can resolve them. Schemes ship without their nested
	// levels; Levels carries those.
	Dictionaries []model.Dictionary `json:"dictionaries"`
	Schemes      []model.Scheme     `json:"schemes"`
	Levels       []model.Level      `json:"levels"`

	// The caller's typed study rows (docs/contracts/study/), last-write-wins
	// per row with tombstones, like plugin data.
	Cards        []rows.Card            `json:"cards"`
	Decks        []rows.Deck            `json:"decks"`
	DeckSettings []rows.DeckSettingsRow `json:"deckSettings"`
	Limits       []rows.LimitsRow       `json:"limits"`
	FsrsSets     []rows.FsrsSet         `json:"fsrsSets"`
	FsrsActive   []rows.FsrsActiveRow   `json:"fsrsActive"`
}

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

// PushBody is a client's offline work: study events, plugin data rows and
// typed study rows. Event users are forced to the caller; plugin data and
// typed rows carry the client's updatedAt (and deletedAt for a deletion)
// for last-write-wins. Typed rows are decoded strictly (rows.Decode).
type PushBody struct {
	Events     []model.StudyEvent `json:"events"`
	PluginData []model.PluginData `json:"pluginData"`

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
	// DataRefused counts rows of plugins that do not declare owns-data;
	// they are not applied, the rest of the push is.
	DataRefused int `json:"dataRefused"`
}

// typedItem is one decoded typed push item and its edit.
type typedItem struct {
	row     rows.Row
	edited  time.Time
	deleted bool
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
// absent or already deleted, count as skipped. A row of a plugin that
// does not declare owns-data is refused alone (DataRefused): the events
// and every other row still apply.
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
	// knownPlugin caches the per-plugin answer: whether it may be written.
	knownPlugin := map[string]bool{}
	for i, row := range body.PluginData {
		if row.PluginID == "" || row.Key == "" {
			return PushResult{}, fmt.Errorf("%w: plugin data %d needs pluginId and key", ErrInvalid, i)
		}
		if editTime(row).IsZero() {
			return PushResult{}, fmt.Errorf("%w: plugin data %d needs updatedAt or deletedAt to order it", ErrInvalid, i)
		}
		if row.WorkspaceID != nil {
			if err := checkWorkspace(*row.WorkspaceID); err != nil {
				return PushResult{}, err
			}
		}
		if _, seen := knownPlugin[row.PluginID]; !seen {
			exists, allowed, err := plugins.CanWriteData(ctx, sqlDB, row.PluginID)
			if err != nil {
				return PushResult{}, fmt.Errorf("sync push: %w", err)
			}
			if !exists {
				return PushResult{}, fmt.Errorf("%w: plugin %q", ErrNotFound, row.PluginID)
			}
			knownPlugin[row.PluginID] = allowed
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

	var res PushResult
	if len(evts) > 0 {
		accepted, dups, err := events.Append(ctx, sqlDB, evts)
		if err != nil {
			return PushResult{}, fmt.Errorf("sync push: %w", err)
		}
		res.EventsAccepted, res.EventDuplicates = accepted, dups
	}
	for _, row := range body.PluginData {
		if !knownPlugin[row.PluginID] {
			res.DataRefused++
			continue
		}
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
	for _, it := range typed {
		applied, err := study.Apply(ctx, sqlDB, userID, it.row, it.edited, it.deleted)
		if err != nil {
			return res, fmt.Errorf("sync push: %w", err)
		}
		if applied {
			res.DataAccepted++
		} else {
			res.DataSkipped++
		}
	}
	return res, nil
}

// editTime is when the client made the edit a plugin data row carries:
// its updatedAt, or its deletedAt when that is later (a tombstone that
// sets only deletedAt). Zero when the row has neither.
func editTime(row model.PluginData) time.Time {
	t := row.UpdatedAt
	if row.DeletedAt != nil && row.DeletedAt.After(t) {
		t = *row.DeletedAt
	}
	return t.UTC()
}

// applyData applies one incoming plugin data row under last-write-wins
// on edit time — the client's clock, clamped to the server's so a clock
// running ahead cannot pin a row — and reports whether it changed the
// server. The comparison is against the stored edit time (modified_at),
// not the server's arrival stamp, so an edit made later on another
// device wins even when it syncs after an earlier one.
func applyData(ctx context.Context, sqlDB *sql.DB, userID int64, row model.PluginData) (bool, error) {
	edited := editTime(row)
	if nowT := time.Now().UTC(); edited.After(nowT) {
		edited = nowT
	}
	var workspace any
	if row.WorkspaceID != nil {
		workspace = *row.WorkspaceID
	}
	var serverUpdated string
	var serverDeleted sql.NullString
	err := sqlDB.QueryRowContext(ctx, `
		SELECT COALESCE(modified_at, updated_at), deleted_at FROM plugin_data
		WHERE pack_id = ? AND user_id = ? AND `+plugins.UniqueKeyWorkspace+` = IFNULL(?, `+strconv.Itoa(plugins.NoWorkspace)+`) AND key = ?`,
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
		// Stored edit times are second-truncated, so compare at that
		// precision: a same-second write by the client wins.
		if server.After(edited.Truncate(time.Second)) {
			return false, nil
		}
	}
	if row.DeletedAt != nil {
		if !exists || serverDeleted.Valid {
			return false, nil
		}
		if err := plugins.DeleteDataAt(ctx, sqlDB, userID, row.WorkspaceID, row.PluginID, row.Key, edited); err != nil {
			return false, fmt.Errorf("sync push: %w", err)
		}
		return true, nil
	}
	if _, err := plugins.PutDataAt(ctx, sqlDB, userID, row.WorkspaceID, row.PluginID, row.Key, row.Data, edited); err != nil {
		return false, fmt.Errorf("sync push: %w", err)
	}
	return true, nil
}
