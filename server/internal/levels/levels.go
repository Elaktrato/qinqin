// Package levels stores level schemes — HSK, JLPT, curriculum tables,
// any ordered ladder of levels over a language's entries — imported
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

	"qinqin/internal/dict"
	"qinqin/internal/entries"
	"qinqin/internal/model"
)

// ErrNotFound reports an uninstall or level lookup for an unknown (or
// already uninstalled) scheme or level.
var ErrNotFound = errors.New("level scheme not found")

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
// against an existing entry of the scheme's language and unit kind:
// unknown forms are skipped and reported, never created. A word-unit
// scheme also derives character levels: each distinct character of a
// member word joins that word's level unless it already sits in an
// equal-or-lower level of the same scheme — levels are processed in
// pack order, so a character keeps the lowest level whose member words
// are written with it. Character-unit schemes rank their members
// directly and derive nothing.
func Import(ctx context.Context, sqlDB *sql.DB, pack dict.Pack) (Result, error) {
	m := pack.Manifest
	// LoadPack normalizes the manifest; Import re-applies the one part
	// its own lookups key on, in case the pack arrived by another route.
	m.Language = strings.ToLower(strings.TrimSpace(m.Language))
	if err := m.Validate(); err != nil {
		return Result{}, fmt.Errorf("%w: %v", dict.ErrInvalidPack, err)
	}
	if m.Type != dict.TypeLevels {
		return Result{}, fmt.Errorf("%w: %q is a %s pack", ErrNotLevels, m.ID, m.Type)
	}
	if m.Format != dict.FormatJSON {
		return Result{}, fmt.Errorf("%w: levels pack format %q is not implemented (want json)", dict.ErrInvalidPack, m.Format)
	}
	unit, lvls, err := readLevelsPack(pack.Dir)
	if err != nil {
		return Result{}, err
	}

	// Resolve and derive before writing anything: level packs never
	// create entries, so every membership must already exist.
	store := entries.Store{DB: sqlDB}
	var (
		ms         []member
		skipped    []string
		charLowest = map[int64]int{} // a derived character's entry id -> its lowest level so far
	)
	for i, lv := range lvls {
		seen := map[int64]bool{}
		for _, form := range lv.Entries {
			e, err := store.GetByWritten(ctx, form, unit, m.Language)
			if errors.Is(err, entries.ErrNotFound) {
				skipped = append(skipped, form)
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
			for _, r := range distinctRunes(e.Written) {
				c, err := store.GetByWritten(ctx, string(r), UnitCharacter, m.Language)
				if errors.Is(err, entries.ErrNotFound) {
					skipped = append(skipped, string(r))
					continue
				}
				if err != nil {
					return Result{}, fmt.Errorf("import scheme %s: %w", m.ID, err)
				}
				if lowest, ok := charLowest[c.ID]; ok && lowest <= i {
					continue // already in an equal-or-lower level: it keeps that one
				}
				charLowest[c.ID] = i
				ms = append(ms, member{level: i, entry: c.ID, derived: true})
			}
		}
	}

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
		SELECT id, pack_id, name, unit, language, version, license, attribution, updated_at
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
			&s.Version, &s.License, &s.Attribution, &updatedAt); err != nil {
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

// levelsPack is the decoded levels.json of a pack.
type levelsPack struct {
	Unit   string      `json:"unit"`
	Levels []packLevel `json:"levels"`
}

// packLevel is one level of a levels.json pack: a name and the written
// forms that belong to it.
type packLevel struct {
	Name    string   `json:"name"`
	Entries []string `json:"entries"`
}

// readLevelsPack reads and validates the levels.json in dir, rejecting
// malformed packs before anything is written. The character unit may
// spell itself "hanzi" or "character"; both normalize to
// UnitCharacter.
func readLevelsPack(dir string) (string, []packLevel, error) {
	data, err := os.ReadFile(filepath.Join(dir, levelsFile))
	if err != nil {
		return "", nil, fmt.Errorf("%w: read %s of %s: %v", dict.ErrInvalidPack, levelsFile, dir, err)
	}
	var p levelsPack
	if err := json.Unmarshal(data, &p); err != nil {
		return "", nil, fmt.Errorf("%w: parse %s of %s: %v", dict.ErrInvalidPack, levelsFile, dir, err)
	}

	unit := strings.ToLower(strings.TrimSpace(p.Unit))
	switch unit {
	case UnitWord:
	case "hanzi", UnitCharacter:
		unit = UnitCharacter
	default:
		return "", nil, fmt.Errorf("%w: %s of %s: unit %q must be word or hanzi", dict.ErrInvalidPack, levelsFile, dir, p.Unit)
	}
	if len(p.Levels) == 0 {
		return "", nil, fmt.Errorf("%w: %s of %s: at least one level is required", dict.ErrInvalidPack, levelsFile, dir)
	}
	names := make(map[string]bool, len(p.Levels))
	for i, lv := range p.Levels {
		if strings.TrimSpace(lv.Name) == "" {
			return "", nil, fmt.Errorf("%w: %s of %s: level %d needs a name", dict.ErrInvalidPack, levelsFile, dir, i)
		}
		if names[lv.Name] {
			return "", nil, fmt.Errorf("%w: %s of %s: level name %q appears twice", dict.ErrInvalidPack, levelsFile, dir, lv.Name)
		}
		names[lv.Name] = true
		for j, form := range lv.Entries {
			if strings.TrimSpace(form) == "" {
				return "", nil, fmt.Errorf("%w: %s of %s: entry %d of level %q is empty", dict.ErrInvalidPack, levelsFile, dir, j, lv.Name)
			}
		}
	}
	return unit, p.Levels, nil
}

// writeScheme registers the scheme keyed by its manifest id and replaces
// its levels and memberships in one transaction: the previous rows are
// tombstoned and the pack's list then upserted, reviving the rows this
// scheme used before — level ids stay stable across re-imports.
func writeScheme(ctx context.Context, sqlDB *sql.DB, m dict.Manifest, unit string, lvls []packLevel, ms []member) error {
	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("import scheme %s: %w", m.ID, err)
	}
	defer tx.Rollback()
	stamp := now()

	var schemeID int64
	if err := tx.QueryRowContext(ctx, `
		INSERT INTO schemes (pack_id, name, unit, language, version, license, attribution, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (pack_id) DO UPDATE SET
			name = excluded.name,
			unit = excluded.unit,
			language = excluded.language,
			version = excluded.version,
			license = excluded.license,
			attribution = excluded.attribution,
			updated_at = excluded.updated_at,
			deleted_at = NULL
		RETURNING id`,
		m.ID, m.Name, unit, m.Language, m.Version, m.License, m.Attribution, stamp).Scan(&schemeID); err != nil {
		return fmt.Errorf("register scheme %s: %w", m.ID, err)
	}

	// Memberships replace wholesale, the readings and senses
	// discipline: previous rows are tombstoned so a re-import never
	// leaves stale levels or members behind.
	if _, err := tx.ExecContext(ctx, `
		UPDATE level_members SET deleted_at = ?, updated_at = ?
		WHERE deleted_at IS NULL AND level_id IN (
			SELECT id FROM levels WHERE scheme_id = ?)`,
		stamp, stamp, schemeID); err != nil {
		return fmt.Errorf("retire members of scheme %s: %w", m.ID, err)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE levels SET deleted_at = ?, updated_at = ?
		WHERE scheme_id = ? AND deleted_at IS NULL`,
		stamp, stamp, schemeID); err != nil {
		return fmt.Errorf("retire levels of scheme %s: %w", m.ID, err)
	}

	levelIDs := make([]int64, len(lvls))
	for i, lv := range lvls {
		if err := tx.QueryRowContext(ctx, `
			INSERT INTO levels (scheme_id, ord, name, updated_at)
			VALUES (?, ?, ?, ?)
			ON CONFLICT (scheme_id, name) DO UPDATE SET
				ord = excluded.ord,
				updated_at = excluded.updated_at,
				deleted_at = NULL
			RETURNING id`,
			schemeID, i, lv.Name, stamp).Scan(&levelIDs[i]); err != nil {
			return fmt.Errorf("upsert level %q of scheme %s: %w", lv.Name, m.ID, err)
		}
	}
	for _, mem := range ms {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO level_members (level_id, entry_id, derived, updated_at)
			VALUES (?, ?, ?, ?)
			ON CONFLICT (level_id, entry_id) DO UPDATE SET
				derived = excluded.derived,
				updated_at = excluded.updated_at,
				deleted_at = NULL`,
			levelIDs[mem.level], mem.entry, mem.derived, stamp); err != nil {
			return fmt.Errorf("upsert member of scheme %s: %w", m.ID, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("import scheme %s: %w", m.ID, err)
	}
	return nil
}

// distinctRunes returns written's characters, each once, in order.
func distinctRunes(written string) []rune {
	seen := make(map[rune]bool, len(written))
	rs := make([]rune, 0, len(written))
	for _, r := range written {
		if seen[r] {
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
