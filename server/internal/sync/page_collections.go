package sync

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"time"

	"qinqin/internal/library"
	"qinqin/internal/model"
	"qinqin/internal/study"
	"qinqin/internal/study/rows"
)

// The collections of the paged pull: one or more keyset segments each, in
// round order (V2Collections). Every query filters by the caller's user_id
// (keysetQuery); the fragments below narrow further:
//   - workspace= keeps a workspace's rows plus user-global ones (pluginData
//     without a workspace, pluginStates); bookmarks and highlights follow
//     their book's workspace, library tombstones the logged workspace_id;
//   - overlays and own sentences ship only for entries of the round's
//     languages (?8);
//   - lookup events never ship, nor study-namespace plugin rows of a
//     typed family (leftovers).
// Row shapes: docs/contracts/sync/pull-page.json.

// PullPage answers one v2 pull request of userID over the caller's own
// collections; cat gives the catalogue ETag for the scope (nil: empty).
func PullPage(ctx context.Context, sqlDB *sql.DB, userID int64, req PageRequest, cat CatalogueFunc) (Page, error) {
	return pullPage(ctx, sqlDB, userID, req, v2Set, cat)
}

var v2Set = roundSet{
	order:       V2Collections,
	segs:        v2Segments(),
	restartable: []string{"overlays", "sentences"},
	scope:       v2Scope,
}

func byWorkspace(col string) func(int64) string {
	return func(ws int64) string {
		if ws == 0 {
			return ""
		}
		return " AND " + col + " = ?7"
	}
}

func byBookWorkspace(ws int64) string {
	if ws == 0 {
		return ""
	}
	return " AND book_id IN (SELECT id FROM library_books WHERE workspace_id = ?7)"
}

func byLanguage(int64) string {
	return " AND entry_id IN (SELECT id FROM entries WHERE language IN (SELECT value FROM json_each(?8)))"
}

func v2Segments() []segment {
	segs := []segment{
		{coll: "workspaces", table: "workspaces", stamp: "updated_at", cols: "id, language, name, settings, updated_at",
			extra: byWorkspace("id"), encode: encodeWorkspace},
		{coll: "pluginStates", table: "plugin_states", stamp: "updated_at", cols: "pack_id, user_id, enabled, ord, updated_at",
			encode: encodePluginState},
		{coll: "pluginData", table: "plugin_data", stamp: "updated_at", tomb: true,
			cols: "pack_id, key, user_id, workspace_id, data, version, updated_at, deleted_at",
			extra: func(ws int64) string {
				// a leftover study-namespace row of a typed family (an old
				// binary's write the start could not adopt) is never shipped:
				// those rows are typed collections only (#198)
				typed := " AND NOT (pack_id = '" + rows.Namespace + "' AND " + study.LegacyKeySQL + ")"
				if ws == 0 {
					return typed
				}
				return typed + " AND (workspace_id IS NULL OR workspace_id = ?7)"
			}, encode: encodePluginData},
	}
	for _, f := range rows.Families {
		segs = append(segs, segment{coll: string(f), table: study.TableOf(f), stamp: "updated_at", tomb: true,
			cols: "updated_at, " + study.SelectColumns(f), extra: byWorkspace("workspace_id"), encode: encodeTyped(f)})
	}
	segs = append(segs,
		segment{coll: "books", table: "library_books", stamp: "updated_at",
			cols:  "id, workspace_id, language, title, author, source, source_id, source_url, attribution, license_note, chapter_count, position, created_at, updated_at",
			extra: byWorkspace("workspace_id"), encode: encodeBook},
		libraryLog("books"),
		segment{coll: "bookmarks", table: "library_bookmarks", stamp: "updated_at",
			cols: "id, book_id, position, label, created_at, updated_at", extra: byBookWorkspace, encode: encodeBookmark},
		libraryLog("bookmarks"),
		segment{coll: "highlights", table: "library_highlights", stamp: "updated_at",
			cols:  "id, book_id, chapter, paragraph, start_cp, end_cp, text, color, note, created_at, updated_at",
			extra: byBookWorkspace, encode: encodeHighlight},
		libraryLog("highlights"),
		segment{coll: "overlays", table: "user_edits", stamp: "updated_at", cols: "entry_id, written, readings, updated_at",
			extra: byLanguage, encode: encodeOverlay},
		segment{coll: "sentences", table: "sentences", stamp: "updated_at", tomb: true,
			cols:  "id, entry_id, source_pack, user_id, hanzi, pinyin, translation, updated_at, deleted_at",
			extra: byLanguage, encode: encodeSentence},
		segment{coll: "events", table: "study_events", stamp: "updated_at",
			cols: "id, workspace_id, device, ts, type, payload, updated_at",
			extra: func(ws int64) string {
				return " AND type <> 'lookup'" + byWorkspace("workspace_id")(ws)
			}, encode: encodeEvent},
	)
	return segs
}

