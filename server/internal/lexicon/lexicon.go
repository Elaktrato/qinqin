// Package lexicon stores dictionary headwords for lookup: entries keyed by
// their source's external key, each with its written forms, readings and
// per-dictionary senses, plus variant and radical links between entries.
package lexicon

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strconv"
	"strings"
	"time"

	"qinqin/internal/lang"
)

// ErrNotFound reports a lookup that matched no active entry.
var ErrNotFound = errors.New("lexicon entry not found")

// Form is one written form of an entry. Flags are source markers such as
// rK oK iK sK (JMdict) or trad (CEDICT); Pri is a ranking score.
type Form struct {
	Text  string
	Ord   int
	Flags []string
	Pri   int
}

// Reading is one pronunciation of an entry. Type is pinyin, bopomofo,
// kana, on, kun, romaji, ...; Value is the display form and Plain the
// normalized form lookups match against.
type Reading struct {
	Type, Value, Plain string
	Ord                int
	Flags              []string
	Pri                int
}

// Sense is one meaning of an entry as one dictionary gives it.
type Sense struct {
	ID, DictionaryID          int64
	Ord                       int
	POS, Tags, Glosses, Xrefs []string
}

// Entry is one dictionary headword, identified by (Language, Kind, Key).
// Kind is word or character. Pri ranks entries (higher first); UK marks a
// word usually written in kana.
type Entry struct {
	ID                  int64
	Language, Kind, Key string
	Forms               []Form
	Readings            []Reading
	Senses              []Sense
	Pri                 int
	UK                  bool
	Attrs               map[string]string
	UpdatedAt           time.Time
}

// Link types. Variant links are stored in both directions; radical links
// point from a character to its radical.
const (
	LinkVariant = "variant"
	LinkRadical = "radical"
)

// Store reads and writes the lexicon on a SQLite database.
type Store struct {
	DB *sql.DB
}

// Put writes e keyed by (Language, Kind, Key), reviving a soft-deleted
// entry with that key, and returns its id (also set on e.ID). Forms and
// readings replace the entry's wholesale; e.Senses replace only the
// senses of dictionaryID, other dictionaries' senses stay. Each child's
// ord is its position in its slice (the given Ord is ignored), and every
// sense is stored under dictionaryID. Replaced rows are soft-deleted. A
// Put that matches what is stored writes nothing, not even updated_at;
// otherwise the entry is stamped once. The whole Put is one transaction
// (see PutTx to join the caller's).
func (s Store) Put(ctx context.Context, e *Entry, dictionaryID int64) (int64, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("put entry %s/%s/%s: %w", e.Language, e.Kind, e.Key, err)
	}
	defer tx.Rollback()
	id, err := s.PutTx(ctx, tx, e, dictionaryID)
	if err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("put entry %s/%s/%s: %w", e.Language, e.Kind, e.Key, err)
	}
	return id, nil
}

// PutTx is Put inside the caller's transaction: it writes e exactly as
// Put does but neither begins, commits nor rolls back, so a bulk import
// can put many entries all-or-nothing. Rolling back tx undoes the put.
func (s Store) PutTx(ctx context.Context, tx *sql.Tx, e *Entry, dictionaryID int64) (int64, error) {
	id, err := s.put(ctx, tx, e, dictionaryID)
	if err != nil {
		return 0, fmt.Errorf("put entry %s/%s/%s: %w", e.Language, e.Kind, e.Key, err)
	}
	e.ID = id
	return id, nil
}

