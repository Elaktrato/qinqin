// Package entries stores dictionary entries — characters and words in any
// language — and the links between them: variant pairs, radical
// classification, and word-character composition.
package entries

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"qinqin/internal/lang"
	"qinqin/internal/model"
)

// ErrNotFound reports an entry lookup that matched nothing: the id or
// (written, kind, language) key is unknown, or its row is soft-deleted.
var ErrNotFound = errors.New("entry not found")

// Link types stored in entry_links. Variant links are stored in both
// directions so reads are symmetric; radical and wordchar links are
// directional (character to its radical, word to its characters).
const (
	linkVariant  = "variant"
	linkRadical  = "radical"
	linkWordChar = "wordchar"
)

// Store reads and writes entries and entry links on a SQLite database.
type Store struct {
	DB *sql.DB
}

// Upsert writes e keyed by (written, kind, language), reviving a
// soft-deleted row with the same key, and returns its id. Each reading's
// Plain is filled via the entry's language pack, which also derives extra
// readings (zh appends bopomofo from pinyin) and never fails on
// unconvertible input; ord is the reading's position among the entry's
// readings. Readings replace wholesale — superseded rows are soft-deleted
// and the new list inserted — and attrs persist as child rows keyed by
// (entry_id, key).
func (s Store) Upsert(ctx context.Context, e *model.Entry) (int64, error) {
	pack := lang.For(e.Language)
	normalizeReadings(e.Readings, pack)
	e.Readings = pack.DeriveReadings(e.Readings)
	normalizeReadings(e.Readings, pack)

	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("upsert entry %q (%s/%s): %w", e.Written, e.Kind, e.Language, err)
	}
	defer tx.Rollback()
	stamp := now()

	// Upserting what is already stored writes nothing: a re-import of an
	// unchanged pack must not re-stamp entries (every client would pull
	// them again) or churn tombstones. changed tracks whether anything
	// about the entry — its row, readings, or attrs — actually differs;
	// the entry is stamped once if so, which is what the sync pull reads
	// to ship its children.
	var (
		id      int64
		deleted sql.NullString
		changed bool
	)
	err = tx.QueryRowContext(ctx, `
		SELECT id, deleted_at FROM entries
		WHERE written = ? AND kind = ? AND language = ?`,
		e.Written, e.Kind, e.Language).Scan(&id, &deleted)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		if err := tx.QueryRowContext(ctx, `
			INSERT INTO entries (language, kind, written, updated_at)
			VALUES (?, ?, ?, ?)
			RETURNING id`,
			e.Language, e.Kind, e.Written, stamp).Scan(&id); err != nil {
			return 0, fmt.Errorf("upsert entry %q (%s/%s): %w", e.Written, e.Kind, e.Language, err)
		}
		changed = true // inserted already carries the stamp; the UPDATE below is a harmless no-op
	case err != nil:
		return 0, fmt.Errorf("upsert entry %q (%s/%s): %w", e.Written, e.Kind, e.Language, err)
	case deleted.Valid:
		changed = true // reviving a soft-deleted entry
	}

	// Readings replace wholesale, but only when the list differs from the
	// stored one: superseded rows are soft-deleted, then the new list
	// inserted, so an entry's active readings are always exactly its
	// latest upsert and a reading that drops off leaves a tombstone.
	same, err := readingsMatch(ctx, tx, id, e.Readings)
	if err != nil {
		return 0, fmt.Errorf("compare readings of entry %q: %w", e.Written, err)
	}
	if !same {
		changed = true
		if _, err := tx.ExecContext(ctx, `
			UPDATE readings SET deleted_at = ?, updated_at = ?
			WHERE entry_id = ? AND deleted_at IS NULL`,
			stamp, stamp, id); err != nil {
			return 0, fmt.Errorf("retire readings of entry %q: %w", e.Written, err)
		}
		for i, r := range e.Readings {
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO readings (entry_id, type, value, plain, ord, updated_at)
				VALUES (?, ?, ?, ?, ?, ?)`,
				id, r.Type, r.Value, r.Plain, i, stamp); err != nil {
				return 0, fmt.Errorf("insert reading %d of entry %q: %w", i, e.Written, err)
			}
		}
	}

	// Attrs merge: only keys whose value differs (or is new) are written.
	for k, v := range e.Attrs {
		res, err := tx.ExecContext(ctx, `
			INSERT INTO entry_attrs (entry_id, key, value, updated_at)
			VALUES (?, ?, ?, ?)
			ON CONFLICT (entry_id, key) DO UPDATE SET
				value = excluded.value,
				updated_at = excluded.updated_at
			WHERE entry_attrs.value IS NOT excluded.value`,
			id, k, v, stamp)
		if err != nil {
			return 0, fmt.Errorf("upsert attr %q of entry %q: %w", k, e.Written, err)
		}
		if n, _ := res.RowsAffected(); n > 0 {
			changed = true
		}
	}

	if changed {
		if _, err := tx.ExecContext(ctx, `
			UPDATE entries SET updated_at = ?, deleted_at = NULL WHERE id = ?`,
			stamp, id); err != nil {
			return 0, fmt.Errorf("stamp entry %q: %w", e.Written, err)
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("upsert entry %q (%s/%s): %w", e.Written, e.Kind, e.Language, err)
	}
	e.ID = id
	return id, nil
}

// GetMany returns the active entries with the given ids, in the order the
// ids appear, silently skipping ids that are unknown or soft-deleted. It
// returns a non-nil (possibly empty) slice.
func (s Store) GetMany(ctx context.Context, ids []int64) ([]model.Entry, error) {
	list := make([]model.Entry, 0, len(ids))
	if len(ids) == 0 {
		return list, nil
	}

	// Query each distinct id once, in chunks within SQLite's bound-variable
	// budget, then put the entries back in the caller's order.
	byID := make(map[int64]model.Entry, len(ids))
	uniq := make([]int64, 0, len(ids))
	seen := make(map[int64]bool, len(ids))
	for _, id := range ids {
		if seen[id] {
			continue
		}
		seen[id] = true
		uniq = append(uniq, id)
	}
	for start := 0; start < len(uniq); start += childChunk {
		end := min(start+childChunk, len(uniq))
		chunk := uniq[start:end]
		args := make([]any, len(chunk))
		for i, id := range chunk {
			args[i] = id
		}
		es, err := s.listEntries(ctx, entrySelect+`
			WHERE e.id IN (`+placeholders(len(chunk))+`) AND e.deleted_at IS NULL`, args...)
		if err != nil {
			return nil, fmt.Errorf("get entries: %w", err)
		}
		for _, e := range es {
			byID[e.ID] = e
		}
	}
	for _, id := range ids {
		if e, ok := byID[id]; ok {
			list = append(list, e)
		}
	}
	return list, nil
}

// EntriesByWritten returns the active entries of a language whose written
// form is one of writtens, grouped by written form. Forms without an entry
// are absent from the map. Readings and attrs are attached as usual.
func (s Store) EntriesByWritten(ctx context.Context, language string, writtens []string) (map[string][]model.Entry, error) {
	out := make(map[string][]model.Entry)
	for start := 0; start < len(writtens); start += childChunk {
		chunk := writtens[start:min(start+childChunk, len(writtens))]
		args := make([]any, 0, len(chunk)+1)
		args = append(args, language)
		for _, w := range chunk {
			args = append(args, w)
		}
		es, err := s.listEntries(ctx, entrySelect+`
			WHERE e.language = ? AND e.written IN (`+placeholders(len(chunk))+`)
			  AND e.deleted_at IS NULL
			ORDER BY e.id`, args...)
		if err != nil {
			return nil, fmt.Errorf("entries by written: %w", err)
		}
		for _, e := range es {
			out[e.Written] = append(out[e.Written], e)
		}
	}
	return out, nil
}

// ReadingHit is one entry found by a reading: its id, kind and written
// form, and Ord, the position of the matched reading among the entry's
// readings (0 = its first reading).
type ReadingHit struct {
	ID      int64
	Kind    string
	Written string
	Ord     int
}

// EntriesByReading returns the active entries of a language that carry an
// active reading of type readType whose plain (normalized) form is one of
// plains, grouped by plain form. Within a group, entries for which the
// reading is the first one come first, then by ascending ord, ties by
// entry id. Forms without a hit are absent from the map.
func (s Store) EntriesByReading(ctx context.Context, language, readType string, plains []string) (map[string][]ReadingHit, error) {
	out := make(map[string][]ReadingHit)
	for start := 0; start < len(plains); start += childChunk {
		chunk := plains[start:min(start+childChunk, len(plains))]
		args := make([]any, 0, len(chunk)+2)
		args = append(args, language, readType)
		for _, p := range chunk {
			args = append(args, p)
		}
		rows, err := s.DB.QueryContext(ctx, `
			SELECT r.plain, e.id, e.kind, e.written, MIN(r.ord) AS ord
			FROM readings r
			JOIN entries e ON e.id = r.entry_id
			WHERE e.language = ? AND e.deleted_at IS NULL
			  AND r.deleted_at IS NULL AND r.type = ?
			  AND r.plain IN (`+placeholders(len(chunk))+`)
			GROUP BY r.plain, e.id
			ORDER BY r.plain, ord, e.id`, args...)
		if err != nil {
			return nil, fmt.Errorf("entries by reading: %w", err)
		}
		for rows.Next() {
			var (
				plain string
				h     ReadingHit
			)
			if err := rows.Scan(&plain, &h.ID, &h.Kind, &h.Written, &h.Ord); err != nil {
				rows.Close()
				return nil, fmt.Errorf("entries by reading: %w", err)
			}
			out[plain] = append(out[plain], h)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, fmt.Errorf("entries by reading: %w", err)
		}
	}
	return out, nil
}

// GetByID returns the entry with the given id, or ErrNotFound when no
// active entry has it.
func (s Store) GetByID(ctx context.Context, id int64) (*model.Entry, error) {
	e, err := scanEntry(s.DB.QueryRowContext(ctx, entrySelect+`
		WHERE e.id = ? AND e.deleted_at IS NULL`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get entry %d: %w", id, err)
	}
	if err := s.attachChildren(ctx, []*model.Entry{e}); err != nil {
		return nil, fmt.Errorf("get entry %d: %w", id, err)
	}
	return e, nil
}

// GetByWritten returns the entry with the given written form, kind, and
// language, or ErrNotFound when no active entry has them.
func (s Store) GetByWritten(ctx context.Context, written, kind, language string) (*model.Entry, error) {
	e, err := scanEntry(s.DB.QueryRowContext(ctx, entrySelect+`
		WHERE e.written = ? AND e.kind = ? AND e.language = ? AND e.deleted_at IS NULL`,
		written, kind, language))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get entry %q (%s/%s): %w", written, kind, language, err)
	}
	if err := s.attachChildren(ctx, []*model.Entry{e}); err != nil {
		return nil, fmt.Errorf("get entry %q (%s/%s): %w", written, kind, language, err)
	}
	return e, nil
}

// LinkVariant links idA and idB as variants of each other. Both directions
// are stored so reads are symmetric, and linking an existing pair again is
// a no-op.
func (s Store) LinkVariant(ctx context.Context, idA, idB int64) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("link variants %d/%d: %w", idA, idB, err)
	}
	defer tx.Rollback()
	stamp := now()
	if err := upsertLink(ctx, tx, idA, idB, linkVariant, stamp); err != nil {
		return err
	}
	if err := upsertLink(ctx, tx, idB, idA, linkVariant, stamp); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("link variants %d/%d: %w", idA, idB, err)
	}
	return nil
}

// Variants returns the active entries linked to id as variants.
func (s Store) Variants(ctx context.Context, id int64) ([]model.Entry, error) {
	vs, err := s.listEntries(ctx, entrySelect+`
		JOIN entry_links l ON l.from_id = ? AND l.to_id = e.id
			AND l.type = 'variant' AND l.deleted_at IS NULL
		WHERE e.deleted_at IS NULL
		ORDER BY e.written`, id)
	if err != nil {
		return nil, fmt.Errorf("variants of %d: %w", id, err)
	}
	return vs, nil
}

// SetRadical classifies the character entry charID under the radical entry
// radicalID. A character has one radical, so any previous classification
// is soft-deleted first.
func (s Store) SetRadical(ctx context.Context, charID, radicalID int64) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("set radical of %d to %d: %w", charID, radicalID, err)
	}
	defer tx.Rollback()
	stamp := now()
	if _, err := tx.ExecContext(ctx, `
		UPDATE entry_links SET deleted_at = ?, updated_at = ?
		WHERE from_id = ? AND type = 'radical' AND deleted_at IS NULL AND to_id <> ?`,
		stamp, stamp, charID, radicalID); err != nil {
		return fmt.Errorf("retire radical of %d: %w", charID, err)
	}
	if err := upsertLink(ctx, tx, charID, radicalID, linkRadical, stamp); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("set radical of %d to %d: %w", charID, radicalID, err)
	}
	return nil
}

// CharsUnder returns the active character entries classified under the
// radical entry radicalID.
func (s Store) CharsUnder(ctx context.Context, radicalID int64) ([]model.Entry, error) {
	cs, err := s.listEntries(ctx, entrySelect+`
		WHERE r.to_id = ? AND e.deleted_at IS NULL
		ORDER BY e.written`, radicalID)
	if err != nil {
		return nil, fmt.Errorf("chars under radical %d: %w", radicalID, err)
	}
	return cs, nil
}

// Senses returns the active senses of the entry, each with its active
// dictionary, ordered by dictionary id then the sense's ord within that
// dictionary. It returns a non-nil (possibly empty) slice.
func (s Store) Senses(ctx context.Context, entryID int64) ([]model.SenseView, error) {
	rows, err := s.DB.QueryContext(ctx, `
		SELECT d.id, d.name, d.pack_id, d.license, d.attribution, s.gloss
		FROM senses s
		JOIN dictionaries d ON d.id = s.dictionary_id
		WHERE s.entry_id = ? AND s.deleted_at IS NULL AND d.deleted_at IS NULL
		ORDER BY d.id, s.ord`, entryID)
	if err != nil {
		return nil, fmt.Errorf("senses of %d: %w", entryID, err)
	}
	defer rows.Close()

	list := make([]model.SenseView, 0)
	for rows.Next() {
		var v model.SenseView
		if err := rows.Scan(&v.DictionaryID, &v.DictionaryName, &v.PackID,
			&v.License, &v.Attribution, &v.Gloss); err != nil {
			return nil, fmt.Errorf("senses of %d: %w", entryID, err)
		}
		list = append(list, v)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("senses of %d: %w", entryID, err)
	}
	return list, nil
}

// LinkWordChar records that the word entry wordID is written with the
// character entry charID. Linking an existing pair again is a no-op.
func (s Store) LinkWordChar(ctx context.Context, wordID, charID int64) error {
	return upsertLink(ctx, s.DB, wordID, charID, linkWordChar, now())
}

// WordsContaining returns the active word entries written with the
// character entry charID.
func (s Store) WordsContaining(ctx context.Context, charID int64) ([]model.Entry, error) {
	ws, err := s.listEntries(ctx, entrySelect+`
		JOIN entry_links l ON l.from_id = e.id AND l.to_id = ?
			AND l.type = 'wordchar' AND l.deleted_at IS NULL
		WHERE e.deleted_at IS NULL
		ORDER BY e.written`, charID)
	if err != nil {
		return nil, fmt.Errorf("words containing %d: %w", charID, err)
	}
	return ws, nil
}

// entrySelect selects an entry plus the id of the radical it is classified
// under, reached through its active radical link. SetRadical keeps at most
// one active radical link per character, so the join never fans out.
const entrySelect = `
	SELECT e.id, e.language, e.kind, e.written, e.updated_at, e.deleted_at, r.to_id
	FROM entries e
	LEFT JOIN entry_links r
	       ON r.from_id = e.id AND r.type = 'radical' AND r.deleted_at IS NULL`

// listEntries runs a query built on entrySelect and scans every row into
// an entry with its readings and attrs. It returns a non-nil (possibly
// empty) slice.
func (s Store) listEntries(ctx context.Context, query string, args ...any) ([]model.Entry, error) {
	rows, err := s.DB.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := make([]model.Entry, 0)
	for rows.Next() {
		e, err := scanEntry(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, *e)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	byID := make([]*model.Entry, len(list))
	for i := range list {
		byID[i] = &list[i]
	}
	if err := s.attachChildren(ctx, byID); err != nil {
		return nil, err
	}
	return list, nil
}

// scanner is anything with a Scan method: *sql.Row and *sql.Rows.
type scanner interface {
	Scan(dest ...any) error
}

// scanEntry reads one row of entrySelect into an Entry, parsing the stored
// RFC 3339 timestamps and resolving the radical link into RadicalID.
// Readings and attrs are left zero; attachChildren fills them.
func scanEntry(row scanner) (*model.Entry, error) {
	var (
		e         model.Entry
		radicalID sql.NullInt64
		updatedAt string
		deletedAt sql.NullString
	)
	if err := row.Scan(&e.ID, &e.Language, &e.Kind, &e.Written,
		&updatedAt, &deletedAt, &radicalID); err != nil {
		return nil, err
	}
	updated, err := time.Parse(time.RFC3339, updatedAt)
	if err != nil {
		return nil, fmt.Errorf("parse updated_at %q of entry %d: %w", updatedAt, e.ID, err)
	}
	e.UpdatedAt = updated
	if deletedAt.Valid {
		deleted, err := time.Parse(time.RFC3339, deletedAt.String)
		if err != nil {
			return nil, fmt.Errorf("parse deleted_at %q of entry %d: %w", deletedAt.String, e.ID, err)
		}
		e.DeletedAt = &deleted
	}
	if radicalID.Valid {
		id := radicalID.Int64
		e.RadicalID = &id
	}
	return &e, nil
}

// attachChildren loads every entry's readings and attrs, replacing the
// zero values left by scanEntry. Entries without children get an empty
// reading slice and an empty attrs map, so they marshal as [] and {}.
func (s Store) attachChildren(ctx context.Context, es []*model.Entry) error {
	for _, e := range es {
		e.Readings = []model.Reading{}
		e.Attrs = map[string]string{}
	}
	// SQLite caps bound variables per statement, so children load in
	// chunks of ids.
	for start := 0; start < len(es); start += childChunk {
		end := min(start+childChunk, len(es))
		if err := s.attachChunk(ctx, es[start:end]); err != nil {
			return err
		}
	}
	return nil
}

// childChunk is how many entry ids one children query binds.
const childChunk = 500

// attachChunk loads the readings and attrs of one chunk of entries.
func (s Store) attachChunk(ctx context.Context, es []*model.Entry) error {
	byID := make(map[int64]*model.Entry, len(es))
	ids := make([]any, len(es))
	for i, e := range es {
		byID[e.ID] = e
		ids[i] = e.ID
	}
	placeHolders := placeholders(len(es))

	rows, err := s.DB.QueryContext(ctx, `
		SELECT entry_id, type, value, plain, ord FROM readings
		WHERE entry_id IN (`+placeHolders+`) AND deleted_at IS NULL
		ORDER BY entry_id, ord`, ids...)
	if err != nil {
		return fmt.Errorf("load readings: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			entryID int64
			r       model.Reading
		)
		if err := rows.Scan(&entryID, &r.Type, &r.Value, &r.Plain, &r.Ord); err != nil {
			return fmt.Errorf("load readings: %w", err)
		}
		byID[entryID].Readings = append(byID[entryID].Readings, r)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("load readings: %w", err)
	}

	attrRows, err := s.DB.QueryContext(ctx, `
		SELECT entry_id, key, value FROM entry_attrs
		WHERE entry_id IN (`+placeHolders+`)`, ids...)
	if err != nil {
		return fmt.Errorf("load attrs: %w", err)
	}
	defer attrRows.Close()
	for attrRows.Next() {
		var (
			entryID int64
			k, v    string
		)
		if err := attrRows.Scan(&entryID, &k, &v); err != nil {
			return fmt.Errorf("load attrs: %w", err)
		}
		byID[entryID].Attrs[k] = v
	}
	return attrRows.Err()
}

// placeholders returns n comma-separated SQL parameter placeholders.
func placeholders(n int) string {
	return strings.TrimSuffix(strings.Repeat("?,", n), ",")
}

// queryer is anything that can run a query: *sql.DB and *sql.Tx.
type queryer interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

// readingsMatch reports whether the entry's active readings are exactly
// want: same type, value, and plain form, in the same order.
func readingsMatch(ctx context.Context, db queryer, entryID int64, want []model.Reading) (bool, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT type, value, plain FROM readings
		WHERE entry_id = ? AND deleted_at IS NULL ORDER BY ord, id`, entryID)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	i := 0
	for rows.Next() {
		var typ, value, plain string
		if err := rows.Scan(&typ, &value, &plain); err != nil {
			return false, err
		}
		if i >= len(want) || want[i].Type != typ || want[i].Value != value || want[i].Plain != plain {
			return false, nil
		}
		i++
	}
	if err := rows.Err(); err != nil {
		return false, err
	}
	return i == len(want), nil
}

