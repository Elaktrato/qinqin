package dict

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"qinqin/internal/entries"
	"qinqin/internal/lang"
	"qinqin/internal/model"
)

// ErrNotDictionary reports an Import on a pack whose manifest type is
// not "dictionary": the generic import pipeline installs dictionaries
// only — level and sentence packs import through their own importers.
var ErrNotDictionary = errors.New("dict: manifest type is not \"dictionary\"")

// ErrNotFound reports an uninstall of an unknown dictionary.
var ErrNotFound = errors.New("dictionary not found")

// dictionaryFile is the data file of a format "json" dictionary pack.
const dictionaryFile = "dictionary.json"

// Result counts what one dictionary import wrote.
type Result struct {
	Entries int // the pack's entries upserted, traditional forms included; bare character entries created only to link words to their hanzi are not counted
	Senses  int // sense rows inserted for the dictionary
}

// senseRow is one sense to insert: a gloss at its position for one
// entry.
type senseRow struct {
	entryID int64
	gloss   string
	ord     int
}

// Import installs the dictionary pack: it upserts the pack's entries —
// readings normalize and derive through the language pack, inside the
// entry upsert — and replaces the dictionary's senses with the pack's
// glosses. A cedict pack reads dictionary.txt: its tone-numbered pinyin
// becomes the marked pinyin reading, and every word entry — its
// traditional twin included — links to a character entry for each
// distinct hanzi it is written with, upserting bare character entries
// where the dictionary has none. A unihan pack instead installs the
// built-in Unihan database (see importUnihan). A language code without a
// registered code pack auto-registers as a data-only language named from
// the manifest; a registered code (zh, ja) gets no language row. Imports
// key on the manifest id: the dictionary row is upserted (reviving an
// uninstalled one) and its senses replaced — old rows tombstoned, new
// rows inserted — without ever removing entries or user data.
func Import(ctx context.Context, sqlDB *sql.DB, pack Pack) (Result, error) {
	m := pack.Manifest
	m.normalize()
	if err := m.Validate(); err != nil {
		return Result{}, fmt.Errorf("%w: %v", ErrInvalidPack, err)
	}
	if m.Type != TypeDictionary {
		return Result{}, fmt.Errorf("%w: %q is a %s pack", ErrNotDictionary, m.ID, m.Type)
	}
	var es []entry
	switch m.Format {
	case FormatJSON:
		parsed, err := readJSONPack(pack.Dir)
		if err != nil {
			return Result{}, err
		}
		es = parsed
	case FormatCedict:
		parsed, err := readCedictPack(pack.Dir)
		if err != nil {
			return Result{}, err
		}
		es = parsed
	case FormatUnihan:
		data, err := readUnihanPack(pack.Dir)
		if err != nil {
			return Result{}, err
		}
		return importUnihan(ctx, sqlDB, m, data)
	default:
		return Result{}, fmt.Errorf("%w: dictionary format %q is not implemented", ErrInvalidPack, m.Format)
	}

	// A language code without a registered code pack auto-registers as a
	// data-only language; code packs (zh, ja) live in code, not in the
	// table.
	if err := registerLanguage(ctx, sqlDB, m); err != nil {
		return Result{}, err
	}

	// Entries upsert through the entries store, each in its own
	// transaction; readings normalize and derive there.
	store := entries.Store{DB: sqlDB}
	var (
		senses []senseRow
		result Result
	)
	for _, e := range es {
		id, err := store.Upsert(ctx, &model.Entry{
			Language: m.Language,
			Kind:     e.Kind,
			Written:  e.Written,
			Readings: e.readings(),
		})
		if err != nil {
			return Result{}, fmt.Errorf("import dictionary %s: %w", m.ID, err)
		}
		result.Entries++
		senses = append(senses, e.sensesFor(id)...)

		// A differing traditional form is its own entry, linked to the
		// base as a variant; both forms carry the readings and glosses.
		var tradID int64
		if e.Trad != "" && e.Trad != e.Written {
			tradID, err = store.Upsert(ctx, &model.Entry{
				Language: m.Language,
				Kind:     e.Kind,
				Written:  e.Trad,
				Readings: e.readings(),
			})
			if err != nil {
				return Result{}, fmt.Errorf("import dictionary %s: %w", m.ID, err)
			}
			result.Entries++
			if err := store.LinkVariant(ctx, id, tradID); err != nil {
				return Result{}, fmt.Errorf("import dictionary %s: %w", m.ID, err)
			}
			senses = append(senses, e.sensesFor(tradID)...)
		}

		// A cedict word links to a character entry for every distinct
		// hanzi in each of its written forms — the simplified entry and
		// its traditional twin alike — so words are findable by their
		// characters.
		if m.Format == FormatCedict && e.Kind == "word" {
			forms := []wordForm{{id: id, written: e.Written}}
			if tradID != 0 {
				forms = append(forms, wordForm{id: tradID, written: e.Trad})
			}
			for _, form := range forms {
				if err := linkWordChars(ctx, store, m.Language, form.written, form.id); err != nil {
					return Result{}, fmt.Errorf("import dictionary %s: %w", m.ID, err)
				}
			}
		}
	}

	// One transaction registers the dictionary and replaces its senses:
	// the previous senses are tombstoned and the new list inserted, so a
	// re-import swaps a dictionary's glosses atomically, scoped to that
	// dictionary alone.
	if _, err := replaceSenses(ctx, sqlDB, m.ID, m.Name, m.Version, m.License, m.Attribution, senses); err != nil {
		return Result{}, err
	}
	result.Senses = len(senses)
	return result, nil
}

