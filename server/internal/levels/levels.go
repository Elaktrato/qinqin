// Package levels stores level schemes — HSK, JLPT, curriculum tables,
// any ordered ladder of levels over a language's lexicon entries — imported
// from levels packs, and derives character levels for word-based
// schemes: each character joins the lowest level whose member words are
// written with it, so hanzi carry scheme badges computed at import,
// never at query time.
package levels

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
	"unicode"
	"unicode/utf8"

	"qinqin/internal/lexicon"
	"qinqin/internal/model"
	"qinqin/internal/pack"
)

// ErrNotFound reports an uninstall or level lookup for an unknown (or
// already uninstalled) scheme or level.
var ErrNotFound = pack.NotFound("level scheme not found")

// ErrNotLevels reports an Import of a pack whose manifest type is not
// "levels". Pack dispatch happens in the seed CLI and admin layer, which
// route packs by manifest type; this guards a misrouted call.
var ErrNotLevels = errors.New("levels: manifest type is not \"levels\"")

// Member units — what a scheme's levels rank. A pack spells the
// character unit "hanzi" (the format's original word) or "character"
// (the entry kind since R8); both normalize to UnitCharacter.
const (
	UnitWord      = "word"
	UnitCharacter = "character"
)

// levelsFile is the data file of a levels pack.
const levelsFile = "levels.json"

// Result counts what one scheme import wrote.
type Result struct {
	Levels  int      // levels installed, in pack order
	Members int      // pack-listed entries joined to their levels
	Derived int      // derived character memberships written
	Skipped []string // forms with no matching entry; no entry is ever created for them
}

// member is one membership to write: an entry joined to one level of the
// imported scheme, direct from the pack or derived from a member word.
type member struct {
	level   int   // index into the pack's level list
	entry   int64 // the member entry's id
	derived bool  // computed from a member word's characters
}