// libraryLog is the tombstone segment of a library collection: its
// library_deletions rows, walked only with since.
func libraryLog(coll string) segment {
	return segment{coll: coll, table: "library_deletions", stamp: "deleted_at", log: true,
		cols: "row_id, workspace_id, deleted_at",
		extra: func(ws int64) string {
			return " AND collection = '" + coll + "'" + byWorkspace("workspace_id")(ws)
		}, encode: encodeLibraryTombstone}
}

func parseStamp(s string) (time.Time, error) { return parseTS(s) }

func encodeWorkspace(sc scanner) (string, int64, []byte, error) {
	var rowid int64
	var w struct {
		ID        int64           `json:"id"`
		Language  string          `json:"language"`
		Name      string          `json:"name"`
		Settings  json.RawMessage `json:"settings"`
		UpdatedAt string          `json:"updatedAt"`
	}
	var settings string
	if err := sc.Scan(&rowid, &w.ID, &w.Language, &w.Name, &settings, &w.UpdatedAt); err != nil {
		return "", 0, nil, err
	}
	w.Settings = json.RawMessage(settings)
	if !json.Valid(w.Settings) {
		return "", 0, nil, fmt.Errorf("workspace %d: settings are not JSON", w.ID)
	}
	return marshalRow(w.UpdatedAt, rowid, w)
}

// marshalRow checks the stored stamp and encodes v.
func marshalRow(stamp string, rowid int64, v any) (string, int64, []byte, error) {
	if _, err := parseStamp(stamp); err != nil {
		return "", 0, nil, err
	}
	raw, err := json.Marshal(v)
	return stamp, rowid, raw, err
}

func encodePluginState(sc scanner) (string, int64, []byte, error) {
	var rowid int64
	var s model.PluginState
	var enabled int
	var updated string
	if err := sc.Scan(&rowid, &s.PluginID, &s.UserID, &enabled, &s.Order, &updated); err != nil {
		return "", 0, nil, err
	}
	s.Enabled = enabled != 0
	var err error
	if s.UpdatedAt, err = parseStamp(updated); err != nil {
		return "", 0, nil, err
	}
	return marshalRow(updated, rowid, s)
}

func encodePluginData(sc scanner) (string, int64, []byte, error) {
	var rowid int64
	var d model.PluginData
	var ws sql.NullInt64
	var data, updated string
	var deleted sql.NullString
	if err := sc.Scan(&rowid, &d.PluginID, &d.Key, &d.UserID, &ws, &data, &d.Version, &updated, &deleted); err != nil {
		return "", 0, nil, err
	}
	if ws.Valid {
		id := ws.Int64
		d.WorkspaceID = &id
	}
	d.Data = json.RawMessage(data)
	var err error
	if d.UpdatedAt, err = parseStamp(updated); err != nil {
		return "", 0, nil, err
	}
	if d.DeletedAt, err = parseDeleted(deleted); err != nil {
		return "", 0, nil, err
	}
	return marshalRow(updated, rowid, d)
}

// typedScanner puts rowid and the stored stamp in front of the columns a
// study scan reads.
type typedScanner struct {
	sc    scanner
	rowid *int64
	stamp *string
}