func (s Store) put(ctx context.Context, tx *sql.Tx, e *Entry, dictionaryID int64) (int64, error) {
	attrs, err := encodeAttrs(e.Attrs)
	if err != nil {
		return 0, err
	}
	forms, readings, senses, err := encodeChildren(e)
	if err != nil {
		return 0, err
	}

	stamp := now()

	var (
		id        int64
		pri, uk   int
		oldAttrs  string
		deletedAt sql.NullString
		changed   bool
		inserted  bool
	)
	err = tx.QueryRowContext(ctx, `
		SELECT id, pri, uk, attrs, deleted_at FROM entries
		WHERE language = ? AND kind = ? AND ext_key = ?`,
		e.Language, e.Kind, e.Key).Scan(&id, &pri, &uk, &oldAttrs, &deletedAt)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		if err := tx.QueryRowContext(ctx, `
			INSERT INTO entries (language, kind, ext_key, pri, uk, attrs, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)
			RETURNING id`,
			e.Language, e.Kind, e.Key, e.Pri, boolInt(e.UK), attrs, stamp).Scan(&id); err != nil {
			return 0, err
		}
		inserted = true
	case err != nil:
		return 0, err
	default:
		changed = deletedAt.Valid || pri != e.Pri || uk != boolInt(e.UK) || oldAttrs != attrs
	}

	children := []struct {
		name   string
		load   string
		retire string
		insert string
		args   []any // bound before the row values / after entry_id
		rows   [][]string
	}{
		{
			name:   "forms",
			load:   `SELECT text, ord, flags, pri FROM forms WHERE entry_id = ? AND deleted_at IS NULL ORDER BY ord, id`,
			retire: `UPDATE forms SET deleted_at = ?, updated_at = ? WHERE entry_id = ? AND deleted_at IS NULL`,
			insert: `INSERT INTO forms (entry_id, text, ord, flags, pri, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
			rows:   forms,
		},
		{
			name:   "readings",
			load:   `SELECT type, value, plain, ord, flags, pri FROM readings WHERE entry_id = ? AND deleted_at IS NULL ORDER BY ord, id`,
			retire: `UPDATE readings SET deleted_at = ?, updated_at = ? WHERE entry_id = ? AND deleted_at IS NULL`,
			insert: `INSERT INTO readings (entry_id, type, value, plain, ord, flags, pri, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			rows:   readings,
		},
		{
			name:   "senses",
			load:   `SELECT ord, pos, tags, glosses, xrefs FROM senses WHERE entry_id = ? AND deleted_at IS NULL AND dictionary_id = ? ORDER BY ord, id`,
			retire: `UPDATE senses SET deleted_at = ?, updated_at = ? WHERE entry_id = ? AND deleted_at IS NULL AND dictionary_id = ?`,
			insert: `INSERT INTO senses (entry_id, dictionary_id, ord, pos, tags, glosses, xrefs, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			args:   []any{dictionaryID},
			rows:   senses,
		},
	}
	for _, c := range children {
		if !inserted {
			stored, err := loadRows(ctx, tx, c.load, append([]any{id}, c.args...)...)
			if err != nil {
				return 0, fmt.Errorf("compare %s: %w", c.name, err)
			}
			if reflect.DeepEqual(stored, c.rows) {
				continue
			}
			if _, err := tx.ExecContext(ctx, c.retire, append([]any{stamp, stamp, id}, c.args...)...); err != nil {
				return 0, fmt.Errorf("retire %s: %w", c.name, err)
			}
		}
		changed = true
		for i, row := range c.rows {
			args := append([]any{id}, c.args...)
			for _, v := range row {
				args = append(args, v)
			}
			args = append(args, stamp)
			if _, err := tx.ExecContext(ctx, c.insert, args...); err != nil {
				return 0, fmt.Errorf("insert %s %d: %w", c.name, i, err)
			}
		}
	}

	if changed && !inserted {
		if _, err := tx.ExecContext(ctx, `
			UPDATE entries SET pri = ?, uk = ?, attrs = ?, updated_at = ?, deleted_at = NULL
			WHERE id = ?`,
			e.Pri, boolInt(e.UK), attrs, stamp, id); err != nil {
			return 0, err
		}
	}
	return id, nil
}

// Get returns the active entry with the given id, fully loaded, or
// ErrNotFound.
func (s Store) Get(ctx context.Context, id int64) (*Entry, error) {
	es, err := s.GetMany(ctx, []int64{id})
	if err != nil {
		return nil, err
	}
	if len(es) == 0 {
		return nil, ErrNotFound
	}
	return &es[0], nil
}

// GetMany returns the active entries with the given ids, fully loaded, in
// the order the ids appear, skipping unknown or soft-deleted ids. It
// returns a non-nil (possibly empty) slice.
func (s Store) GetMany(ctx context.Context, ids []int64) ([]Entry, error) {
	byID, err := s.load(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("get entries: %w", err)
	}
	list := make([]Entry, 0, len(ids))
	for _, id := range ids {
		if e, ok := byID[id]; ok {
			list = append(list, *e)
		}
	}
	return list, nil
}

// ByForm returns the active entries of a language that have an active form
// whose text is one of forms, fully loaded and grouped by that text,
// ordered by entry id within a group. Forms without a match are absent.
func (s Store) ByForm(ctx context.Context, language string, forms []string) (map[string][]Entry, error) {
	out, err := s.matchBy(ctx, byFormQuery, []any{language}, forms)
	if err != nil {
		return nil, fmt.Errorf("entries by form: %w", err)
	}
	return out, nil
}

// ByReading returns the active entries of a language that have an active
// reading (of any type) whose plain form is one of plains, fully loaded
// and grouped by that plain form, ordered by entry id within a group.
// Plains without a match are absent.
func (s Store) ByReading(ctx context.Context, language string, plains []string) (map[string][]Entry, error) {
	out, err := s.matchBy(ctx, byReadingQuery, []any{language}, plains)
	if err != nil {
		return nil, fmt.Errorf("entries by reading: %w", err)
	}
	return out, nil
}

// ByReadingKind is ByReading limited to entries of one kind (word or
// character): entries of other kinds are never loaded.
func (s Store) ByReadingKind(ctx context.Context, language, kind string, plains []string) (map[string][]Entry, error) {
	out, err := s.matchBy(ctx, byReadingKindQuery, []any{language, kind}, plains)
	if err != nil {
		return nil, fmt.Errorf("entries by reading (%s): %w", kind, err)
	}
	return out, nil
}

// The match queries are driven by the forms/readings index: CROSS JOIN
// makes the child table the outer loop, so SQLite looks each key up in
// idx_forms_text / idx_readings_plain and joins the entry by
// primary key. Without it the planner — lacking statistics — prefers the
// (language, …) index once the IN list has a few values and scans every
// entry of the language: two to three orders of magnitude slower on a
// full dictionary. The %s is the IN list.
const (
	byFormQuery = `
		SELECT DISTINCT f.text, e.id FROM forms f
		CROSS JOIN entries e ON e.id = f.entry_id
		WHERE f.text IN (%s) AND f.deleted_at IS NULL
		  AND e.language = ? AND e.deleted_at IS NULL
		ORDER BY f.text, e.id`
	byReadingQuery = `
		SELECT DISTINCT r.plain, e.id FROM readings r
		CROSS JOIN entries e ON e.id = r.entry_id
		WHERE r.plain IN (%s) AND r.deleted_at IS NULL
		  AND e.language = ? AND e.deleted_at IS NULL
		ORDER BY r.plain, e.id`
	byReadingKindQuery = `
		SELECT DISTINCT r.plain, e.id FROM readings r
		CROSS JOIN entries e ON e.id = r.entry_id
		WHERE r.plain IN (%s) AND r.deleted_at IS NULL
		  AND e.language = ? AND e.kind = ? AND e.deleted_at IS NULL
		ORDER BY r.plain, e.id`
	// bestQuery is driven from forms the same way.
	bestQuery = `
		SELECT e.id FROM forms f
		CROSS JOIN entries e ON e.id = f.entry_id
		WHERE f.text = ? AND f.deleted_at IS NULL
		  AND e.language = ? AND e.kind = ? AND e.deleted_at IS NULL
		ORDER BY (? = 'character' AND f.ord = 0) DESC, (e.uk = 1 AND e.pri > 0) DESC, e.pri DESC, e.id
		LIMIT 1`
)

// Best returns the best-ranked active entry of the language and kind that
// has form as an active form: usually-kana entries that carry a priority
// first, then priority (higher first), then entry id. A character first
// prefers an entry headed by the form (its first form): CC-CEDICT folds
// 覆 into 复's entry as a traditional form, and 覆 also heads its own. It
// returns ErrNotFound when no entry has the form.
func (s Store) Best(ctx context.Context, language, kind, form string) (*Entry, error) {
	var id int64
	err := s.DB.QueryRowContext(ctx, bestQuery, form, language, kind, kind).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("best entry %s/%s/%q: %w", language, kind, form, err)
	}
	return s.Get(ctx, id)
}

// bestKanaWordQuery is BestWord's reading fallback, driven from
// readings by its plain index like the match queries: a word entry
// whose FIRST reading (ord 0) is a kana reading with the given plain
// form, and which is written in kana — it has no written form, or it is
// marked usually-kana (uk). For a hiragana word (the first parameter
// after plain is 1) the reading must be written in hiragana too (value
// equal to its plain form), and the reading written exactly as the word
// sorts first.
const bestKanaWordQuery = `
	SELECT e.id FROM readings r
	CROSS JOIN entries e ON e.id = r.entry_id
	WHERE r.plain = ? AND r.type = 'kana' AND r.ord = 0 AND r.deleted_at IS NULL
	  AND (? = 0 OR r.value = r.plain)
	  AND e.language = ? AND e.kind = 'word' AND e.deleted_at IS NULL
	  AND (e.uk = 1 OR NOT EXISTS (
		SELECT 1 FROM forms f WHERE f.entry_id = e.id AND f.deleted_at IS NULL))
	ORDER BY (r.value = ?) DESC, e.pri DESC, e.id
	LIMIT 1`

// BestWord resolves a word as a level or sentence pack lists it to one
// word entry of the language. First the written form decides exactly as
// Best(language, "word", form) does — a form shared by several entries
// resolves to the BEST-ranked one. When no entry has the form, a word
// written in kana falls back to its reading: the candidates are word
// entries whose first reading is a kana reading whose plain form (the
// language pack's NormalizeReading, which unifies hiragana and katakana)
// equals the word's, and which are written in kana — they have no
// written form (これ, テレビ) or are marked usually-kana (する → 為る); a
// word whose kanji form is the usual spelling, or that lists the kana
// only as a later reading, is never picked by its reading. Among the
// candidates a reading written exactly as the word (same script: もの,
// not モノ) wins first, then the highest priority, then the lowest id. A
// hiragana word never falls back to a katakana-only reading: だれ stays
// unresolved rather than resolving to ダレ (誰 is not marked uk). It returns
// ErrNotFound when neither step matches.
func (s Store) BestWord(ctx context.Context, language, form string) (*Entry, error) {
	e, err := s.Best(ctx, language, "word", form)
	if !errors.Is(err, ErrNotFound) {
		return e, err
	}
	plain := lang.For(language).NormalizeReading("kana", form)
	var id int64
	hiragana := 0
	if plain == form {
		hiragana = 1 // NormalizeReading folds katakana to hiragana: an unchanged word is hiragana
	}
	err = s.DB.QueryRowContext(ctx, bestKanaWordQuery, plain, hiragana, language, form).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("best word %s/%q: %w", language, form, err)
	}
	return s.Get(ctx, id)
}

// bestFormReadingQuery is BestWordReading's first step, driven from forms
// like bestQuery: a word entry with the written form that also has the
// reading, compared by its plain form (the language pack's kana folding)
// or as written, ranked like Best.
const bestFormReadingQuery = `
	SELECT e.id FROM forms f
	CROSS JOIN entries e ON e.id = f.entry_id
	WHERE f.text = ? AND f.deleted_at IS NULL
	  AND e.language = ? AND e.kind = 'word' AND e.deleted_at IS NULL
	  AND EXISTS (SELECT 1 FROM readings r
		WHERE r.entry_id = e.id AND r.deleted_at IS NULL AND (r.plain IN (?, ?) OR r.value = ?))
	ORDER BY (e.uk = 1 AND e.pri > 0) DESC, e.pri DESC, e.id
	LIMIT 1`

// BestWordReading is BestWord for a written form whose reading is known
// (a JLPT list gives 風 with かぜ): an entry with both the form and the
// reading wins first, so the usually-kana 振り (also written 風, read
// ふり) does not take the level of 風 (かぜ). The reading compares by its
// plain form as a kana reading and as a pinyin reading (the language
// pack folds each type its own way: a zh list's tone-marked "hángrén"
// is plain "hangren", like CC-CEDICT's "háng rén"; a type the language
// does not use only lowercases), or as written. With an empty reading,
// or one no entry of that form has, it is BestWord.
func (s Store) BestWordReading(ctx context.Context, language, form, reading string) (*Entry, error) {
	if reading != "" {
		p := lang.For(language)
		kana, toneless := p.NormalizeReading("kana", reading), p.NormalizeReading("pinyin", reading)
		var id int64
		err := s.DB.QueryRowContext(ctx, bestFormReadingQuery, form, language, kana, toneless, reading).Scan(&id)
		if err == nil {
			return s.Get(ctx, id)
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("best word %s/%q (%s): %w", language, form, reading, err)
		}
	}
	return s.BestWord(ctx, language, form)
}

// Link links fromID to toID with typ (LinkVariant or LinkRadical). A
// variant link is stored in both directions so reads are symmetric.
// Linking an existing pair again writes nothing; a soft-deleted link
// revives.
func (s Store) Link(ctx context.Context, fromID, toID int64, typ string) error {
	if typ != LinkVariant && typ != LinkRadical {
		return fmt.Errorf("link %d->%d: unknown link type %q", fromID, toID, typ)
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("link %d->%d (%s): %w", fromID, toID, typ, err)
	}
	defer tx.Rollback()
	if err := s.LinkTx(ctx, tx, fromID, toID, typ); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("link %d->%d (%s): %w", fromID, toID, typ, err)
	}
	return nil
}

// LinkTx is Link inside the caller's transaction: it neither begins,
// commits nor rolls back, so a bulk import can link entries it wrote in
// the same transaction, all-or-nothing.
func (s Store) LinkTx(ctx context.Context, tx *sql.Tx, fromID, toID int64, typ string) error {
	if typ != LinkVariant && typ != LinkRadical {
		return fmt.Errorf("link %d->%d: unknown link type %q", fromID, toID, typ)
	}
	stamp := now()
	pairs := [][2]int64{{fromID, toID}}
	if typ == LinkVariant {
		pairs = append(pairs, [2]int64{toID, fromID})
	}
	for _, p := range pairs {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO entry_links (from_id, to_id, type, updated_at)
			VALUES (?, ?, ?, ?)
			ON CONFLICT (from_id, to_id, type) DO UPDATE SET
				deleted_at = NULL,
				updated_at = excluded.updated_at
			WHERE entry_links.deleted_at IS NOT NULL`,
			p[0], p[1], typ, stamp); err != nil {
			return fmt.Errorf("link %d->%d (%s): %w", p[0], p[1], typ, err)
		}
	}
	return nil
}

