// Package sentences stores example sentences on dictionary entries:
// pack-provided ones — imported from sentence packs, linked to the word
// entries they exemplify, labeled with their source pack — and
// user-added ones, owned by the user who wrote them and untouched by
// pack imports and uninstalls.
package sentences

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

	"qinqin/internal/dict"
	"qinqin/internal/entries"
	"qinqin/internal/model"
)

// ErrNotFound reports an uninstall of an unknown — or already
// uninstalled — sentence pack.
var ErrNotFound = errors.New("sentence pack not found")

// ErrNotSentences reports an ImportPack of a pack whose manifest type is
// not "sentences". Pack dispatch happens in the seed CLI and admin
// layer, which route packs by manifest type; this guards a misrouted
// call.
var ErrNotSentences = errors.New("sentences: manifest type is not \"sentences\"")

// sentencesFile is the data file of a sentences pack.
const sentencesFile = "sentences.json"

// Result counts what one pack import wrote.
type Result struct {
	Sentences int      // sentences linked to their word entries
	Skipped   []string // words with no matching entry; no sentence is written for them
}

// sentenceRow is one sentence to write: an entry joined to the
// sentence the pack lists for its word.
type sentenceRow struct {
	entryID  int64
	sentence packSentence
}

// ImportPack installs the sentences pack: every sentence links to the
// word entry its group names — resolved by written form, word kind, and
// the pack's language — and carries the pack's manifest id as its
// source label. Unknown words are skipped and reported, never created.
// The pack's previous sentences are replaced wholesale in one
// transaction — superseded rows are soft-deleted, the new list
// inserted — scoped to that pack's rows alone: user-owned sentences
// never carry a source pack and are never touched.
func ImportPack(ctx context.Context, sqlDB *sql.DB, pack dict.Pack) (Result, error) {
	m := pack.Manifest
	// LoadPack normalizes the manifest; ImportPack re-applies the one
	// part its own lookups key on, in case the pack arrived by another
	// route.
	m.Language = strings.ToLower(strings.TrimSpace(m.Language))
	if err := m.Validate(); err != nil {
		return Result{}, fmt.Errorf("%w: %v", dict.ErrInvalidPack, err)
	}
	if m.Type != dict.TypeSentences {
		return Result{}, fmt.Errorf("%w: %q is a %s pack", ErrNotSentences, m.ID, m.Type)
	}
	if m.Format != dict.FormatJSON {
		return Result{}, fmt.Errorf("%w: sentences pack format %q is not implemented (want json)", dict.ErrInvalidPack, m.Format)
	}
	groups, err := readPack(pack.Dir)
	if err != nil {
		return Result{}, err
	}

	// Resolve every group's word before writing anything: sentence
	// packs never create entries, so every sentence must attach to an
	// existing one.
	store := entries.Store{DB: sqlDB}
	var (
		rows    []sentenceRow
		skipped []string
	)
	for _, g := range groups {
		e, err := store.GetByWritten(ctx, g.Word, "word", m.Language)
		if errors.Is(err, entries.ErrNotFound) {
			skipped = append(skipped, g.Word)
			continue
		}
		if err != nil {
			return Result{}, fmt.Errorf("import sentences %s: %w", m.ID, err)
		}
		for _, s := range g.Sentences {
			rows = append(rows, sentenceRow{entryID: e.ID, sentence: s})
		}
	}

	var result Result
	result.Sentences = len(rows)
	result.Skipped = skipped
	if result.Skipped == nil {
		result.Skipped = []string{}
	}
	if err := writePack(ctx, sqlDB, m, rows); err != nil {
		return Result{}, err
	}
	return result, nil
}