func (r typedScanner) Scan(dest ...any) error {
	return r.sc.Scan(append([]any{r.rowid, r.stamp}, dest...)...)
}

func encodeTyped(f rows.Family) func(sc scanner) (string, int64, []byte, error) {
	return func(sc scanner) (string, int64, []byte, error) {
		var rowid int64
		var stamp string
		r, err := study.ScanRow(f, typedScanner{sc, &rowid, &stamp})
		if errors.Is(err, study.ErrUnreadableStored) {
			// walk skips it and still moves past its rowid.
			return stamp, rowid, nil, err
		}
		if err != nil {
			return "", 0, nil, err
		}
		return marshalRow(stamp, rowid, r)
	}
}

type v2Book struct {
	library.Book
	DeletedAt *string `json:"deletedAt"`
}

func encodeBook(sc scanner) (string, int64, []byte, error) {
	var rowid int64
	var b v2Book
	var created, updated string
	if err := sc.Scan(&rowid, &b.ID, &b.WorkspaceID, &b.Language, &b.Title, &b.Author, &b.Source, &b.SourceID, &b.SourceURL,
		&b.Attribution, &b.LicenseNote, &b.ChapterCount, &b.Position, &created, &updated); err != nil {
		return "", 0, nil, err
	}
	var err error
	if b.CreatedAt, err = parseStamp(created); err != nil {
		return "", 0, nil, err
	}
	if b.UpdatedAt, err = parseStamp(updated); err != nil {
		return "", 0, nil, err
	}
	return marshalRow(updated, rowid, b)
}

func encodeBookmark(sc scanner) (string, int64, []byte, error) {
	var rowid int64
	var b struct {
		library.Bookmark
		DeletedAt *string `json:"deletedAt"`
	}
	var created, updated string
	if err := sc.Scan(&rowid, &b.ID, &b.BookID, &b.Position, &b.Label, &created, &updated); err != nil {
		return "", 0, nil, err
	}
	var err error
	if b.CreatedAt, err = parseStamp(created); err != nil {
		return "", 0, nil, err
	}
	if b.UpdatedAt, err = parseStamp(updated); err != nil {
		return "", 0, nil, err
	}
	return marshalRow(updated, rowid, b)
}

func encodeHighlight(sc scanner) (string, int64, []byte, error) {
	var rowid int64
	var h struct {
		library.Highlight
		DeletedAt *string `json:"deletedAt"`
	}
	var created, updated string
	if err := sc.Scan(&rowid, &h.ID, &h.BookID, &h.Chapter, &h.Paragraph, &h.Start, &h.End, &h.Text, &h.Color, &h.Note,
		&created, &updated); err != nil {
		return "", 0, nil, err
	}
	var err error
	if h.CreatedAt, err = parseStamp(created); err != nil {
		return "", 0, nil, err
	}
	if h.UpdatedAt, err = parseStamp(updated); err != nil {
		return "", 0, nil, err
	}
	return marshalRow(updated, rowid, h)
}

// encodeLibraryTombstone is a library_deletions row on the wire:
// {id, workspaceId, updatedAt, deletedAt} with updatedAt = deletedAt.
func encodeLibraryTombstone(sc scanner) (string, int64, []byte, error) {
	var rowid int64
	var t struct {
		ID          int64  `json:"id"`
		WorkspaceID int64  `json:"workspaceId"`
		UpdatedAt   string `json:"updatedAt"`
		DeletedAt   string `json:"deletedAt"`
	}
	if err := sc.Scan(&rowid, &t.ID, &t.WorkspaceID, &t.DeletedAt); err != nil {
		return "", 0, nil, err
	}
	t.UpdatedAt = t.DeletedAt
	return marshalRow(t.DeletedAt, rowid, t)
}