// Import installs the levels pack: it registers the scheme keyed by the
// manifest id (reviving an uninstalled one) and replaces its levels and
// memberships wholesale in one transaction — superseded rows are
// soft-deleted and the new list upserted — so a re-import never leaves
// stale memberships behind. Membership resolves each listed form
// against the lexicon entries of the scheme's language and unit kind.
// A character resolves through lexicon.Store.Best by its written form,
// a word through lexicon.Store.BestWord: a form shared by several
// entries (two JMdict words written 下) resolves to the BEST-ranked one
// alone — usually-kana entries with a priority first, then priority,
// then entry id — and a word no entry has as a written form falls back
// to the kana-written words (no written form, or usually-kana) whose
// first kana reading it is, highest priority first (これ, テレビ,
// する → 為る). A one-character word no word entry has resolves to its
// character entry (CC-CEDICT gives 好 as a character): that character
// is then a direct member of the level, not a derived one. A re-import
// of the same lexicon resolves to the same entries. Unknown
// forms are skipped and reported, never created. A word-unit scheme
// also derives character levels: each distinct Han character of a
// listed form resolves the same way to a character entry and joins
// that word's level unless it already sits in an equal-or-lower level
// of the same scheme — levels are processed in pack order, so a
// character keeps the lowest level whose member words are written with
// it. Whatever the pack lists, an entry ends with one membership of the
// scheme, at its lowest level (see lowestPerEntry). Kana, other non-Han
// characters and the iteration mark 々 derive nothing; a Han character
// without an entry is skipped and reported. Character-unit schemes rank
// their members directly and derive nothing.
func Import(ctx context.Context, sqlDB *sql.DB, pk pack.Pack) (Result, error) {
	m := pk.Manifest
	// LoadPack normalizes the manifest; Import re-applies the one part
	// its own lookups key on, in case the pack arrived by another route.
	m.Language = strings.ToLower(strings.TrimSpace(m.Language))
	if err := m.Validate(); err != nil {
		return Result{}, fmt.Errorf("%w: %v", pack.ErrInvalidPack, err)
	}
	if m.Type != pack.TypeLevels {
		return Result{}, fmt.Errorf("%w: %q is a %s pack", ErrNotLevels, m.ID, m.Type)
	}
	if m.Format != pack.FormatJSON {
		return Result{}, fmt.Errorf("%w: levels pack format %q is not implemented (want json)", pack.ErrInvalidPack, m.Format)
	}
	unit, lvls, err := readLevelsPack(pk.Dir)
	if err != nil {
		return Result{}, err
	}

	// Resolve and derive before writing anything: level packs never
	// create entries, so every membership must already exist.
	store := lexicon.Store{DB: sqlDB}
	var (
		ms         []member
		skipped    []string
		charLowest = map[int64]int{} // a derived character's entry id -> its lowest level so far
		skippedSet = map[string]bool{}
	)
	skip := func(form string) { // each unknown form is reported once, in first-seen order
		if !skippedSet[form] {
			skippedSet[form] = true
			skipped = append(skipped, form)
		}
	}
	for i, lv := range lvls {
		seen := map[int64]bool{}
		for _, pe := range lv.Entries {
			form := pe.Form
			var e *lexicon.Entry
			if unit == UnitWord {
				e, err = store.BestWordReading(ctx, m.Language, form, pe.Reading)
				if errors.Is(err, lexicon.ErrNotFound) && utf8.RuneCountInString(form) == 1 {
					// A one-character word (HSK's 好) is a character
					// entry in CC-CEDICT: the character is the member.
					e, err = store.Best(ctx, m.Language, UnitCharacter, form)
				}
			} else {
				e, err = store.Best(ctx, m.Language, unit, form)
			}
			if errors.Is(err, lexicon.ErrNotFound) {
				skip(form)
				continue
			}
			if err != nil {
				return Result{}, fmt.Errorf("import scheme %s: %w", m.ID, err)
			}
			if seen[e.ID] { // the same form listed twice joins once
				continue
			}
			seen[e.ID] = true
			ms = append(ms, member{level: i, entry: e.ID})

			if unit != UnitWord {
				continue
			}
			for _, r := range distinctHan(form) {
				c, err := store.Best(ctx, m.Language, UnitCharacter, string(r))
				if errors.Is(err, lexicon.ErrNotFound) {
					skip(string(r))
					continue
				}
				if err != nil {
					return Result{}, fmt.Errorf("import scheme %s: %w", m.ID, err)
				}
				if lowest, ok := charLowest[c.ID]; ok && lowest <= i {
					continue // already in an equal-or-lower level: it keeps that one
				}
				charLowest[c.ID] = i
				if c.ID == e.ID {
					continue // the word is this character: a direct member already
				}
				ms = append(ms, member{level: i, entry: c.ID, derived: true})
			}
		}
	}
	ms = lowestPerEntry(ms)

	var result Result
	for _, mem := range ms {
		if mem.derived {
			result.Derived++
		} else {
			result.Members++
		}
	}
	result.Levels = len(lvls)
	result.Skipped = skipped
	if result.Skipped == nil {
		result.Skipped = []string{}
	}
	if err := writeScheme(ctx, sqlDB, m, unit, lvls, ms); err != nil {
		return Result{}, err
	}
	return result, nil
}

