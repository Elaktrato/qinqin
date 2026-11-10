// Package entries stores dictionary entries — hanzi and words — and the
// links between them: variant pairs, radical classification, and
// word-character composition.
package entries

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"qinqin/internal/model"
	"qinqin/internal/pinyin"
)

// ErrNotFound reports an entry lookup that matched nothing: the id or
// (written, kind) key is unknown, or its row is soft-deleted.
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

// Upsert writes e keyed by (written, kind), reviving a soft-deleted row
// with the same key, and returns its id. It fills e.PinyinPlain from
// e.Pinyin via pinyin.Plain and e.Bopomofo via pinyin.ToBopomofo; pinyin
// that cannot be converted leaves Bopomofo empty and never fails the upsert.
func (s Store) Upsert(ctx context.Context, e *model.Entry) (int64, error) {
	e.PinyinPlain = pinyin.Plain(e.Pinyin)
	bopomofo, err := pinyin.ToBopomofo(e.Pinyin)
	if err != nil {
		bopomofo = ""
	}
	e.Bopomofo = bopomofo

	var id int64
	err = s.DB.QueryRowContext(ctx, `
		INSERT INTO entries (kind, written, pinyin, pinyin_plain, bopomofo, strokes, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (written, kind) DO UPDATE SET
			pinyin = excluded.pinyin,
			pinyin_plain = excluded.pinyin_plain,
			bopomofo = excluded.bopomofo,
			strokes = excluded.strokes,
			updated_at = excluded.updated_at,
			deleted_at = NULL
		RETURNING id`,
		e.Kind, e.Written, e.Pinyin, e.PinyinPlain, e.Bopomofo, e.Strokes, now()).
		Scan(&id)
	if err != nil {
		return 0, fmt.Errorf("upsert entry %q (%s): %w", e.Written, e.Kind, err)
	}
	return id, nil
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
	return e, nil
}

// GetByWritten returns the entry with the given written form and kind, or
// ErrNotFound when no active entry has them.
func (s Store) GetByWritten(ctx context.Context, written, kind string) (*model.Entry, error) {
	e, err := scanEntry(s.DB.QueryRowContext(ctx, entrySelect+`
		WHERE e.written = ? AND e.kind = ? AND e.deleted_at IS NULL`, written, kind))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get entry %q (%s): %w", written, kind, err)
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
	SELECT e.id, e.kind, e.written, e.pinyin, e.pinyin_plain, e.bopomofo,
	       e.strokes, e.updated_at, e.deleted_at, r.to_id
	FROM entries e
	LEFT JOIN entry_links r
	       ON r.from_id = e.id AND r.type = 'radical' AND r.deleted_at IS NULL`

// listEntries runs a query built on entrySelect and scans every row into
// an entry. It returns a non-nil (possibly empty) slice.
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
	return list, rows.Err()
}

// scanner is anything with a Scan method: *sql.Row and *sql.Rows.
type scanner interface {
	Scan(dest ...any) error
}

// scanEntry reads one row of entrySelect into an Entry, parsing the stored
// RFC 3339 timestamps and resolving the radical link into RadicalID.
func scanEntry(row scanner) (*model.Entry, error) {
	var (
		e         model.Entry
		radicalID sql.NullInt64
		updatedAt string
		deletedAt sql.NullString
	)
	if err := row.Scan(&e.ID, &e.Kind, &e.Written, &e.Pinyin, &e.PinyinPlain,
		&e.Bopomofo, &e.Strokes, &updatedAt, &deletedAt, &radicalID); err != nil {
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

// execer abstracts *sql.DB and *sql.Tx for link writes.
type execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// upsertLink inserts the link (from -> to, typ) or revives its soft-deleted
// row; an already-active link is only re-stamped. Linking twice never
// duplicates a row: (from, to, typ) is the primary key.
func upsertLink(ctx context.Context, db execer, from, to int64, typ, stamp string) error {
	_, err := db.ExecContext(ctx, `
		INSERT INTO entry_links (from_id, to_id, type, updated_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT (from_id, to_id, type) DO UPDATE SET
			deleted_at = NULL,
			updated_at = excluded.updated_at`,
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
