package dict

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
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
	Entries int // the pack's entries upserted, variant forms included; bare character entries created only to link words to their hanzi or to serve as radicals are not counted
	Senses  int // sense rows inserted for the dictionary

	// Operational counters of a cedict import: malformed lines skipped,
	// and entries whose pinyin did not convert (kept as written, so no
	// bopomofo derives for them).
	Skipped     int
	Unconverted int
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
// where the dictionary has none. A kanjidic2 pack reads kanjidic2.xml:
// each character becomes a character entry carrying its ON and KUN
// readings, its stroke count, and its Kangxi radical classification,
// with the English meanings as senses of the built-in kanjidic2
// dictionary. A jmdict pack reads jmdict.xml: each word becomes one
// entry per kanji form, the forms variant-linked to each other, with
// its kana readings and glosses. A unihan pack instead installs the
// built-in Unihan database (see importUnihan). A language code without
// a registered code pack auto-registers as a data-only language named
// from the manifest; a registered code (zh, ja) gets no language row.
// Imports key on the manifest id: the dictionary row is upserted
// (reviving an uninstalled one) and its senses replaced — old rows
// tombstoned, new rows inserted — without ever removing entries or user
// data.
func Import(ctx context.Context, sqlDB *sql.DB, pack Pack) (Result, error) {
	m := pack.Manifest
	m.normalize()
	if err := m.Validate(); err != nil {
		return Result{}, fmt.Errorf("%w: %v", ErrInvalidPack, err)
	}
	if m.Type != TypeDictionary {
		return Result{}, fmt.Errorf("%w: %q is a %s pack", ErrNotDictionary, m.ID, m.Type)
	}
	var (
		es    []entry
		stats cedictStats
	)
	switch m.Format {
	case FormatJSON:
		parsed, err := readJSONPack(pack.Dir)
		if err != nil {
			return Result{}, err
		}
		es = parsed
	case FormatCedict:
		parsed, st, err := readCedictPack(pack.Dir)
		if err != nil {
			return Result{}, err
		}
		es, stats = parsed, st
	case FormatUnihan:
		data, err := readUnihanPack(pack.Dir)
		if err != nil {
			return Result{}, err
		}
		return importUnihan(ctx, sqlDB, m, data)
	case FormatKanjidic2:
		parsed, err := readKanjidic2Pack(pack.Dir)
		if err != nil {
			return Result{}, err
		}
		es = parsed
	case FormatJMdict:
		parsed, err := readJMdictPack(pack.Dir)
		if err != nil {
			return Result{}, err
		}
		es = parsed
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
		result = Result{Skipped: stats.skipped, Unconverted: stats.unconverted}
	)
	for _, e := range es {
		// Every written form — the primary plus the extras — becomes its
		// own entry carrying the readings and glosses: a cedict pack's
		// traditional twin, a JMdict word's other kanji forms. The
		// extras link to the primary and to each other as variants.
		forms := []string{e.Written}
		for _, form := range e.Forms {
			if !slices.Contains(forms, form) {
				forms = append(forms, form)
			}
		}
		ids := make([]int64, 0, len(forms))
		for _, form := range forms {
			id, err := store.Upsert(ctx, &model.Entry{
				Language: m.Language,
				Kind:     e.Kind,
				Written:  form,
				Readings: e.readingsFor(form),
				Attrs:    e.Attrs,
			})
			if err != nil {
				return Result{}, fmt.Errorf("import dictionary %s: %w", m.ID, err)
			}
			ids = append(ids, id)
			result.Entries++
			senses = append(senses, e.sensesFor(id)...)
		}
		for i := 0; i < len(ids); i++ {
			for j := i + 1; j < len(ids); j++ {
				if err := store.LinkVariant(ctx, ids[i], ids[j]); err != nil {
					return Result{}, fmt.Errorf("import dictionary %s: %w", m.ID, err)
				}
			}
		}

		// A kanjidic2 character classifies under its Kangxi radical —
		// the same table Task 7 serves — and the radical's own entry is
		// upserted bare when the dictionary has none, so radicals stay
		// fetchable like any other entry.
		if e.Radical != 0 {
			radical, ok := kangxiRadicals[e.Radical]
			if !ok {
				return Result{}, fmt.Errorf("import dictionary %s: %s is under radical %d, outside the Kangxi radicals 1–214", m.ID, e.Written, e.Radical)
			}
			radicalID, err := charEntry(ctx, store, m.Language, radical)
			if err != nil {
				return Result{}, fmt.Errorf("import dictionary %s: %w", m.ID, err)
			}
			for _, id := range ids {
				if err := store.SetRadical(ctx, id, radicalID); err != nil {
					return Result{}, fmt.Errorf("import dictionary %s: %w", m.ID, err)
				}
			}
		}

		// A cedict word links to a character entry for every distinct
		// hanzi in each of its written forms — the simplified entry and
		// its traditional twin alike — so words are findable by their
		// characters.
		if m.Format == FormatCedict && e.Kind == "word" {
			for i, form := range forms {
				if err := linkWordChars(ctx, store, m.Language, form, ids[i]); err != nil {
					return Result{}, fmt.Errorf("import dictionary %s: %w", m.ID, err)
				}
			}
		}
	}

	// The dictionary row the import registers: a kanjidic2 import
	// registers the built-in kanjidic2 dictionary — one canonical EDRDG
	// dataset with fixed license terms, whatever pack delivered the
	// file, like the built-in unihan dictionary — every other format
	// the manifest's own id and terms.
	packID, license, attribution := m.ID, m.License, m.Attribution
	if m.Format == FormatKanjidic2 {
		packID, license, attribution = kanjidic2PackID, kanjidic2License, kanjidic2Attribution
	}

	// One transaction registers the dictionary and replaces its senses:
	// the previous senses are tombstoned and the new list inserted, so a
	// re-import swaps a dictionary's glosses atomically, scoped to that
	// dictionary alone.
	if _, err := replaceSenses(ctx, sqlDB, packID, m.Name, m.Version, license, attribution, senses); err != nil {
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
	if err := diffSenses(ctx, tx, dictID, senses, stamp); err != nil {
		return 0, fmt.Errorf("replace senses of dictionary %s: %w", packID, err)
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("import dictionary %s: %w", packID, err)
	}
	return dictID, nil
}

// senseKey identifies a sense within one dictionary: the same gloss on
// the same entry is the same sense, whatever its position.
type senseKey struct {
	entryID int64
	gloss   string
}

// storedSense is an existing senses row.
type storedSense struct {
	id     int64
	ord    int
	active bool
}

// diffSenses brings the dictionary's senses to exactly want, writing only
// the difference: a sense already active at the same position is left
// untouched (no re-stamp, same id), a moved one is updated in place, a
// tombstoned one that returns is revived, a new one is inserted, and an
// active one no longer wanted is tombstoned. Re-importing an identical
// pack therefore writes nothing, and a real change ships only its own
// rows. A gloss listed twice for one entry counts once.
func diffSenses(ctx context.Context, tx *sql.Tx, dictID int64, want []senseRow, stamp string) error {
	// Active rows first, so when old data holds duplicates of a key the
	// active one is the one kept and the extras are retired below.
	rows, err := tx.QueryContext(ctx, `
		SELECT id, entry_id, gloss, ord, deleted_at IS NULL FROM senses
		WHERE dictionary_id = ?
		ORDER BY deleted_at IS NULL DESC, id`, dictID)
	if err != nil {
		return err
	}
	existing := map[senseKey]storedSense{}
	var extras []int64 // active duplicates of an already-seen key
	for rows.Next() {
		var (
			k senseKey
			s storedSense
		)
		if err := rows.Scan(&s.id, &k.entryID, &k.gloss, &s.ord, &s.active); err != nil {
			rows.Close()
			return err
		}
		if _, dup := existing[k]; dup {
			if s.active {
				extras = append(extras, s.id)
			}
			continue
		}
		existing[k] = s
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}

	wanted := make(map[senseKey]bool, len(want))
	for _, w := range want {
		k := senseKey{w.entryID, w.gloss}
		if wanted[k] {
			continue
		}
		wanted[k] = true
		cur, ok := existing[k]
		switch {
		case !ok:
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO senses (dictionary_id, entry_id, gloss, ord, updated_at)
				VALUES (?, ?, ?, ?, ?)`,
				dictID, w.entryID, w.gloss, w.ord, stamp); err != nil {
				return fmt.Errorf("insert sense: %w", err)
			}
		case cur.active && cur.ord == w.ord:
			// unchanged
		default: // moved, or returning from a tombstone
			if _, err := tx.ExecContext(ctx, `
				UPDATE senses SET ord = ?, deleted_at = NULL, updated_at = ? WHERE id = ?`,
				w.ord, stamp, cur.id); err != nil {
				return fmt.Errorf("update sense %d: %w", cur.id, err)
			}
		}
	}

	retire := extras
	for k, s := range existing {
		if s.active && !wanted[k] {
			retire = append(retire, s.id)
		}
	}
	for _, id := range retire {
		if _, err := tx.ExecContext(ctx, `
			UPDATE senses SET deleted_at = ?, updated_at = ? WHERE id = ?`,
			stamp, stamp, id); err != nil {
			return fmt.Errorf("retire sense %d: %w", id, err)
		}
	}
	return nil
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

// RawEntry is one entry of a native-format dictionary source — its
// written forms (a primary plus optional variant forms), its
// pronunciation (in the source's own notation, or resolved into typed
// readings), the attrs and radical number the source carries, and its
// glosses. Format importers resolve raw entries into readings and
// kinds.
type RawEntry struct {
	Written  string
	Trad     string            // the cedict line's traditional twin
	Pinyin   string            // the cedict line's tone-numbered pinyin
	Forms    []string          // additional written forms, variant-linked to Written (JMdict kanji forms)
	Readings []model.Reading   // readings the source types itself (kanjidic2 on/kun, jmdict kana)
	Attrs    map[string]string // entry attrs (kanjidic2 strokes)
	Radical  int               // Kangxi radical number (kanjidic2 classical radical)
	Glosses  []string
}

// entry is one parsed dictionary entry in the shape the import loop
// consumes, whichever format produced it: kind and readings resolved,
// glosses in sense order.
type entry struct {
	Written  string
	Forms    []string // additional written forms, linked to Written as variants
	Kind     string
	Readings []model.Reading
	Glosses  []string
	Attrs    map[string]string // entry attrs (kanjidic2 strokes)
	Radical  int               // Kangxi radical number; 0 = unclassified
	// FormReadings, when set, holds the readings of individual written
	// forms (Written or one of Forms) that differ from Readings: a JMdict
	// form shared by several words carries all of their readings.
	FormReadings map[string][]model.Reading
}

// tradForms returns trad as a single extra written form, or nil when it
// is absent or the same as the primary written form.
func tradForms(written, trad string) []string {
	if trad == "" || trad == written {
		return nil
	}
	return []string{trad}
}

// readings returns a fresh copy of the entry's readings, so the base
// and traditional forms upsert independently — Upsert normalizes the
// slice it is given in place.
func (e entry) readings() []model.Reading {
	return e.readingsFor(e.Written)
}

// readingsFor returns a copy of the readings of one written form of the
// entry: its own FormReadings when set, else the entry's Readings.
func (e entry) readingsFor(form string) []model.Reading {
	src := e.Readings
	if rs, ok := e.FormReadings[form]; ok {
		src = rs
	}
	rs := make([]model.Reading, len(src))
	copy(rs, src)
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
		Forms:    tradForms(e.Written, e.Trad),
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