// Uninstall soft-deletes the scheme with row id id and all of its levels
// and memberships. Entries survive — dictionaries and user data
// reference them — and re-importing the pack revives the scheme. An
// unknown or already-uninstalled scheme returns ErrNotFound.
func Uninstall(ctx context.Context, sqlDB *sql.DB, id int64) error {
	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("uninstall scheme %d: %w", id, err)
	}
	defer tx.Rollback()
	stamp := now()
	if _, err := tx.ExecContext(ctx, `
		UPDATE level_members SET deleted_at = ?, updated_at = ?
		WHERE deleted_at IS NULL AND level_id IN (
			SELECT id FROM levels WHERE scheme_id = ?)`,
		stamp, stamp, id); err != nil {
		return fmt.Errorf("uninstall members of scheme %d: %w", id, err)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE levels SET deleted_at = ?, updated_at = ?
		WHERE scheme_id = ? AND deleted_at IS NULL`,
		stamp, stamp, id); err != nil {
		return fmt.Errorf("uninstall levels of scheme %d: %w", id, err)
	}
	res, err := tx.ExecContext(ctx, `
		UPDATE schemes SET deleted_at = ?, updated_at = ?
		WHERE id = ? AND deleted_at IS NULL`,
		stamp, stamp, id)
	if err != nil {
		return fmt.Errorf("uninstall scheme %d: %w", id, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("uninstall scheme %d: %w", id, err)
	}
	if n == 0 {
		return ErrNotFound
	}
	return tx.Commit()
}

// List returns every installed scheme with its ordered levels, in
// install order.
func List(ctx context.Context, sqlDB *sql.DB) ([]model.Scheme, error) {
	rows, err := sqlDB.QueryContext(ctx, `
		SELECT id, pack_id, name, unit, language, version, license, attribution, notice, updated_at
		FROM schemes WHERE deleted_at IS NULL ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("list schemes: %w", err)
	}
	defer rows.Close()

	schemes := make([]model.Scheme, 0)
	for rows.Next() {
		var (
			s         model.Scheme
			updatedAt string
		)
		if err := rows.Scan(&s.ID, &s.PackID, &s.Name, &s.Unit, &s.Language,
			&s.Version, &s.License, &s.Attribution, &s.Notice, &updatedAt); err != nil {
			return nil, fmt.Errorf("list schemes: %w", err)
		}
		updated, err := time.Parse(time.RFC3339, updatedAt)
		if err != nil {
			return nil, fmt.Errorf("parse updated_at %q of scheme %d: %w", updatedAt, s.ID, err)
		}
		s.UpdatedAt = updated
		s.Levels = []model.Level{} // marshal as [], not null
		schemes = append(schemes, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list schemes: %w", err)
	}
	byID := make(map[int64]*model.Scheme, len(schemes))
	for i := range schemes {
		byID[schemes[i].ID] = &schemes[i]
	}

	levelRows, err := sqlDB.QueryContext(ctx, `
		SELECT id, scheme_id, ord, name, updated_at
		FROM levels WHERE deleted_at IS NULL ORDER BY scheme_id, ord`)
	if err != nil {
		return nil, fmt.Errorf("list levels: %w", err)
	}
	defer levelRows.Close()
	for levelRows.Next() {
		var (
			l         model.Level
			updatedAt string
		)
		if err := levelRows.Scan(&l.ID, &l.SchemeID, &l.Ord, &l.Name, &updatedAt); err != nil {
			return nil, fmt.Errorf("list levels: %w", err)
		}
		updated, err := time.Parse(time.RFC3339, updatedAt)
		if err != nil {
			return nil, fmt.Errorf("parse updated_at %q of level %d: %w", updatedAt, l.ID, err)
		}
		l.UpdatedAt = updated
		s, ok := byID[l.SchemeID]
		if !ok { // a level of an uninstalled scheme: not listed
			continue
		}
		s.Levels = append(s.Levels, l)
	}
	if err := levelRows.Err(); err != nil {
		return nil, fmt.Errorf("list levels: %w", err)
	}
	return schemes, nil
}

// ForEntry returns every active scheme's badges on the entry: one per
// membership, ordered by scheme then level order.
func ForEntry(ctx context.Context, sqlDB *sql.DB, entryID int64) ([]model.Badge, error) {
	rows, err := sqlDB.QueryContext(ctx, `
		SELECT s.id, s.name, l.name, m.derived
		FROM level_members m
		JOIN levels l ON l.id = m.level_id AND l.deleted_at IS NULL
		JOIN schemes s ON s.id = l.scheme_id AND s.deleted_at IS NULL
		WHERE m.entry_id = ? AND m.deleted_at IS NULL
		ORDER BY s.id, l.ord`, entryID)
	if err != nil {
		return nil, fmt.Errorf("badges of entry %d: %w", entryID, err)
	}
	defer rows.Close()

	badges := make([]model.Badge, 0)
	for rows.Next() {
		var b model.Badge
		if err := rows.Scan(&b.SchemeID, &b.SchemeName, &b.LevelName, &b.Derived); err != nil {
			return nil, fmt.Errorf("badges of entry %d: %w", entryID, err)
		}
		badges = append(badges, b)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("badges of entry %d: %w", entryID, err)
	}
	return badges, nil
}