// ForEntry returns the entry's active sentences in insertion order:
// pack-provided ones carrying their source pack, user-added ones their
// owner.
func ForEntry(ctx context.Context, sqlDB *sql.DB, entryID int64) ([]model.Sentence, error) {
	rows, err := sqlDB.QueryContext(ctx, `
		SELECT id, entry_id, source_pack, user_id, hanzi, pinyin, translation, updated_at
		FROM sentences
		WHERE entry_id = ? AND deleted_at IS NULL
		ORDER BY id`, entryID)
	if err != nil {
		return nil, fmt.Errorf("sentences of entry %d: %w", entryID, err)
	}
	defer rows.Close()

	list := make([]model.Sentence, 0)
	for rows.Next() {
		var (
			s         model.Sentence
			userID    sql.NullInt64
			updatedAt string
		)
		if err := rows.Scan(&s.ID, &s.EntryID, &s.SourcePack, &userID,
			&s.Hanzi, &s.Pinyin, &s.Translation, &updatedAt); err != nil {
			return nil, fmt.Errorf("sentences of entry %d: %w", entryID, err)
		}
		updated, err := time.Parse(time.RFC3339, updatedAt)
		if err != nil {
			return nil, fmt.Errorf("parse updated_at %q of sentence %d: %w", updatedAt, s.ID, err)
		}
		s.UpdatedAt = updated
		if userID.Valid {
			id := userID.Int64
			s.UserID = &id
		}
		list = append(list, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("sentences of entry %d: %w", entryID, err)
	}
	return list, nil
}

// AddUser stores s as user userID's sentence on entry entryID and
// returns its id. The row carries its owner and no source pack, so
// pack imports and uninstalls never touch it.
func AddUser(ctx context.Context, sqlDB *sql.DB, userID, entryID int64, s model.Sentence) (int64, error) {
	res, err := sqlDB.ExecContext(ctx, `
		INSERT INTO sentences (entry_id, source_pack, user_id, hanzi, pinyin, translation, updated_at)
		VALUES (?, '', ?, ?, ?, ?, ?)`,
		entryID, userID, s.Hanzi, s.Pinyin, s.Translation, now())
	if err != nil {
		return 0, fmt.Errorf("add sentence of user %d on entry %d: %w", userID, entryID, err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("add sentence of user %d on entry %d: %w", userID, entryID, err)
	}
	return id, nil
}

// Uninstall soft-deletes every sentence of the pack with manifest id
// pack. User-owned sentences never carry a source pack and survive. An
// unknown or already-uninstalled pack returns ErrNotFound.
func Uninstall(ctx context.Context, sqlDB *sql.DB, pack string) error {
	stamp := now()
	res, err := sqlDB.ExecContext(ctx, `
		UPDATE sentences SET deleted_at = ?, updated_at = ?
		WHERE source_pack = ? AND user_id IS NULL AND deleted_at IS NULL`,
		stamp, stamp, pack)
	if err != nil {
		return fmt.Errorf("uninstall sentences of pack %s: %w", pack, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("uninstall sentences of pack %s: %w", pack, err)
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// packData is the decoded sentences.json of a pack.
type packData struct {
	Entries []packEntry `json:"entries"`
}

// packEntry is one word group of sentences.json: the word its
// sentences exemplify and those sentences.
type packEntry struct {
	Word      string         `json:"word"`
	Sentences []packSentence `json:"sentences"`
}

// packSentence is one sentence of a word group.
type packSentence struct {
	Hanzi       string `json:"hanzi"`
	Pinyin      string `json:"pinyin"`
	Translation string `json:"translation"`
}

// readPack reads and validates the sentences.json in dir, rejecting
// malformed packs before anything is written.
func readPack(dir string) ([]packEntry, error) {
	data, err := os.ReadFile(filepath.Join(dir, sentencesFile))
	if err != nil {
		return nil, fmt.Errorf("%w: read %s of %s: %v", dict.ErrInvalidPack, sentencesFile, dir, err)
	}
	var p packData
	if err := json.Unmarshal(data, &p); err != nil {
		return nil, fmt.Errorf("%w: parse %s of %s: %v", dict.ErrInvalidPack, sentencesFile, dir, err)
	}
	if len(p.Entries) == 0 {
		return nil, fmt.Errorf("%w: %s of %s: at least one entry is required", dict.ErrInvalidPack, sentencesFile, dir)
	}
	for i, g := range p.Entries {
		if strings.TrimSpace(g.Word) == "" {
			return nil, fmt.Errorf("%w: %s of %s: entry %d needs a word", dict.ErrInvalidPack, sentencesFile, dir, i)
		}
		for j, s := range g.Sentences {
			if strings.TrimSpace(s.Hanzi) == "" || strings.TrimSpace(s.Pinyin) == "" || strings.TrimSpace(s.Translation) == "" {
				return nil, fmt.Errorf("%w: %s of %s: sentence %d of %s needs a hanzi, pinyin, and translation",
					dict.ErrInvalidPack, sentencesFile, dir, j, g.Word)
			}
		}
	}
	return p.Entries, nil
}

// writePack replaces the pack's sentences in one transaction: the
// pack's previous rows are tombstoned and the new list inserted, so a
// re-import swaps a pack's sentences atomically, scoped to that pack
// alone. User-owned rows never carry a source pack and are never
// touched.
func writePack(ctx context.Context, sqlDB *sql.DB, m dict.Manifest, rows []sentenceRow) error {
	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("import sentences %s: %w", m.ID, err)
	}
	defer tx.Rollback()
	stamp := now()

	// Diff against the pack's stored sentences — identified by entry and
	// text — and write only the difference: an unchanged sentence keeps
	// its row and stamp, one returning from a tombstone is revived, a new
	// one inserted, and one the pack dropped tombstoned. An identical
	// re-import therefore writes nothing.
	type key struct {
		entryID                  int64
		hanzi, pinyin, translate string
	}
	type stored struct {
		id     int64
		active bool
	}
	cur, err := tx.QueryContext(ctx, `
		SELECT id, entry_id, hanzi, pinyin, translation, deleted_at IS NULL FROM sentences
		WHERE source_pack = ? AND user_id IS NULL
		ORDER BY deleted_at IS NULL DESC, id`, m.ID)
	if err != nil {
		return fmt.Errorf("read sentences of pack %s: %w", m.ID, err)
	}
	existing := map[key]stored{}
	var extras []int64 // active duplicates of an already-seen sentence
	for cur.Next() {
		var (
			k key
			s stored
		)
		if err := cur.Scan(&s.id, &k.entryID, &k.hanzi, &k.pinyin, &k.translate, &s.active); err != nil {
			cur.Close()
			return fmt.Errorf("read sentences of pack %s: %w", m.ID, err)
		}
		if _, dup := existing[k]; dup {
			if s.active {
				extras = append(extras, s.id)
			}
			continue
		}
		existing[k] = s
	}
	err = cur.Err()
	cur.Close()
	if err != nil {
		return fmt.Errorf("read sentences of pack %s: %w", m.ID, err)
	}

	wanted := make(map[key]bool, len(rows))
	for _, r := range rows {
		k := key{r.entryID, r.sentence.Hanzi, r.sentence.Pinyin, r.sentence.Translation}
		if wanted[k] {
			continue
		}
		wanted[k] = true
		switch have, ok := existing[k]; {
		case !ok:
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO sentences (entry_id, source_pack, user_id, hanzi, pinyin, translation, updated_at)
				VALUES (?, ?, NULL, ?, ?, ?, ?)`,
				r.entryID, m.ID, k.hanzi, k.pinyin, k.translate, stamp); err != nil {
				return fmt.Errorf("insert sentence of pack %s: %w", m.ID, err)
			}
		case !have.active:
			if _, err := tx.ExecContext(ctx, `
				UPDATE sentences SET deleted_at = NULL, updated_at = ? WHERE id = ?`,
				stamp, have.id); err != nil {
				return fmt.Errorf("revive sentence %d of pack %s: %w", have.id, m.ID, err)
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
			UPDATE sentences SET deleted_at = ?, updated_at = ? WHERE id = ?`,
			stamp, stamp, id); err != nil {
			return fmt.Errorf("retire sentence %d of pack %s: %w", id, m.ID, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("import sentences %s: %w", m.ID, err)
	}
	return nil
}

// now returns the server clock as UTC RFC 3339, the timestamp
// convention for every write.
func now() string {
	return time.Now().UTC().Format(time.RFC3339)
}