// Variants returns the active entries linked to id as variants, fully
// loaded, ordered by entry id. It returns a non-nil (possibly empty) slice.
func (s Store) Variants(ctx context.Context, id int64) ([]Entry, error) {
	ids, err := queryIDs(ctx, s.DB, `
		SELECT to_id FROM entry_links
		WHERE from_id = ? AND type = 'variant' AND deleted_at IS NULL
		ORDER BY to_id`, id)
	if err != nil {
		return nil, fmt.Errorf("variants of %d: %w", id, err)
	}
	return s.GetMany(ctx, ids)
}

// childChunk is how many values one IN (...) list binds, well under
// SQLite's bound-variable limit.
const childChunk = 500

// matchBy runs query (whose %s is the IN list, bound first, followed by
// the extra args) over keys in chunks; each row is a (key, entry id)
// pair. It loads the matched entries and groups them by key in row order.
func (s Store) matchBy(ctx context.Context, query string, extra []any, keys []string) (map[string][]Entry, error) {
	type hit struct {
		key string
		id  int64
	}
	var (
		hits []hit
		ids  []int64
	)
	for start := 0; start < len(keys); start += childChunk {
		chunk := keys[start:min(start+childChunk, len(keys))]
		args := make([]any, 0, len(chunk)+len(extra))
		for _, k := range chunk {
			args = append(args, k)
		}
		args = append(args, extra...)
		rows, err := s.DB.QueryContext(ctx, fmt.Sprintf(query, placeholders(len(chunk))), args...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var h hit
			if err := rows.Scan(&h.key, &h.id); err != nil {
				rows.Close()
				return nil, err
			}
			hits = append(hits, h)
			ids = append(ids, h.id)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, err
		}
	}
	byID, err := s.load(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make(map[string][]Entry)
	for _, h := range hits {
		if e, ok := byID[h.id]; ok {
			out[h.key] = append(out[h.key], *e)
		}
	}
	return out, nil
}

// load reads the active entries with the given ids (duplicates allowed)
// and their children, in chunks, keyed by id.
func (s Store) load(ctx context.Context, ids []int64) (map[int64]*Entry, error) {
	byID := make(map[int64]*Entry, len(ids))
	uniq := make([]any, 0, len(ids))
	for _, id := range ids {
		if _, seen := byID[id]; seen {
			continue
		}
		byID[id] = nil
		uniq = append(uniq, id)
	}
	for start := 0; start < len(uniq); start += childChunk {
		if err := s.loadChunk(ctx, uniq[start:min(start+childChunk, len(uniq))], byID); err != nil {
			return nil, err
		}
	}
	for id, e := range byID {
		if e == nil {
			delete(byID, id)
		}
	}
	return byID, nil
}

// loadChunk reads one chunk of entries and their forms, readings and
// senses (of active dictionaries) into byID.
func (s Store) loadChunk(ctx context.Context, ids []any, byID map[int64]*Entry) error {
	in := placeholders(len(ids))

	rows, err := s.DB.QueryContext(ctx, `
		SELECT id, language, kind, ext_key, pri, uk, attrs, updated_at FROM entries
		WHERE id IN (`+in+`) AND deleted_at IS NULL`, ids...)
	if err != nil {
		return fmt.Errorf("load entries: %w", err)
	}
	err = eachRow(rows, func() error {
		var (
			e              Entry
			attrs, updated string
		)
		if err := rows.Scan(&e.ID, &e.Language, &e.Kind, &e.Key, &e.Pri, &e.UK, &attrs, &updated); err != nil {
			return err
		}
		if err := json.Unmarshal([]byte(attrs), &e.Attrs); err != nil {
			return fmt.Errorf("attrs of entry %d: %w", e.ID, err)
		}
		if e.Attrs == nil {
			e.Attrs = map[string]string{}
		}
		if e.UpdatedAt, err = time.Parse(time.RFC3339, updated); err != nil {
			return fmt.Errorf("updated_at of entry %d: %w", e.ID, err)
		}
		e.Forms, e.Readings, e.Senses = []Form{}, []Reading{}, []Sense{}
		byID[e.ID] = &e
		return nil
	})
	if err != nil {
		return fmt.Errorf("load entries: %w", err)
	}

	rows, err = s.DB.QueryContext(ctx, `
		SELECT entry_id, text, ord, flags, pri FROM forms
		WHERE entry_id IN (`+in+`) AND deleted_at IS NULL
		ORDER BY entry_id, ord, id`, ids...)
	if err != nil {
		return fmt.Errorf("load forms: %w", err)
	}
	err = eachRow(rows, func() error {
		var (
			entryID int64
			f       Form
			flags   string
		)
		if err := rows.Scan(&entryID, &f.Text, &f.Ord, &flags, &f.Pri); err != nil {
			return err
		}
		if err := decodeList(flags, &f.Flags); err != nil {
			return err
		}
		if e := byID[entryID]; e != nil {
			e.Forms = append(e.Forms, f)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("load forms: %w", err)
	}

	rows, err = s.DB.QueryContext(ctx, `
		SELECT entry_id, type, value, plain, ord, flags, pri FROM readings
		WHERE entry_id IN (`+in+`) AND deleted_at IS NULL
		ORDER BY entry_id, ord, id`, ids...)
	if err != nil {
		return fmt.Errorf("load readings: %w", err)
	}
	err = eachRow(rows, func() error {
		var (
			entryID int64
			r       Reading
			flags   string
		)
		if err := rows.Scan(&entryID, &r.Type, &r.Value, &r.Plain, &r.Ord, &flags, &r.Pri); err != nil {
			return err
		}
		if err := decodeList(flags, &r.Flags); err != nil {
			return err
		}
		if e := byID[entryID]; e != nil {
			e.Readings = append(e.Readings, r)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("load readings: %w", err)
	}

	rows, err = s.DB.QueryContext(ctx, `
		SELECT s.entry_id, s.id, s.dictionary_id, s.ord, s.pos, s.tags, s.glosses, s.xrefs
		FROM senses s
		JOIN dictionaries d ON d.id = s.dictionary_id AND d.deleted_at IS NULL
		WHERE s.entry_id IN (`+in+`) AND s.deleted_at IS NULL
		ORDER BY s.entry_id, s.dictionary_id, s.ord, s.id`, ids...)
	if err != nil {
		return fmt.Errorf("load senses: %w", err)
	}
	err = eachRow(rows, func() error {
		var (
			entryID                   int64
			sn                        Sense
			pos, tags, glosses, xrefs string
		)
		if err := rows.Scan(&entryID, &sn.ID, &sn.DictionaryID, &sn.Ord, &pos, &tags, &glosses, &xrefs); err != nil {
			return err
		}
		for _, l := range []struct {
			raw string
			dst *[]string
		}{{pos, &sn.POS}, {tags, &sn.Tags}, {glosses, &sn.Glosses}, {xrefs, &sn.Xrefs}} {
			if err := decodeList(l.raw, l.dst); err != nil {
				return err
			}
		}
		if e := byID[entryID]; e != nil {
			e.Senses = append(e.Senses, sn)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("load senses: %w", err)
	}
	return nil
}

// eachRow calls fn for every row, then closes rows and reports the first
// error.
func eachRow(rows *sql.Rows, fn func() error) error {
	defer rows.Close()
	for rows.Next() {
		if err := fn(); err != nil {
			return err
		}
	}
	return rows.Err()
}

// queryIDs runs a query returning one id column.
func queryIDs(ctx context.Context, db *sql.DB, query string, args ...any) ([]int64, error) {
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	var ids []int64
	err = eachRow(rows, func() error {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return err
		}
		ids = append(ids, id)
		return nil
	})
	return ids, err
}

// loadRows runs a query and returns every row with each column as text,
// the form Put compares stored children in.
func loadRows(ctx context.Context, tx *sql.Tx, query string, args ...any) ([][]string, error) {
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	cols, err := rows.Columns()
	if err != nil {
		rows.Close()
		return nil, err
	}
	out := [][]string{}
	err = eachRow(rows, func() error {
		row := make([]string, len(cols))
		dst := make([]any, len(cols))
		for i := range row {
			dst[i] = &row[i]
		}
		if err := rows.Scan(dst...); err != nil {
			return err
		}
		out = append(out, row)
		return nil
	})
	return out, err
}

// encodeChildren renders e's forms, readings and senses as the text
// column values Put writes and compares, ord being the slice position.
// Column order matches the load and insert statements in put.
func encodeChildren(e *Entry) (forms, readings, senses [][]string, err error) {
	forms, readings, senses = [][]string{}, [][]string{}, [][]string{}
	for i, f := range e.Forms {
		flags, err := encodeList(f.Flags)
		if err != nil {
			return nil, nil, nil, err
		}
		forms = append(forms, []string{f.Text, strconv.Itoa(i), flags, strconv.Itoa(f.Pri)})
	}
	for i, r := range e.Readings {
		flags, err := encodeList(r.Flags)
		if err != nil {
			return nil, nil, nil, err
		}
		readings = append(readings, []string{r.Type, r.Value, r.Plain, strconv.Itoa(i), flags, strconv.Itoa(r.Pri)})
	}
	for i, sn := range e.Senses {
		row := []string{strconv.Itoa(i)}
		for _, l := range [][]string{sn.POS, sn.Tags, sn.Glosses, sn.Xrefs} {
			v, err := encodeList(l)
			if err != nil {
				return nil, nil, nil, err
			}
			row = append(row, v)
		}
		senses = append(senses, row)
	}
	return forms, readings, senses, nil
}

// encodeList renders a string slice as JSON text; nil is "[]".
func encodeList(l []string) (string, error) {
	if l == nil {
		l = []string{}
	}
	b, err := json.Marshal(l)
	return string(b), err
}

// decodeList parses JSON text into a non-nil string slice.
func decodeList(raw string, dst *[]string) error {
	if err := json.Unmarshal([]byte(raw), dst); err != nil {
		return fmt.Errorf("decode %q: %w", raw, err)
	}
	if *dst == nil {
		*dst = []string{}
	}
	return nil
}

// encodeAttrs renders attrs as JSON text (keys sorted, so equal maps
// encode equally); nil is "{}".
func encodeAttrs(attrs map[string]string) (string, error) {
	if attrs == nil {
		attrs = map[string]string{}
	}
	b, err := json.Marshal(attrs)
	return string(b), err
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// placeholders returns n comma-separated SQL parameter placeholders.
func placeholders(n int) string {
	return strings.TrimSuffix(strings.Repeat("?,", n), ",")
}

// now returns the server clock as UTC RFC 3339, the timestamp convention
// for every write.
func now() string {
	return time.Now().UTC().Format(time.RFC3339)
}