// EntryIDs returns the ids of the entries that are members of the named
// level of the scheme, in membership order. An unknown or uninstalled
// scheme or level returns ErrNotFound.
func EntryIDs(ctx context.Context, sqlDB *sql.DB, schemeID int64, levelName string) ([]int64, error) {
	var levelID int64
	err := sqlDB.QueryRowContext(ctx, `
		SELECT l.id FROM levels l
		JOIN schemes s ON s.id = l.scheme_id
		WHERE s.id = ? AND s.deleted_at IS NULL
			AND l.deleted_at IS NULL AND l.name = ?`,
		schemeID, levelName).Scan(&levelID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("find level %q of scheme %d: %w", levelName, schemeID, err)
	}

	rows, err := sqlDB.QueryContext(ctx, `
		SELECT entry_id FROM level_members
		WHERE level_id = ? AND deleted_at IS NULL
		ORDER BY id`, levelID)
	if err != nil {
		return nil, fmt.Errorf("members of level %q of scheme %d: %w", levelName, schemeID, err)
	}
	defer rows.Close()

	ids := make([]int64, 0)
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("members of level %q of scheme %d: %w", levelName, schemeID, err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("members of level %q of scheme %d: %w", levelName, schemeID, err)
	}
	return ids, nil
}

// SchemeEntryIDs returns the ids of the entries that are active members of
// any active level of the scheme, in level order and then entry id, each
// once even when several levels list it. An unknown or uninstalled scheme
// returns ErrNotFound.
func SchemeEntryIDs(ctx context.Context, sqlDB *sql.DB, schemeID int64) ([]int64, error) {
	var exists int
	err := sqlDB.QueryRowContext(ctx, `
		SELECT 1 FROM schemes WHERE id = ? AND deleted_at IS NULL`, schemeID).Scan(&exists)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("find scheme %d: %w", schemeID, err)
	}

	rows, err := sqlDB.QueryContext(ctx, `
		SELECT m.entry_id
		FROM level_members m
		JOIN levels l ON l.id = m.level_id AND l.deleted_at IS NULL
		WHERE l.scheme_id = ? AND m.deleted_at IS NULL
		GROUP BY m.entry_id
		ORDER BY MIN(l.ord), m.entry_id`, schemeID)
	if err != nil {
		return nil, fmt.Errorf("members of scheme %d: %w", schemeID, err)
	}
	defer rows.Close()

	ids := make([]int64, 0)
	for rows.Next() {
		var entryID int64
		if err := rows.Scan(&entryID); err != nil {
			return nil, fmt.Errorf("members of scheme %d: %w", schemeID, err)
		}
		ids = append(ids, entryID)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("members of scheme %d: %w", schemeID, err)
	}
	return ids, nil
}

// levelsPack is the decoded levels.json of a pack.
type levelsPack struct {
	Unit   string      `json:"unit"`
	Levels []packLevel `json:"levels"`
}

// packLevel is one level of a levels.json pack: a name and the entries
// that belong to it.
type packLevel struct {
	Name    string      `json:"name"`
	Entries []packEntry `json:"entries"`
}

// packEntry is one listed entry: a written form, spelled as a plain JSON
// string, or an object {"form": "風", "reading": "かぜ"} whose optional
// reading picks, among the words written with the form, the one read so
// (see lexicon.Store.BestWordReading).
type packEntry struct {
	Form    string `json:"form"`
	Reading string `json:"reading,omitempty"`
}

// UnmarshalJSON accepts both spellings of a packEntry.
func (p *packEntry) UnmarshalJSON(data []byte) error {
	var form string
	if err := json.Unmarshal(data, &form); err == nil {
		*p = packEntry{Form: form}
		return nil
	}
	type plain packEntry
	var v plain
	if err := json.Unmarshal(data, &v); err != nil {
		return fmt.Errorf("an entry is a string or {\"form\", \"reading\"}: %w", err)
	}
	*p = packEntry(v)
	return nil
}

