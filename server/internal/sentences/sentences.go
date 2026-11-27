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
	"strconv"
	"strings"
	"time"

	"qinqin/internal/lexicon"
	"qinqin/internal/model"
	"qinqin/internal/pack"
)

// ErrNotFound reports an uninstall of an unknown — or already
// uninstalled — sentence pack.
var ErrNotFound = pack.NotFound("sentence pack not found")

// ErrSentenceNotFound reports a sentence that does not exist or that the
// viewer may not see.
var ErrSentenceNotFound = errors.New("sentence not found")

// ErrNotSentences reports an ImportPack of a pack whose manifest type is
// not "sentences". Pack dispatch happens in the seed CLI and admin
// layer, which route packs by manifest type; this guards a misrouted
// call.
var ErrNotSentences = errors.New("sentences: manifest type is not \"sentences\"")

// sentencesFile is the data file of a sentences pack.
const sentencesFile = "sentences.json"

// Result counts what one pack import wrote.
type Result struct {
	Sentences int      // distinct sentences linked to their word entries (a repeated one counts once)
	Skipped   []string // words with no matching entry; no sentence is written for them
}

// sentenceRow is one sentence to write: an entry joined to the
// sentence the pack lists for its word.
type sentenceRow struct {
	entryID  int64
	sentence packSentence
}