// normalizeReadings fills each reading's Plain via pack and stamps its
// position among the entry's readings.
func normalizeReadings(rs []model.Reading, pack lang.Pack) {
	for i := range rs {
		rs[i].Plain = pack.NormalizeReading(rs[i].Type, rs[i].Value)
		rs[i].Ord = i
	}
}

// execer abstracts *sql.DB and *sql.Tx for link writes.
type execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// upsertLink inserts the link (from -> to, typ) or revives its soft-deleted
// row; an already-active link is left untouched — re-linking must not
// re-stamp it, or every re-import would ship every link again. Linking
// twice never duplicates a row: (from, to, typ) is the primary key.
func upsertLink(ctx context.Context, db execer, from, to int64, typ, stamp string) error {
	_, err := db.ExecContext(ctx, `
		INSERT INTO entry_links (from_id, to_id, type, updated_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT (from_id, to_id, type) DO UPDATE SET
			deleted_at = NULL,
			updated_at = excluded.updated_at
		WHERE entry_links.deleted_at IS NOT NULL`,
		from, to, typ, stamp)
	if err != nil {
		return fmt.Errorf("upsert %s link %d->%d: %w", typ, from, to, err)
	}
	return nil
}

// now returns the server clock as UTC RFC 3339, the timestamp convention
// for every write.
func now() string {
	return time.Now().UTC().Format(time.RFC3339)
}