// readLevelsPack reads and validates the levels.json in dir, rejecting
// malformed packs before anything is written. The character unit may
// spell itself "hanzi" or "character"; both normalize to
// UnitCharacter.
func readLevelsPack(dir string) (string, []packLevel, error) {
	data, err := os.ReadFile(filepath.Join(dir, levelsFile))
	if err != nil {
		return "", nil, fmt.Errorf("%w: read %s of %s: %v", pack.ErrInvalidPack, levelsFile, dir, err)
	}
	var p levelsPack
	if err := json.Unmarshal(data, &p); err != nil {
		return "", nil, fmt.Errorf("%w: parse %s of %s: %v", pack.ErrInvalidPack, levelsFile, dir, err)
	}

	unit := strings.ToLower(strings.TrimSpace(p.Unit))
	switch unit {
	case UnitWord:
	case "hanzi", UnitCharacter:
		unit = UnitCharacter
	default:
		return "", nil, fmt.Errorf("%w: %s of %s: unit %q must be word, hanzi or character", pack.ErrInvalidPack, levelsFile, dir, p.Unit)
	}
	if len(p.Levels) == 0 {
		return "", nil, fmt.Errorf("%w: %s of %s: at least one level is required", pack.ErrInvalidPack, levelsFile, dir)
	}
	// Names, forms and readings are stored and compared trimmed, so
	// "1" and " 1" are one level name and " 你好" finds 你好.
	names := make(map[string]bool, len(p.Levels))
	for i := range p.Levels {
		lv := &p.Levels[i]
		lv.Name = strings.TrimSpace(lv.Name)
		for j := range lv.Entries {
			lv.Entries[j].Form = strings.TrimSpace(lv.Entries[j].Form)
			lv.Entries[j].Reading = strings.TrimSpace(lv.Entries[j].Reading)
		}
		if lv.Name == "" {
			return "", nil, fmt.Errorf("%w: %s of %s: level %d needs a name", pack.ErrInvalidPack, levelsFile, dir, i)
		}
		if names[lv.Name] {
			return "", nil, fmt.Errorf("%w: %s of %s: level name %q appears twice", pack.ErrInvalidPack, levelsFile, dir, lv.Name)
		}
		names[lv.Name] = true
		for j, pe := range lv.Entries {
			if strings.TrimSpace(pe.Form) == "" {
				return "", nil, fmt.Errorf("%w: %s of %s: entry %d of level %q is empty", pack.ErrInvalidPack, levelsFile, dir, j, lv.Name)
			}
		}
	}
	return unit, p.Levels, nil
}

