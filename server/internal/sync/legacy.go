package sync

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"iter"
	"slices"
	"strings"
	"time"

	"qinqin/internal/model"
	"qinqin/internal/plugins"
	"qinqin/internal/study"
	"qinqin/internal/study/rows"
)

// The legacy pull (GET /api/sync/pull without v=2, kept for cached v0.3.x
// shells and token scripts until v0.5.0): one JSON object, the Delta shape,
// written row by row as the rows are scanned, so the server holds one row
// of it at a time whatever the account's size. The lexicon collections
// moved to data packages: their keys stay as [] and naming one is ErrMoved.
// Contract: docs/contracts/sync/legacy-pull.json.

// Collections are the keys of the legacy answer after cursor, in order. A
// legacy pull may be limited to a subset of them.
var Collections = []string{"entries", "links", "senses", "levelMembers", "sentences",
	"pluginData", "pluginStates", "overlays", "dictionaries", "schemes", "levels",
	"cards", "decks", "deckSettings", "limits", "fsrsSets", "fsrsActive"}

// ParseCollections parses a legacy comma-separated collections list into
// the set StreamLegacy takes. An empty list means every collection (nil
// set); a lexicon name is ErrMoved; any other unknown name is ErrInvalid.
func ParseCollections(list string) (map[string]bool, error) {
	if strings.TrimSpace(list) == "" {
		return nil, nil
	}
	names := strings.Split(list, ",")
	for i := range names {
		names[i] = strings.TrimSpace(names[i])
		if slices.Contains(MovedCollections, names[i]) {
			return nil, fmt.Errorf("%w: %s (GET /api/packages)", ErrMoved, names[i])
		}
	}
	set := map[string]bool{}
	for _, name := range names {
		if !slices.Contains(Collections, name) {
			return nil, fmt.Errorf("%w: unknown collection %q", ErrInvalid, name)
		}
		set[name] = true
	}
	return set, nil
}

// legacyNow is the server clock of the legacy answer's cursor (tests set it).
var legacyNow = time.Now

// legacyScanHook, when set (tests), runs for every row as it is scanned.
var legacyScanHook func()

func scanned() {
	if legacyScanHook != nil {
		legacyScanHook()
	}
}

// legacyView reports whether a pull is an old web shell's: it names
// pluginData and none of the typed study collections. Such a pull gets the
// typed study rows as legacy qinqin-flashcards rows in pluginData. A pull
// without collections (nil) names every collection, typed ones included.
func legacyView(only map[string]bool) bool {
	if only == nil || !only["pluginData"] {
		return false
	}
	for _, f := range rows.Families {
		if only[string(f)] {
			return false
		}
	}
	return true
}

// legacyStream writes the answer; the first write error sticks.
type legacyStream struct {
	ctx   context.Context
	w     io.Writer
	err   error
	first bool
}

func (s *legacyStream) raw(text string) {
	if s.err == nil {
		_, s.err = io.WriteString(s.w, text)
	}
}

// row writes one row of the open array (one write per row).
func (s *legacyStream) row(v any) error {
	if s.err != nil {
		return s.err
	}
	if err := s.ctx.Err(); err != nil {
		s.err = err
		return err
	}
	raw, err := json.Marshal(v)
	if err != nil {
		s.err = err
		return err
	}
	if !s.first {
		raw = append([]byte{','}, raw...)
	}
	s.first = false
	_, s.err = s.w.Write(raw)
	return s.err
}

// StreamLegacy writes the legacy pull answer of userID to w: every row of
// the caller changed at or after cursor (the zero time: live rows only),
// for the collections in only (nil: all; ParseCollections), the others as
// []. The answer's cursor is the server clock minus cursorMargin. Rows are
// written as they are scanned; an error after the first write leaves the
// JSON truncated (the client fails to parse and retries).
func StreamLegacy(ctx context.Context, w io.Writer, sqlDB *sql.DB, userID int64, cursor time.Time, only map[string]bool) error {
	s := &legacyStream{ctx: ctx, w: w}
	next, _ := json.Marshal(legacyNow().UTC().Add(-cursorMargin).Truncate(time.Second))
	s.raw(`{"cursor":` + string(next))
	since := cursor.UTC().Format(time.RFC3339)
	for _, name := range Collections {
		s.raw(`,"` + name + `":[`)
		s.first = true
		if s.err == nil && (only == nil || only[name]) && !slices.Contains(MovedCollections, name) {
			if err := legacyCollection(ctx, s, sqlDB, userID, name, cursor, since, legacyView(only)); err != nil && s.err == nil {
				s.err = err
			}
		}
		s.raw(`]`)
	}
	s.raw(`}`)
	return s.err
}