// registerLanguage auto-registers the manifest's language as a data-only
// language when no code pack is registered for it; code packs (zh, ja)
// live in code, not in the table.
func registerLanguage(ctx context.Context, sqlDB *sql.DB, m Manifest) error {
	if lang.Registered(m.Language) {
		return nil
	}
	if _, err := sqlDB.ExecContext(ctx, `
		INSERT INTO languages (code, name, updated_at) VALUES (?, ?, ?)
		ON CONFLICT (code) DO NOTHING`,
		m.Language, m.Name, now()); err != nil {
		return fmt.Errorf("register language %s: %w", m.Language, err)
	}
	return nil
}

// replaceSenses registers or revives the dictionary keyed by packID in
// one transaction and replaces its senses: the previous senses are
// tombstoned and the new list inserted, so a re-import swaps a
// dictionary's glosses atomically, scoped to that dictionary alone. It
// returns the dictionary's row id.
func replaceSenses(ctx context.Context, sqlDB *sql.DB, packID, name, version, license, attribution string, senses []senseRow) (int64, error) {
	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("register dictionary %s: %w", packID, err)
	}
	defer tx.Rollback()
	stamp := now()
	var dictID int64
	if err := tx.QueryRowContext(ctx, `
		INSERT INTO dictionaries (pack_id, name, version, license, attribution, updated_at)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT (pack_id) DO UPDATE SET
			name = excluded.name,
			version = excluded.version,
			license = excluded.license,
			attribution = excluded.attribution,
			updated_at = excluded.updated_at,
			deleted_at = NULL
		RETURNING id`,
		packID, name, version, license, attribution, stamp).Scan(&dictID); err != nil {
		return 0, fmt.Errorf("register dictionary %s: %w", packID, err)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE senses SET deleted_at = ?, updated_at = ?
		WHERE dictionary_id = ? AND deleted_at IS NULL`,
		stamp, stamp, dictID); err != nil {
		return 0, fmt.Errorf("replace senses of dictionary %s: %w", packID, err)
	}
	for _, s := range senses {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO senses (dictionary_id, entry_id, gloss, ord, updated_at)
			VALUES (?, ?, ?, ?, ?)`,
			dictID, s.entryID, s.gloss, s.ord, stamp); err != nil {
			return 0, fmt.Errorf("insert sense of dictionary %s: %w", packID, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("import dictionary %s: %w", packID, err)
	}
	return dictID, nil
}

// Uninstall soft-deletes the dictionary with row id id and all of its
// senses. Entries survive — other dictionaries and user data reference
// them — and re-importing the pack revives both. An unknown or already
// uninstalled dictionary returns ErrNotFound.
func Uninstall(ctx context.Context, sqlDB *sql.DB, id int64) error {
	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("uninstall dictionary %d: %w", id, err)
	}
	defer tx.Rollback()
	stamp := now()
	if _, err := tx.ExecContext(ctx, `
		UPDATE senses SET deleted_at = ?, updated_at = ?
		WHERE dictionary_id = ? AND deleted_at IS NULL`,
		stamp, stamp, id); err != nil {
		return fmt.Errorf("uninstall senses of dictionary %d: %w", id, err)
	}
	res, err := tx.ExecContext(ctx, `
		UPDATE dictionaries SET deleted_at = ?, updated_at = ?
		WHERE id = ? AND deleted_at IS NULL`,
		stamp, stamp, id)
	if err != nil {
		return fmt.Errorf("uninstall dictionary %d: %w", id, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("uninstall dictionary %d: %w", id, err)
	}
	if n == 0 {
		return ErrNotFound
	}
	return tx.Commit()
}