// ImportPack installs the sentences pack: every sentence links to the
// lexicon word entry its group names — resolved in the pack's language
// through lexicon.Store.BestWord: by written form, a form shared by
// several words linking to the BEST-ranked one alone, and for a word no
// entry has as a written form, by the first kana reading of the
// kana-written words (no written form, or usually-kana), highest
// priority first (これ, する → 為る) — and
// carries the pack's manifest id as its source label. Unknown words are
// skipped and reported, never created.
// The pack's previous sentences are replaced wholesale in one
// transaction — superseded rows are soft-deleted, the new list
// inserted — scoped to that pack's rows alone: user-owned sentences
// never carry a source pack and are never touched.
func ImportPack(ctx context.Context, sqlDB *sql.DB, pk pack.Pack) (Result, error) {
	m := pk.Manifest
	// LoadPack normalizes the manifest; ImportPack re-applies the one
	// part its own lookups key on, in case the pack arrived by another
	// route.
	m.Language = strings.ToLower(strings.TrimSpace(m.Language))
	if err := m.Validate(); err != nil {
		return Result{}, fmt.Errorf("%w: %v", pack.ErrInvalidPack, err)
	}
	if m.Type != pack.TypeSentences {
		return Result{}, fmt.Errorf("%w: %q is a %s pack", ErrNotSentences, m.ID, m.Type)
	}
	if m.Format != pack.FormatJSON {
		return Result{}, fmt.Errorf("%w: sentences pack format %q is not implemented (want json)", pack.ErrInvalidPack, m.Format)
	}
	groups, err := readPack(pk.Dir)
	if err != nil {
		return Result{}, err
	}

	// Resolve every group's word before writing anything: sentence
	// packs never create entries, so every sentence must attach to an
	// existing one.
	store := lexicon.Store{DB: sqlDB}
	var (
		rows    []sentenceRow
		skipped []string
		written = map[[3]string]bool{} // entry, text, translation: a sentence's identity
	)
	for _, g := range groups {
		e, err := store.BestWord(ctx, m.Language, g.Word)
		if errors.Is(err, lexicon.ErrNotFound) {
			skipped = append(skipped, g.Word)
			continue
		}
		if err != nil {
			return Result{}, fmt.Errorf("import sentences %s: %w", m.ID, err)
		}
		for _, s := range g.Sentences {
			// The same sentence listed twice for an entry is one row (the
			// first reading wins).
			id := [3]string{fmt.Sprint(e.ID), s.Hanzi, s.Translation}
			if !written[id] {
				written[id] = true
				rows = append(rows, sentenceRow{entryID: e.ID, sentence: s})
			}
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

// sentenceColumns is the column list every sentence read selects, in the
// order scanSentence expects.
const sentenceColumns = `id, entry_id, source_pack, user_id, hanzi, pinyin, translation, updated_at, ai_provider, ai_model,
	credit_id, credit_owner, credit_tr_id, credit_tr_owner`

// tatoebaPage is the page of a sentence on Tatoeba; a credited pack
// sentence's id is its Tatoeba id.
const tatoebaPage = "https://tatoeba.org/sentences/show/"

// creditOf is the credit of a stored sentence, nil when it has none.
func creditOf(id int64, owner string, trID int64, trOwner string) *model.SentenceCredit {
	if id == 0 {
		return nil
	}
	c := &model.SentenceCredit{Source: "Tatoeba", ID: id, Owner: owner, URL: tatoebaPage + strconv.FormatInt(id, 10),
		TranslationID: trID, TranslationOwner: trOwner}
	if trID != 0 {
		c.TranslationURL = tatoebaPage + strconv.FormatInt(trID, 10)
	}
	return c
}

// scanSentence reads one row of sentenceColumns.
func scanSentence(row interface{ Scan(...any) error }) (model.Sentence, error) {
	var (
		s                   model.Sentence
		userID              sql.NullInt64
		updatedAt           string
		aiProvider, aiModel string
		creditID, trID      int64
		owner, trOwner      string
	)
	if err := row.Scan(&s.ID, &s.EntryID, &s.SourcePack, &userID,
		&s.Hanzi, &s.Pinyin, &s.Translation, &updatedAt, &aiProvider, &aiModel,
		&creditID, &owner, &trID, &trOwner); err != nil {
		return s, err
	}
	s.Credit = creditOf(creditID, owner, trID, trOwner)
	s.AI = AIMark(aiProvider, aiModel)
	updated, err := time.Parse(time.RFC3339, updatedAt)
	if err != nil {
		return s, fmt.Errorf("parse updated_at %q of sentence %d: %w", updatedAt, s.ID, err)
	}
	s.UpdatedAt = updated
	if userID.Valid {
		id := userID.Int64
		s.UserID = &id
	}
	return s, nil
}

// ForEntry returns the entry's active sentences that viewerID may see:
// pack-provided ones first (carrying their source pack), then the
// viewer's own (carrying their owner), each group in insertion order.
// Pack examples are the curated ones, so a re-import never pushes them
// behind notes the user wrote earlier. Other users' sentences are
// private; viewerID 0 (an anonymous caller) sees pack sentences only.
func ForEntry(ctx context.Context, sqlDB *sql.DB, entryID, viewerID int64) ([]model.Sentence, error) {
	rows, err := sqlDB.QueryContext(ctx, `
		SELECT `+sentenceColumns+`
		FROM sentences
		WHERE entry_id = ? AND deleted_at IS NULL AND (user_id IS NULL OR user_id = ?)
		ORDER BY user_id IS NOT NULL, id`, entryID, viewerID)
	if err != nil {
		return nil, fmt.Errorf("sentences of entry %d: %w", entryID, err)
	}
	defer rows.Close()

	list := make([]model.Sentence, 0)
	for rows.Next() {
		s, err := scanSentence(rows)
		if err != nil {
			return nil, fmt.Errorf("sentences of entry %d: %w", entryID, err)
		}
		list = append(list, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("sentences of entry %d: %w", entryID, err)
	}
	return list, nil
}

// TextsForEntries returns the texts of the active sentences viewerID may see
// for each of the entries, in ForEntry's order (pack sentences first, then
// the viewer's own, each by id); entries without any are absent. One query
// per 500 ids.
func TextsForEntries(ctx context.Context, sqlDB *sql.DB, entryIDs []int64, viewerID int64) (map[int64][]string, error) {
	out := map[int64][]string{}
	const chunk = 500
	for start := 0; start < len(entryIDs); start += chunk {
		part := entryIDs[start:min(start+chunk, len(entryIDs))]
		args := make([]any, 0, len(part)+1)
		args = append(args, viewerID)
		marks := make([]string, len(part))
		for i, id := range part {
			marks[i] = "?"
			args = append(args, id)
		}
		rows, err := sqlDB.QueryContext(ctx, `
			SELECT entry_id, hanzi FROM sentences
			WHERE deleted_at IS NULL AND (user_id IS NULL OR user_id = ?) AND entry_id IN (`+strings.Join(marks, ",")+`)
			ORDER BY entry_id, user_id IS NOT NULL, id`, args...)
		if err != nil {
			return nil, fmt.Errorf("sentence texts: %w", err)
		}
		for rows.Next() {
			var id int64
			var text string
			if err := rows.Scan(&id, &text); err != nil {
				rows.Close()
				return nil, fmt.Errorf("sentence texts: %w", err)
			}
			out[id] = append(out[id], text)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, fmt.Errorf("sentence texts: %w", err)
		}
	}
	return out, nil
}

// Get returns the active sentence id when viewerID may see it (a pack
// sentence, or the viewer's own); anything else is ErrSentenceNotFound.
func Get(ctx context.Context, sqlDB *sql.DB, id, viewerID int64) (model.Sentence, error) {
	s, err := scanSentence(sqlDB.QueryRowContext(ctx, `
		SELECT `+sentenceColumns+`
		FROM sentences
		WHERE id = ? AND deleted_at IS NULL AND (user_id IS NULL OR user_id = ?)`, id, viewerID))
	if errors.Is(err, sql.ErrNoRows) {
		return model.Sentence{}, ErrSentenceNotFound
	}
	if err != nil {
		return model.Sentence{}, fmt.Errorf("sentence %d: %w", id, err)
	}
	return s, nil
}

// AddUser stores s as user userID's sentence on entry entryID and
// returns its id. The entry may be of any kind: only pack sentences are
// bound to word entries, while a user also saves sentences on characters
// and phrases (the reader saves book sentences on whatever was looked up). The row carries its owner and no source pack, so
// pack imports and uninstalls never touch it.
func AddUser(ctx context.Context, sqlDB *sql.DB, userID, entryID int64, s model.Sentence) (int64, error) {
	res, err := sqlDB.ExecContext(ctx, `
		INSERT INTO sentences (entry_id, source_pack, user_id, hanzi, pinyin, translation, updated_at)
		VALUES (?, '', ?, ?, ?, ?, ?)`,
		entryID, userID, s.Hanzi, s.Pinyin, s.Translation, pack.Now())
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
func Uninstall(ctx context.Context, sqlDB *sql.DB, pk string) error {
	stamp := pack.Now()
	tx, err := pack.BeginWrite(ctx, sqlDB)
	if err != nil {
		return fmt.Errorf("uninstall sentences of pack %s: %w", pk, err)
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx, `
		UPDATE sentences SET deleted_at = ?, updated_at = ?
		WHERE source_pack = ? AND user_id IS NULL AND deleted_at IS NULL`,
		stamp, stamp, pk)
	if err != nil {
		return fmt.Errorf("uninstall sentences of pack %s: %w", pk, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("uninstall sentences of pack %s: %w", pk, err)
	}
	// A registered pack with no live sentences (all skipped) still
	// uninstalls: the registry row is what the admin sees.
	reg, err := tx.ExecContext(ctx, `
		UPDATE sentence_packs SET deleted_at = ?, updated_at = ?
		WHERE pack_id = ? AND deleted_at IS NULL`, stamp, stamp, pk)
	if err != nil {
		return fmt.Errorf("uninstall sentence pack %s: %w", pk, err)
	}
	regN, err := reg.RowsAffected()
	if err != nil {
		return fmt.Errorf("uninstall sentence pack %s: %w", pk, err)
	}
	if n == 0 && regN == 0 {
		return ErrNotFound
	}
	return tx.Commit()
}

// upsertRegistry records the pack's manifest in sentence_packs inside
// tx, reviving an uninstalled row. An unchanged live row is not
// restamped, so an identical re-import writes nothing.
func upsertRegistry(ctx context.Context, tx *sql.Tx, m pack.Manifest, stamp string) error {
	if _, _, err := pack.UpsertRegistry(ctx, tx, pack.Registry{Table: "sentence_packs", PackID: m.ID, Stamp: stamp,
		Columns: pack.ManifestColumns(m, pack.Column{Name: "language", Value: m.Language})}); err != nil {
		return fmt.Errorf("register sentence pack %s: %w", m.ID, err)
	}
	return nil
}

// packData is the decoded sentences.json of a pack. OldCredits is the
// separate "credits" map earlier packs carried: the credit now sits on each
// sentence, and a pack that still has the map is refused rather than read
// without its credits.
type packData struct {
	Entries    []packEntry     `json:"entries"`
	OldCredits json.RawMessage `json:"credits"`
}

// packCredit is one sentence's credit in the pack: its owner (By), and the id
// (TID) and owner (TBy) of the translation shown with it. The sentence's own
// id is its ID. The owners may be empty (Tatoeba lists none for some CC0
// sentences).
type packCredit struct {
	By  string
	TID int64
	TBy string
}

// packEntry is one word group of sentences.json: the word its
// sentences exemplify and those sentences.
type packEntry struct {
	Word      string         `json:"word"`
	Sentences []packSentence `json:"sentences"`
}

// packSentence is one sentence of a word group. Pinyin is its reading
// (pinyin, or kana for Japanese) and may be empty.
type packSentence struct {
	// ID is the sentence's id at its source (Tatoeba); 0 for none. A sentence
	// with an id is credited by the "by", "tid" and "tby" on the sentence
	// itself (its owner, and the id and owner of its translation), joined into
	// Credit.
	ID          int64      `json:"id"`
	Hanzi       string     `json:"hanzi"`
	Pinyin      string     `json:"pinyin"`
	Translation string     `json:"translation"`
	By          string     `json:"by"`
	TID         int64      `json:"tid"`
	TBy         string     `json:"tby"`
	Credit      packCredit `json:"-"`
}

// readPack reads and validates the sentences.json in dir, rejecting
// malformed packs before anything is written: every sentence needs a
// hanzi (its text) and a translation; its reading is optional.
func readPack(dir string) ([]packEntry, error) {
	data, err := os.ReadFile(filepath.Join(dir, sentencesFile))
	if err != nil {
		return nil, fmt.Errorf("%w: read %s of %s: %v", pack.ErrInvalidPack, sentencesFile, dir, err)
	}
	var p packData
	if err := json.Unmarshal(data, &p); err != nil {
		return nil, fmt.Errorf("%w: parse %s of %s: %v", pack.ErrInvalidPack, sentencesFile, dir, err)
	}
	if len(p.Entries) == 0 {
		return nil, fmt.Errorf("%w: %s of %s: at least one entry is required", pack.ErrInvalidPack, sentencesFile, dir)
	}
	if len(p.OldCredits) != 0 {
		return nil, fmt.Errorf("%w: %s of %s: the separate \"credits\" map is gone; each sentence carries its own by, tid and tby",
			pack.ErrInvalidPack, sentencesFile, dir)
	}
	for i, g := range p.Entries {
		if strings.TrimSpace(g.Word) == "" {
			return nil, fmt.Errorf("%w: %s of %s: entry %d needs a word", pack.ErrInvalidPack, sentencesFile, dir, i)
		}
		if len(g.Sentences) == 0 {
			return nil, fmt.Errorf("%w: %s of %s: entry %d (%s) lists no sentences", pack.ErrInvalidPack, sentencesFile, dir, i, g.Word)
		}
		for j, s := range g.Sentences {
			if strings.TrimSpace(s.Hanzi) == "" || strings.TrimSpace(s.Translation) == "" {
				return nil, fmt.Errorf("%w: %s of %s: sentence %d of %s needs a hanzi and a translation",
					pack.ErrInvalidPack, sentencesFile, dir, j, g.Word)
			}
			// The reading is optional: a pack leaves it out rather than
			// guess one (a generated reading of an ambiguous word). A
			// blank one is stored empty.
			if strings.TrimSpace(s.Pinyin) == "" {
				p.Entries[i].Sentences[j].Pinyin = ""
			}
			// A sentence with an id is credited on the sentence: the
			// translation's id is required too, the owners may be empty
			// (Tatoeba lists none for some CC0 sentences). A credit without
			// an id credits nothing and is refused.
			if s.ID != 0 {
				if s.TID == 0 {
					return nil, fmt.Errorf("%w: %s of %s: sentence %d of %s has no translation id (tid)",
						pack.ErrInvalidPack, sentencesFile, dir, s.ID, g.Word)
				}
				p.Entries[i].Sentences[j].Credit = packCredit{By: s.By, TID: s.TID, TBy: s.TBy}
			} else if s.By != "" || s.TID != 0 || s.TBy != "" {
				return nil, fmt.Errorf("%w: %s of %s: sentence %d of %s has a credit but no id",
					pack.ErrInvalidPack, sentencesFile, dir, j, g.Word)
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
func writePack(ctx context.Context, sqlDB *sql.DB, m pack.Manifest, rows []sentenceRow) error {
	tx, err := pack.BeginWrite(ctx, sqlDB)
	if err != nil {
		return fmt.Errorf("import sentences %s: %w", m.ID, err)
	}
	defer tx.Rollback()
	stamp := pack.Now()
	if err := upsertRegistry(ctx, tx, m, stamp); err != nil {
		return err
	}

	// Diff against the pack's stored sentences — identified by entry,
	// text and translation — and write only the difference: an unchanged
	// sentence keeps its row and stamp, one whose reading alone changed is
	// updated in place (its id, which sentence cards keep, stays), one
	// returning from a tombstone is revived, a new one inserted, and one
	// the pack dropped tombstoned. An identical re-import therefore writes
	// nothing.
	type key struct {
		entryID          int64
		hanzi, translate string
	}
	type stored struct {
		id     int64
		pinyin string
		active bool
		credit [4]string // credit id, owner, translation id, owner
	}
	cur, err := tx.QueryContext(ctx, `
		SELECT id, entry_id, hanzi, pinyin, translation, deleted_at IS NULL,
			credit_id, credit_owner, credit_tr_id, credit_tr_owner FROM sentences
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
		var cid, ctid int64
		var cowner, ctowner string
		if err := cur.Scan(&s.id, &k.entryID, &k.hanzi, &s.pinyin, &k.translate, &s.active, &cid, &cowner, &ctid, &ctowner); err != nil {
			cur.Close()
			return fmt.Errorf("read sentences of pack %s: %w", m.ID, err)
		}
		s.credit = [4]string{strconv.FormatInt(cid, 10), cowner, strconv.FormatInt(ctid, 10), ctowner}
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
		k := key{r.entryID, r.sentence.Hanzi, r.sentence.Translation}
		if wanted[k] {
			continue // the same sentence twice (with another reading): the first wins
		}
		wanted[k] = true
		pinyin := r.sentence.Pinyin
		sc := r.sentence
		credit := [4]string{strconv.FormatInt(sc.ID, 10), sc.Credit.By, strconv.FormatInt(sc.Credit.TID, 10), sc.Credit.TBy}
		switch have, ok := existing[k]; {
		case !ok:
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO sentences (entry_id, source_pack, user_id, hanzi, pinyin, translation, updated_at,
					credit_id, credit_owner, credit_tr_id, credit_tr_owner)
				VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
				r.entryID, m.ID, k.hanzi, pinyin, k.translate, stamp,
				sc.ID, sc.Credit.By, sc.Credit.TID, sc.Credit.TBy); err != nil {
				return fmt.Errorf("insert sentence of pack %s: %w", m.ID, err)
			}
		case !have.active || have.pinyin != pinyin || have.credit != credit:
			if _, err := tx.ExecContext(ctx, `
				UPDATE sentences SET deleted_at = NULL, pinyin = ?, updated_at = ?,
					credit_id = ?, credit_owner = ?, credit_tr_id = ?, credit_tr_owner = ? WHERE id = ?`,
				pinyin, stamp, sc.ID, sc.Credit.By, sc.Credit.TID, sc.Credit.TBy, have.id); err != nil {
				return fmt.Errorf("update sentence %d of pack %s: %w", have.id, m.ID, err)
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