func legacyCollection(ctx context.Context, s *legacyStream, sqlDB *sql.DB, userID int64, name string, cursor time.Time, since string, view bool) error {
	switch name {
	case "sentences":
		return legacySentences(ctx, s, sqlDB, userID, since, cursor.IsZero())
	case "pluginData":
		if view {
			return legacyViewData(ctx, s, sqlDB, userID, cursor)
		}
		return plugins.EachData(ctx, sqlDB, userID, cursor, cursor.IsZero(), func(d *model.PluginData) error {
			scanned()
			return s.row(d)
		})
	case "pluginStates":
		return legacyPluginStates(ctx, s, sqlDB, userID, since)
	case "overlays":
		return legacyOverlays(ctx, s, sqlDB, userID, since)
	}
	f := rows.Family(name)
	return study.PullEach(ctx, sqlDB, userID, f, cursor, false, func(r rows.Row) error {
		scanned()
		return s.row(r)
	})
}

// legacySentences ships the caller's own sentences (pack sentences are in
// the sentences packages; other users' never leave the server).
func legacySentences(ctx context.Context, s *legacyStream, sqlDB *sql.DB, userID int64, since string, liveOnly bool) error {
	live := ""
	if liveOnly {
		live = " AND deleted_at IS NULL"
	}
	list, err := sqlDB.QueryContext(ctx, `
		SELECT id, entry_id, source_pack, user_id, hanzi, pinyin, translation, updated_at, deleted_at
		FROM sentences WHERE user_id = ? AND updated_at >= ?`+live+` ORDER BY id`, userID, since)
	if err != nil {
		return fmt.Errorf("sync pull sentences: %w", err)
	}
	defer list.Close()
	for list.Next() {
		var row model.Sentence
		var owner sql.NullInt64
		var updated string
		var deleted sql.NullString
		if err := list.Scan(&row.ID, &row.EntryID, &row.SourcePack, &owner, &row.Hanzi, &row.Pinyin, &row.Translation, &updated, &deleted); err != nil {
			return fmt.Errorf("sync pull sentences: %w", err)
		}
		scanned()
		if owner.Valid {
			id := owner.Int64
			row.UserID = &id
		}
		if row.UpdatedAt, err = parseTS(updated); err != nil {
			return err
		}
		if row.DeletedAt, err = parseDeleted(deleted); err != nil {
			return err
		}
		if err := s.row(row); err != nil {
			return err
		}
	}
	if err := list.Err(); err != nil {
		return fmt.Errorf("sync pull sentences: %w", err)
	}
	return nil
}

// legacyOverlays ships the caller's entry overlays.
func legacyOverlays(ctx context.Context, s *legacyStream, sqlDB *sql.DB, userID int64, since string) error {
	list, err := sqlDB.QueryContext(ctx, `
		SELECT entry_id, written, readings, updated_at FROM user_edits
		WHERE user_id = ? AND updated_at >= ? ORDER BY entry_id`, userID, since)
	if err != nil {
		return fmt.Errorf("sync pull overlays: %w", err)
	}
	defer list.Close()
	for list.Next() {
		var o Overlay
		var written, readings sql.NullString
		var updated string
		if err := list.Scan(&o.EntryID, &written, &readings, &updated); err != nil {
			return fmt.Errorf("sync pull overlays: %w", err)
		}
		scanned()
		if written.Valid {
			w := written.String
			o.Written = &w
		}
		if readings.Valid {
			if err := json.Unmarshal([]byte(readings.String), &o.Readings); err != nil {
				return fmt.Errorf("sync pull overlays: readings of entry %d: %w", o.EntryID, err)
			}
		}
		if o.UpdatedAt, err = parseTS(updated); err != nil {
			return err
		}
		if err := s.row(o); err != nil {
			return err
		}
	}
	if err := list.Err(); err != nil {
		return fmt.Errorf("sync pull overlays: %w", err)
	}
	return nil
}