// writeScheme registers the scheme keyed by its manifest id and replaces
// its levels and memberships in one transaction: the previous rows are
// tombstoned and the pack's list then upserted, reviving the rows this
// scheme used before — level ids stay stable across re-imports.
func writeScheme(ctx context.Context, sqlDB *sql.DB, m pack.Manifest, unit string, lvls []packLevel, ms []member) error {
	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("import scheme %s: %w", m.ID, err)
	}
	defer tx.Rollback()
	stamp := now()

	// The scheme row is written only when a manifest field (the notice
	// included) or the unit changed, or the scheme returns from an
	// uninstall: an identical re-import does not restamp it.
	var schemeID int64
	err = tx.QueryRowContext(ctx, `
		INSERT INTO schemes (pack_id, name, unit, language, version, license, attribution, notice, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (pack_id) DO UPDATE SET
			name = excluded.name,
			unit = excluded.unit,
			language = excluded.language,
			version = excluded.version,
			license = excluded.license,
			attribution = excluded.attribution,
			notice = excluded.notice,
			updated_at = excluded.updated_at,
			deleted_at = NULL
		WHERE schemes.name IS NOT excluded.name OR schemes.unit IS NOT excluded.unit
		   OR schemes.language IS NOT excluded.language OR schemes.version IS NOT excluded.version
		   OR schemes.license IS NOT excluded.license OR schemes.attribution IS NOT excluded.attribution
		   OR schemes.notice IS NOT excluded.notice
		   OR schemes.deleted_at IS NOT NULL
		RETURNING id`,
		m.ID, m.Name, unit, m.Language, m.Version, m.License, m.Attribution, m.Notice, stamp).Scan(&schemeID)
	if errors.Is(err, sql.ErrNoRows) {
		// Unchanged: the conflict update's WHERE skipped the write.
		err = tx.QueryRowContext(ctx, `SELECT id FROM schemes WHERE pack_id = ?`, m.ID).Scan(&schemeID)
	}
	if err != nil {
		return fmt.Errorf("register scheme %s: %w", m.ID, err)
	}

	// Levels and memberships are diffed against what is stored, writing
	// only the difference: unchanged rows keep their id and stamp (so an
	// identical re-import ships nothing to clients), changed or returning
	// rows are updated or revived in place, and rows the pack no longer
	// lists are tombstoned so a re-import never leaves stale levels or
	// members behind.
	levelIDs, err := diffLevels(ctx, tx, schemeID, lvls, stamp)
	if err != nil {
		return fmt.Errorf("import scheme %s: %w", m.ID, err)
	}
	if err := diffMembers(ctx, tx, schemeID, levelIDs, ms, stamp); err != nil {
		return fmt.Errorf("import scheme %s: %w", m.ID, err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("import scheme %s: %w", m.ID, err)
	}
	return nil
}

// diffLevels brings the scheme's levels to exactly lvls (by name, in
// order), writing only differences, and returns each level's row id in
// the pack's order.
func diffLevels(ctx context.Context, tx *sql.Tx, schemeID int64, lvls []packLevel, stamp string) ([]int64, error) {
	type stored struct {
		id     int64
		ord    int
		active bool
	}
	rows, err := tx.QueryContext(ctx, `
		SELECT id, name, ord, deleted_at IS NULL FROM levels WHERE scheme_id = ?`, schemeID)
	if err != nil {
		return nil, fmt.Errorf("read levels: %w", err)
	}
	existing := map[string]stored{}
	for rows.Next() {
		var (
			name string
			s    stored
		)
		if err := rows.Scan(&s.id, &name, &s.ord, &s.active); err != nil {
			rows.Close()
			return nil, fmt.Errorf("read levels: %w", err)
		}
		existing[name] = s
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, fmt.Errorf("read levels: %w", err)
	}

	ids := make([]int64, len(lvls))
	wanted := make(map[string]bool, len(lvls))
	for i, lv := range lvls {
		wanted[lv.Name] = true
		cur, ok := existing[lv.Name]
		switch {
		case !ok:
			if err := tx.QueryRowContext(ctx, `
				INSERT INTO levels (scheme_id, ord, name, updated_at) VALUES (?, ?, ?, ?)
				RETURNING id`, schemeID, i, lv.Name, stamp).Scan(&ids[i]); err != nil {
				return nil, fmt.Errorf("insert level %q: %w", lv.Name, err)
			}
		case cur.active && cur.ord == i:
			ids[i] = cur.id
		default: // moved, or returning from a tombstone
			ids[i] = cur.id
			if _, err := tx.ExecContext(ctx, `
				UPDATE levels SET ord = ?, deleted_at = NULL, updated_at = ? WHERE id = ?`,
				i, stamp, cur.id); err != nil {
				return nil, fmt.Errorf("update level %q: %w", lv.Name, err)
			}
		}
	}
	for name, s := range existing {
		if s.active && !wanted[name] {
			if _, err := tx.ExecContext(ctx, `
				UPDATE levels SET deleted_at = ?, updated_at = ? WHERE id = ?`,
				stamp, stamp, s.id); err != nil {
				return nil, fmt.Errorf("retire level %q: %w", name, err)
			}
		}
	}
	return ids, nil
}