// RawEntry is one entry of a native-format dictionary source — a
// written form, its optional traditional variant, a pronunciation
// carried in the source's own notation, and its glosses. Format
// importers resolve raw entries into readings and kinds.
type RawEntry struct {
	Written string
	Trad    string
	Pinyin  string
	Glosses []string
}

// entry is one parsed dictionary entry in the shape the import loop
// consumes, whichever format produced it: kind and readings resolved,
// glosses in sense order.
type entry struct {
	Written  string
	Trad     string
	Kind     string
	Readings []model.Reading
	Glosses  []string
}

// readings returns a fresh copy of the entry's readings, so the base
// and traditional forms upsert independently — Upsert normalizes the
// slice it is given in place.
func (e entry) readings() []model.Reading {
	rs := make([]model.Reading, len(e.Readings))
	copy(rs, e.Readings)
	return rs
}

// sensesFor returns the entry's glosses as sense rows for entryID.
func (e entry) sensesFor(entryID int64) []senseRow {
	rows := make([]senseRow, len(e.Glosses))
	for i, g := range e.Glosses {
		rows[i] = senseRow{entryID: entryID, gloss: g, ord: i}
	}
	return rows
}

// jsonPack is the decoded dictionary.json of a format "json" pack.
type jsonPack struct {
	Entries []jsonEntry `json:"entries"`
}

// jsonEntry is one entry of dictionary.json: a written form, its
// optional traditional variant, kind, readings, and glosses.
type jsonEntry struct {
	Written  string        `json:"written"`
	Trad     string        `json:"trad"`
	Kind     string        `json:"kind"`
	Readings []jsonReading `json:"readings"`
	Glosses  []string      `json:"glosses"`
}

// jsonReading is one pronunciation in a dictionary.json entry.
type jsonReading struct {
	Type  string `json:"type"`
	Value string `json:"value"`
}

// toEntry maps the decoded JSON entry onto the pipeline's entry shape.
func (e jsonEntry) toEntry() entry {
	rs := make([]model.Reading, len(e.Readings))
	for i, r := range e.Readings {
		rs[i] = model.Reading{Type: r.Type, Value: r.Value}
	}
	return entry{
		Written:  e.Written,
		Trad:     e.Trad,
		Kind:     e.Kind,
		Readings: rs,
		Glosses:  e.Glosses,
	}
}

// readJSONPack reads and validates the entries of dictionary.json in
// dir, rejecting malformed entries before anything is written.
func readJSONPack(dir string) ([]entry, error) {
	data, err := os.ReadFile(filepath.Join(dir, dictionaryFile))
	if err != nil {
		return nil, fmt.Errorf("%w: read %s of %s: %v", ErrInvalidPack, dictionaryFile, dir, err)
	}
	var p jsonPack
	if err := json.Unmarshal(data, &p); err != nil {
		return nil, fmt.Errorf("%w: parse %s of %s: %v", ErrInvalidPack, dictionaryFile, dir, err)
	}
	for i, e := range p.Entries {
		if strings.TrimSpace(e.Written) == "" {
			return nil, fmt.Errorf("%w: entry %d of %s: written is required", ErrInvalidPack, i, dir)
		}
		if e.Kind != "character" && e.Kind != "word" {
			return nil, fmt.Errorf("%w: entry %d (%s) of %s: kind must be \"character\" or \"word\"", ErrInvalidPack, i, e.Written, dir)
		}
		for j, r := range e.Readings {
			if strings.TrimSpace(r.Type) == "" || strings.TrimSpace(r.Value) == "" {
				return nil, fmt.Errorf("%w: entry %d (%s) of %s: reading %d needs a type and a value", ErrInvalidPack, i, e.Written, dir, j)
			}
		}
		for j, g := range e.Glosses {
			if strings.TrimSpace(g) == "" {
				return nil, fmt.Errorf("%w: entry %d (%s) of %s: gloss %d is empty", ErrInvalidPack, i, e.Written, dir, j)
			}
		}
	}
	es := make([]entry, len(p.Entries))
	for i, je := range p.Entries {
		es[i] = je.toEntry()
	}
	return es, nil
}

// now returns the server clock as UTC RFC 3339, the timestamp
// convention for every write.
func now() string {
	return time.Now().UTC().Format(time.RFC3339)
}