func encodeOverlay(sc scanner) (string, int64, []byte, error) {
	var rowid int64
	var o Overlay
	var written, readings sql.NullString
	var updated string
	if err := sc.Scan(&rowid, &o.EntryID, &written, &readings, &updated); err != nil {
		return "", 0, nil, err
	}
	if written.Valid {
		w := written.String
		o.Written = &w
	}
	if readings.Valid {
		if err := json.Unmarshal([]byte(readings.String), &o.Readings); err != nil {
			return "", 0, nil, fmt.Errorf("readings of entry %d: %w", o.EntryID, err)
		}
	}
	var err error
	if o.UpdatedAt, err = parseStamp(updated); err != nil {
		return "", 0, nil, err
	}
	return marshalRow(updated, rowid, o)
}

func encodeSentence(sc scanner) (string, int64, []byte, error) {
	var rowid int64
	var s model.Sentence
	var owner sql.NullInt64
	var updated string
	var deleted sql.NullString
	if err := sc.Scan(&rowid, &s.ID, &s.EntryID, &s.SourcePack, &owner, &s.Hanzi, &s.Pinyin, &s.Translation, &updated, &deleted); err != nil {
		return "", 0, nil, err
	}
	if owner.Valid {
		id := owner.Int64
		s.UserID = &id
	}
	var err error
	if s.UpdatedAt, err = parseStamp(updated); err != nil {
		return "", 0, nil, err
	}
	if s.DeletedAt, err = parseDeleted(deleted); err != nil {
		return "", 0, nil, err
	}
	return marshalRow(updated, rowid, s)
}

func encodeEvent(sc scanner) (string, int64, []byte, error) {
	var rowid int64
	var e struct {
		ID          string          `json:"id"`
		WorkspaceID int64           `json:"workspaceId"`
		Device      string          `json:"device"`
		TS          time.Time       `json:"ts"`
		Type        string          `json:"type"`
		Payload     json.RawMessage `json:"payload"`
		UpdatedAt   time.Time       `json:"updatedAt"`
	}
	var ts, payload, updated string
	if err := sc.Scan(&rowid, &e.ID, &e.WorkspaceID, &e.Device, &ts, &e.Type, &payload, &updated); err != nil {
		return "", 0, nil, err
	}
	var err error
	if e.TS, err = time.Parse(time.RFC3339Nano, ts); err != nil {
		return "", 0, nil, fmt.Errorf("event %s: ts %q: %w", e.ID, ts, err)
	}
	if e.UpdatedAt, err = parseStamp(updated); err != nil {
		return "", 0, nil, err
	}
	e.Payload = json.RawMessage(payload)
	return marshalRow(updated, rowid, e)
}

// v2Scope reads the caller's workspaces: a workspace filter of another user
// or none at all is ErrNotFound. The round's languages are the workspace's
// with workspace=, else every workspace's.
func v2Scope(ctx context.Context, sqlDB *sql.DB, userID, workspace int64) ([]string, Scope, error) {
	rs, err := sqlDB.QueryContext(ctx, `SELECT id, language FROM workspaces WHERE user_id = ? ORDER BY id`, userID)
	if err != nil {
		return nil, Scope{}, fmt.Errorf("sync pull: workspaces: %w", err)
	}
	defer rs.Close()
	sc := Scope{Workspaces: []WorkspaceRef{}}
	var narrowed []string
	for rs.Next() {
		var w WorkspaceRef
		if err := rs.Scan(&w.ID, &w.Language); err != nil {
			return nil, Scope{}, fmt.Errorf("sync pull: workspaces: %w", err)
		}
		sc.Workspaces = append(sc.Workspaces, w)
		if w.ID == workspace {
			narrowed = []string{w.Language}
		}
	}
	if err := rs.Err(); err != nil {
		return nil, Scope{}, fmt.Errorf("sync pull: workspaces: %w", err)
	}
	if workspace != 0 && narrowed == nil {
		return nil, Scope{}, fmt.Errorf("%w: workspace %d", ErrNotFound, workspace)
	}
	sc.Languages = workspaceLanguages(sc.Workspaces)
	if narrowed != nil {
		sc.Languages = narrowed
	}
	return slices.Clone(sc.Languages), sc, nil
}