// legacyPluginStates ships the caller's plugin states.
func legacyPluginStates(ctx context.Context, s *legacyStream, sqlDB *sql.DB, userID int64, since string) error {
	list, err := sqlDB.QueryContext(ctx, `
		SELECT pack_id, user_id, enabled, ord, updated_at FROM plugin_states
		WHERE user_id = ? AND updated_at >= ? ORDER BY pack_id`, userID, since)
	if err != nil {
		return fmt.Errorf("sync pull plugin states: %w", err)
	}
	defer list.Close()
	for list.Next() {
		var st model.PluginState
		var enabled int
		var updated string
		if err := list.Scan(&st.PluginID, &st.UserID, &enabled, &st.Order, &updated); err != nil {
			return fmt.Errorf("sync pull plugin states: %w", err)
		}
		scanned()
		st.Enabled = enabled != 0
		if st.UpdatedAt, err = parseTS(updated); err != nil {
			return err
		}
		if err := s.row(st); err != nil {
			return err
		}
	}
	if err := list.Err(); err != nil {
		return fmt.Errorf("sync pull plugin states: %w", err)
	}
	return nil
}

// errStopped ends a merge source whose consumer stopped early.
var errStopped = errors.New("sync: merge source stopped")

// mergeSource is one ordered source of the legacy view's merge as an
// iterator: run calls emit per row; emit fails once the consumer stops.
func mergeSource(run func(emit func(model.PluginData) error) error) iter.Seq2[model.PluginData, error] {
	return func(yield func(model.PluginData, error) bool) {
		err := run(func(d model.PluginData) error {
			scanned()
			if !yield(d, nil) {
				return errStopped
			}
			return nil
		})
		if err != nil && !errors.Is(err, errStopped) {
			yield(model.PluginData{}, err)
		}
	}
}

// legacyViewData is item 4's legacy view of pluginData: the caller's plugin
// rows (minus leftover qinqin-flashcards rows whose key a typed row holds)
// merged with every typed row as a legacy qinqin-flashcards row, in
// (updatedAt, plugin, key) order, plugin rows before typed rows and family
// before family on a tie (the order of the former sort). Each source is one
// query in that order, pulled one row at a time, so the merge holds one row
// per source.
func legacyViewData(ctx context.Context, s *legacyStream, sqlDB *sql.DB, userID int64, cursor time.Time) error {
	seqs := []iter.Seq2[model.PluginData, error]{mergeSource(func(emit func(model.PluginData) error) error {
		return plugins.EachData(ctx, sqlDB, userID, cursor, cursor.IsZero(), func(d *model.PluginData) error {
			if d.PluginID == rows.Namespace && d.WorkspaceID != nil {
				shadowed, err := study.HasTypedRow(ctx, sqlDB, userID, *d.WorkspaceID, d.Key)
				if err != nil {
					return fmt.Errorf("sync pull: %w", err)
				}
				if shadowed {
					return nil
				}
			}
			return emit(*d)
		})
	})}
	for _, f := range rows.Families {
		seqs = append(seqs, mergeSource(func(emit func(model.PluginData) error) error {
			return study.PullEach(ctx, sqlDB, userID, f, cursor, true, func(r rows.Row) error {
				return emit(study.LegacyRow(userID, r))
			})
		}))
	}
	type head struct {
		next func() (model.PluginData, error, bool)
		row  model.PluginData
		ok   bool
	}
	heads := make([]*head, len(seqs))
	for i, seq := range seqs {
		next, stop := iter.Pull2(seq)
		defer stop()
		heads[i] = &head{next: next}
	}
	advance := func(h *head) error {
		row, err, ok := h.next()
		if ok && err != nil {
			return err
		}
		h.row, h.ok = row, ok
		return nil
	}
	for _, h := range heads {
		if err := advance(h); err != nil {
			return err
		}
	}
	for {
		var best *head
		for _, h := range heads {
			if h.ok && (best == nil || legacyBefore(h.row, best.row)) {
				best = h
			}
		}
		if best == nil {
			return nil
		}
		if err := s.row(best.row); err != nil {
			return err
		}
		if err := advance(best); err != nil {
			return err
		}
	}
}

// legacyBefore is the legacy view's strict order of plugin rows.
func legacyBefore(a, b model.PluginData) bool {
	if !a.UpdatedAt.Equal(b.UpdatedAt) {
		return a.UpdatedAt.Before(b.UpdatedAt)
	}
	if a.PluginID != b.PluginID {
		return a.PluginID < b.PluginID
	}
	return a.Key < b.Key
}
