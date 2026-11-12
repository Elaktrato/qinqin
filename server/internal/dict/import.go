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

	"qinqin/internal/lang"
	"qinqin/internal/model"
)

// ErrNotDictionary reports an ImportLexicon of a pack whose manifest type is
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

// upsertDictionary registers or revives the dictionary keyed by packID
// inside tx and returns its row id.
func upsertDictionary(ctx context.Context, tx *sql.Tx, packID, name, version, license, attribution, stamp string) (int64, error) {
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
	// The senses become tombstones, so delta sync ships the removal.
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
	Forms    []string          // additional written forms (JMdict kanji forms)
	Readings []model.Reading   // readings the source types itself (kanjidic2 on/kun, jmdict kana)
	Attrs    map[string]string // entry attrs (kanjidic2 strokes)
	Radical  int               // Kangxi radical number (kanjidic2 classical radical)
	Glosses  []string
	// FormAttrs, when set, holds the attrs of each written form (Written
	// and every one of Forms): a JMdict form's ranking attrs.
	FormAttrs map[string]map[string]string
}

// entry is one parsed dictionary entry of a json or kanjidic2 pack, in
// the shape the lexicon import consumes: kind and readings resolved,
// glosses in sense order.
type entry struct {
	Written  string
	Forms    []string // additional written forms (a json pack's traditional twin)
	Kind     string
	Readings []model.Reading
	Glosses  []string
	Attrs    map[string]string // entry attrs (kanjidic2 strokes)
	Radical  int               // Kangxi radical number; 0 = unclassified
}

// tradForms returns trad as a single extra written form, or nil when it
// is absent or the same as the primary written form.
func tradForms(written, trad string) []string {
	if trad == "" || trad == written {
		return nil
	}
	return []string{trad}
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