// diffMembers brings the scheme's memberships to exactly ms (levels
// resolved through levelIDs), writing only differences. Memberships of
// a level that was dropped are not in ms, so they are tombstoned here.
func diffMembers(ctx context.Context, tx *sql.Tx, schemeID int64, levelIDs []int64, ms []member, stamp string) error {
	type key struct{ level, entry int64 }
	type stored struct {
		id      int64
		derived bool
		active  bool
	}
	rows, err := tx.QueryContext(ctx, `
		SELECT m.id, m.level_id, m.entry_id, m.derived, m.deleted_at IS NULL
		FROM level_members m JOIN levels l ON l.id = m.level_id
		WHERE l.scheme_id = ?`, schemeID)
	if err != nil {
		return fmt.Errorf("read members: %w", err)
	}
	existing := map[key]stored{}
	for rows.Next() {
		var (
			k       key
			s       stored
			derived int
		)
		if err := rows.Scan(&s.id, &k.level, &k.entry, &derived, &s.active); err != nil {
			rows.Close()
			return fmt.Errorf("read members: %w", err)
		}
		s.derived = derived != 0
		existing[k] = s
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return fmt.Errorf("read members: %w", err)
	}

	wanted := make(map[key]bool, len(ms))
	for _, mem := range ms {
		k := key{levelIDs[mem.level], mem.entry}
		if wanted[k] {
			continue
		}
		wanted[k] = true
		cur, ok := existing[k]
		switch {
		case !ok:
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO level_members (level_id, entry_id, derived, updated_at) VALUES (?, ?, ?, ?)`,
				k.level, k.entry, mem.derived, stamp); err != nil {
				return fmt.Errorf("insert member: %w", err)
			}
		case cur.active && cur.derived == mem.derived:
			// unchanged
		default: // flag changed, or returning from a tombstone
			if _, err := tx.ExecContext(ctx, `
				UPDATE level_members SET derived = ?, deleted_at = NULL, updated_at = ? WHERE id = ?`,
				mem.derived, stamp, cur.id); err != nil {
				return fmt.Errorf("update member %d: %w", cur.id, err)
			}
		}
	}
	for k, s := range existing {
		if s.active && !wanted[k] {
			if _, err := tx.ExecContext(ctx, `
				UPDATE level_members SET deleted_at = ?, updated_at = ? WHERE id = ?`,
				stamp, stamp, s.id); err != nil {
				return fmt.Errorf("retire member %d: %w", s.id, err)
			}
		}
	}
	return nil
}

// lowestPerEntry keeps one membership per entry, in first-seen order:
// at the entry's lowest level, whatever the pack lists — a word repeated
// at a higher level (HSK lists senses apart: 好 at 1, 2 and 4) or a
// character derived low and listed higher (些) carries one badge of the
// scheme. At that level a direct membership wins over a derived one,
// even when a word of the level derived it first (好人 before 好).
func lowestPerEntry(ms []member) []member {
	best := make(map[int64]member, len(ms))
	for _, mem := range ms {
		cur, ok := best[mem.entry]
		switch {
		case !ok, mem.level < cur.level:
			best[mem.entry] = mem
		case mem.level == cur.level && !mem.derived:
			cur.derived = false
			best[mem.entry] = cur
		}
	}
	out := ms[:0]
	for _, mem := range ms {
		if b, ok := best[mem.entry]; ok {
			out = append(out, b)
			delete(best, mem.entry)
		}
	}
	return out
}

// iterationMark 々 is Han script but repeats the character before it: it
// is no character of its own and derives no level.
const iterationMark = '々'

// distinctHan returns the Han characters of written, each once, in
// order; kana, other scripts and the iteration mark 々 are left out.
func distinctHan(written string) []rune {
	seen := make(map[rune]bool, len(written))
	rs := make([]rune, 0, len(written))
	for _, r := range written {
		if seen[r] || r == iterationMark || !unicode.Is(unicode.Han, r) {
			continue
		}
		seen[r] = true
		rs = append(rs, r)
	}
	return rs
}

// now returns the server clock as UTC RFC 3339, the timestamp
// convention for every write.
func now() string {
	return time.Now().UTC().Format(time.RFC3339)
}
