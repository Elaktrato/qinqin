package sync

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
)

// The lexicon pulls scan their table by updated_at (see migration 016);
// %s is the live fragment (liveOnly from the zero cursor, empty
// otherwise).
const (
	liveOnly = " AND deleted_at IS NULL"

	entriesQuery = `
		SELECT id, language, kind, ext_key, pri, uk, attrs, updated_at, deleted_at FROM lx_entries
		WHERE updated_at >= ?%s ORDER BY updated_at, id`
	sensesQuery = `
		SELECT id, dictionary_id, entry_id, ord, pos, tags, glosses, xrefs, updated_at, deleted_at FROM lx_senses
		WHERE updated_at >= ?%s ORDER BY updated_at, id`
	linksQuery = `
		SELECT from_id, to_id, type, updated_at, deleted_at FROM lx_links
		WHERE updated_at >= ?%s ORDER BY updated_at, from_id, to_id, type`
)

// childChunk is how many entry ids one IN (...) list binds.
const childChunk = 500

// pullEntries returns the lexicon entries changed since: the entry row
// itself changed, or — the lexicon restamps the entry then — one of its
// forms or readings did. Live entries ship with their live forms and
// readings; a tombstone ships bare.
func pullEntries(ctx context.Context, sqlDB *sql.DB, since, live string) ([]Entry, error) {
	rows, err := sqlDB.QueryContext(ctx, fmt.Sprintf(entriesQuery, live), since)
	if err != nil {
		return nil, fmt.Errorf("sync pull entries: %w", err)
	}
	defer rows.Close()
	list := make([]Entry, 0)
	for rows.Next() {
		e := Entry{Forms: []Form{}, Readings: []Reading{}}
		var uk int
		var attrs, updated string
		var deleted sql.NullString
		if err := rows.Scan(&e.ID, &e.Language, &e.Kind, &e.Key, &e.Pri, &uk, &attrs, &updated, &deleted); err != nil {
			return nil, fmt.Errorf("sync pull entries: %w", err)
		}
		e.UK = uk != 0
		if err := json.Unmarshal([]byte(attrs), &e.Attrs); err != nil {
			return nil, fmt.Errorf("sync pull entries: attrs of entry %d: %w", e.ID, err)
		}
		if e.Attrs == nil {
			e.Attrs = map[string]string{}
		}
		if e.UpdatedAt, err = parseTS(updated); err != nil {
			return nil, err
		}
		if e.DeletedAt, err = parseDeleted(deleted); err != nil {
			return nil, err
		}
		list = append(list, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("sync pull entries: %w", err)
	}
	if err := loadChildren(ctx, sqlDB, list); err != nil {
		return nil, err
	}
	return list, nil
}

// loadChildren fills the live forms and readings of the live entries.
func loadChildren(ctx context.Context, sqlDB *sql.DB, list []Entry) error {
	at := map[int64]*Entry{}
	var ids []any
	for i := range list {
		if list[i].DeletedAt == nil {
			at[list[i].ID] = &list[i]
			ids = append(ids, list[i].ID)
		}
	}
	for start := 0; start < len(ids); start += childChunk {
		chunk := ids[start:min(start+childChunk, len(ids))]
		in := strings.TrimSuffix(strings.Repeat("?,", len(chunk)), ",")

		rows, err := sqlDB.QueryContext(ctx, `
			SELECT entry_id, text, ord, flags, pri FROM lx_forms
			WHERE entry_id IN (`+in+`) AND deleted_at IS NULL ORDER BY entry_id, ord, id`, chunk...)
		if err != nil {
			return fmt.Errorf("sync pull forms: %w", err)
		}
		for rows.Next() {
			var id int64
			var f Form
			var flags string
			if err := rows.Scan(&id, &f.Text, &f.Ord, &flags, &f.Pri); err != nil {
				rows.Close()
				return fmt.Errorf("sync pull forms: %w", err)
			}
			if f.Flags, err = decodeList(flags); err != nil {
				rows.Close()
				return fmt.Errorf("sync pull forms: %w", err)
			}
			at[id].Forms = append(at[id].Forms, f)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return fmt.Errorf("sync pull forms: %w", err)
		}

		rows, err = sqlDB.QueryContext(ctx, `
			SELECT entry_id, type, value, plain, ord, flags, pri FROM lx_readings
			WHERE entry_id IN (`+in+`) AND deleted_at IS NULL ORDER BY entry_id, ord, id`, chunk...)
		if err != nil {
			return fmt.Errorf("sync pull readings: %w", err)
		}
		for rows.Next() {
			var id int64
			var r Reading
			var flags string
			if err := rows.Scan(&id, &r.Type, &r.Value, &r.Plain, &r.Ord, &flags, &r.Pri); err != nil {
				rows.Close()
				return fmt.Errorf("sync pull readings: %w", err)
			}
			if r.Flags, err = decodeList(flags); err != nil {
				rows.Close()
				return fmt.Errorf("sync pull readings: %w", err)
			}
			at[id].Readings = append(at[id].Readings, r)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return fmt.Errorf("sync pull readings: %w", err)
		}
	}
	return nil
}

// decodeList parses a JSON text column into a non-nil string slice.
func decodeList(raw string) ([]string, error) {
	var l []string
	if err := json.Unmarshal([]byte(raw), &l); err != nil {
		return nil, fmt.Errorf("decode %q: %w", raw, err)
	}
	if l == nil {
		l = []string{}
	}
	return l, nil
}

// pullSenses returns the lexicon senses changed since, by their own
// stamps: a sense of an uninstalled dictionary is a tombstone.
func pullSenses(ctx context.Context, sqlDB *sql.DB, since, live string) ([]Sense, error) {
	rows, err := sqlDB.QueryContext(ctx, fmt.Sprintf(sensesQuery, live), since)
	if err != nil {
		return nil, fmt.Errorf("sync pull senses: %w", err)
	}
	defer rows.Close()
	list := make([]Sense, 0)
	for rows.Next() {
		var s Sense
		var pos, tags, glosses, xrefs, updated string
		var deleted sql.NullString
		if err := rows.Scan(&s.ID, &s.DictionaryID, &s.EntryID, &s.Ord, &pos, &tags, &glosses, &xrefs, &updated, &deleted); err != nil {
			return nil, fmt.Errorf("sync pull senses: %w", err)
		}
		for _, l := range []struct {
			raw string
			dst *[]string
		}{{pos, &s.POS}, {tags, &s.Tags}, {glosses, &s.Glosses}, {xrefs, &s.Xrefs}} {
			if *l.dst, err = decodeList(l.raw); err != nil {
				return nil, fmt.Errorf("sync pull senses: sense %d: %w", s.ID, err)
			}
		}
		if s.UpdatedAt, err = parseTS(updated); err != nil {
			return nil, err
		}
		if s.DeletedAt, err = parseDeleted(deleted); err != nil {
			return nil, err
		}
		list = append(list, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("sync pull senses: %w", err)
	}
	return dropSupersededTombstones(list), nil
}

// senseKey is what a client keys a sense by.
type senseKey struct {
	entry, dictionary int64
	ord               int
}

// dropSupersededTombstones removes the sense tombstones that have a live
// sense at the same (entry, dictionary, ord) in the same delta. The
// lexicon retires a dictionary's senses of an entry and re-inserts them
// under one stamp, so a changed sense arrives as a tombstone plus its
// live replacement; a client that applies deletes after upserts, or
// keeps a map by key, would otherwise lose the live sense. Every other
// tombstone (a removed sense, an uninstalled dictionary) stays.
func dropSupersededTombstones(list []Sense) []Sense {
	live := map[senseKey]bool{}
	for _, s := range list {
		if s.DeletedAt == nil {
			live[senseKey{s.EntryID, s.DictionaryID, s.Ord}] = true
		}
	}
	return slices.DeleteFunc(list, func(s Sense) bool {
		return s.DeletedAt != nil && live[senseKey{s.EntryID, s.DictionaryID, s.Ord}]
	})
}

// pullLinks returns the lexicon links changed since.
func pullLinks(ctx context.Context, sqlDB *sql.DB, since, live string) ([]Link, error) {
	rows, err := sqlDB.QueryContext(ctx, fmt.Sprintf(linksQuery, live), since)
	if err != nil {
		return nil, fmt.Errorf("sync pull links: %w", err)
	}
	defer rows.Close()
	list := make([]Link, 0)
	for rows.Next() {
		var l Link
		var updated string
		var deleted sql.NullString
		if err := rows.Scan(&l.FromID, &l.ToID, &l.Type, &updated, &deleted); err != nil {
			return nil, fmt.Errorf("sync pull links: %w", err)
		}
		if l.UpdatedAt, err = parseTS(updated); err != nil {
			return nil, err
		}
		if l.DeletedAt, err = parseDeleted(deleted); err != nil {
			return nil, err
		}
		list = append(list, l)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("sync pull links: %w", err)
	}
	return list, nil
}
