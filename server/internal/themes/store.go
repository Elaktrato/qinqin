package themes

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"time"

	"qinqin/internal/pack"
)

// DataFile is the data file of a theme pack.
const DataFile = "themes.json"

// ErrNotFound reports an uninstall of an unknown or already uninstalled
// theme pack.
var ErrNotFound = pack.NotFound("themes: pack not found")

// Result counts an import.
type Result struct{ Themes int }

// Querier is what the readers go through (*sql.DB or *sql.Tx).
type Querier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// LoadFile reads and validates the themes.json of the pack in dir. Errors
// are pack.ErrInvalidPack naming the file, the code and the path.
func LoadFile(dir string) ([]Theme, error) {
	f, err := os.Open(filepath.Join(dir, DataFile))
	if err != nil {
		return nil, fmt.Errorf("%w: %s: %v", pack.ErrInvalidPack, DataFile, err)
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, MaxFileBytes+1))
	if err != nil {
		return nil, fmt.Errorf("%w: %s: %v", pack.ErrInvalidPack, DataFile, err)
	}
	list, err := ParseFile(data)
	if err != nil {
		return nil, fmt.Errorf("%w: %s: %v", pack.ErrInvalidPack, DataFile, err)
	}
	return list, nil
}

// checkManifest refuses a manifest that is not a theme pack's.
func checkManifest(m pack.Manifest) error {
	if err := m.Validate(); err != nil {
		return fmt.Errorf("%w: %v", pack.ErrInvalidPack, err)
	}
	if m.Type != pack.TypeTheme || m.Format != pack.FormatThemesJSON {
		return fmt.Errorf("%w: %q is a %s pack (format %s), not a theme pack", pack.ErrInvalidPack, m.ID, m.Type, m.Format)
	}
	return nil
}

// CheckPack validates the theme pack p as Import would — manifest, themes.json
// and the ids against the built-in themes — without the installed packs
// (Import checks those inside its transaction). The staged upload calls it
// to review a pack before anything is stored.
func CheckPack(p pack.Pack) ([]Theme, error) {
	if err := checkManifest(p.Manifest); err != nil {
		return nil, err
	}
	list, err := LoadFile(p.Dir)
	if err != nil {
		return nil, err
	}
	if err := checkBuiltinClash(p.ID, list); err != nil {
		return nil, err
	}
	return list, nil
}

// checkBuiltinClash refuses a pack id or theme id the binary's built-in
// themes use.
func checkBuiltinClash(packID string, list []Theme) error {
	for _, b := range Builtin() {
		if b.Manifest.ID == packID {
			return fmt.Errorf("%w: the pack id %q belongs to a built-in theme pack", pack.ErrInvalidPack, packID)
		}
		for _, bt := range b.Themes {
			for _, t := range list {
				if t.ID == bt.ID {
					return fmt.Errorf("%w: the theme id %q belongs to the built-in theme pack %q", pack.ErrInvalidPack, t.ID, b.Manifest.ID)
				}
			}
		}
	}
	return nil
}

// Import installs the theme pack p: its themes.json is validated
// (ParseFile), the pack id and theme ids must not be built-in ones, and no
// theme id may belong to another installed pack. One transaction upserts the
// theme_packs row (clearing an uninstall) and replaces the pack's themes. An
// identical re-import (same themes and manifest fields) writes nothing.
func Import(ctx context.Context, sqlDB *sql.DB, p pack.Pack) (Result, error) {
	list, err := CheckPack(p)
	if err != nil {
		return Result{}, err
	}
	m := p.Manifest
	rows := make([][]byte, len(list))
	h := sha256.New()
	for i, t := range list {
		if rows[i], err = t.MarshalJSON(); err != nil {
			return Result{}, fmt.Errorf("import theme pack %s: %w", m.ID, err)
		}
		h.Write(rows[i])
		h.Write([]byte{'\n'})
	}
	hash := hex.EncodeToString(h.Sum(nil))

	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return Result{}, fmt.Errorf("import theme pack %s: %w", m.ID, err)
	}
	defer tx.Rollback()
	for _, t := range list {
		var owner string
		err := tx.QueryRowContext(ctx, `SELECT pack_id FROM themes WHERE theme_id = ? AND pack_id != ?`, t.ID, m.ID).Scan(&owner)
		switch {
		case err == nil:
			return Result{}, fmt.Errorf("%w: the theme id %q belongs to the installed theme pack %q", pack.ErrInvalidPack, t.ID, owner)
		case !errors.Is(err, sql.ErrNoRows):
			return Result{}, fmt.Errorf("import theme pack %s: %w", m.ID, err)
		}
	}
	var (
		name, version, license, attribution, notice, oldHash string
		deleted                                              sql.NullString
	)
	err = tx.QueryRowContext(ctx, `
		SELECT name, version, license, attribution, notice, content_hash, deleted_at
		FROM theme_packs WHERE pack_id = ?`, m.ID).
		Scan(&name, &version, &license, &attribution, &notice, &oldHash, &deleted)
	stamp := time.Now().UTC().Format(time.RFC3339)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO theme_packs (pack_id, name, version, license, attribution, notice, content_hash, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			m.ID, m.Name, m.Version, m.License, m.Attribution, m.Notice, hash, stamp); err != nil {
			return Result{}, fmt.Errorf("register theme pack %s: %w", m.ID, err)
		}
	case err != nil:
		return Result{}, fmt.Errorf("import theme pack %s: %w", m.ID, err)
	default:
		if !deleted.Valid && oldHash == hash && name == m.Name && version == m.Version &&
			license == m.License && attribution == m.Attribution && notice == m.Notice {
			return Result{Themes: len(list)}, nil // identical: nothing to write
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE theme_packs SET name = ?, version = ?, license = ?, attribution = ?, notice = ?,
				content_hash = ?, updated_at = ?, deleted_at = NULL
			WHERE pack_id = ?`,
			m.Name, m.Version, m.License, m.Attribution, m.Notice, hash, stamp, m.ID); err != nil {
			return Result{}, fmt.Errorf("update theme pack %s: %w", m.ID, err)
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM themes WHERE pack_id = ?`, m.ID); err != nil {
		return Result{}, fmt.Errorf("replace themes of %s: %w", m.ID, err)
	}
	for i, t := range list {
		if _, err := tx.ExecContext(ctx, `INSERT INTO themes (theme_id, pack_id, ord, data) VALUES (?, ?, ?, ?)`,
			t.ID, m.ID, i, string(rows[i])); err != nil {
			return Result{}, fmt.Errorf("import theme pack %s: %w", m.ID, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return Result{}, fmt.Errorf("import theme pack %s: %w", m.ID, err)
	}
	return Result{Themes: len(list)}, nil
}

// Uninstall soft-deletes the theme pack packID and removes its themes, in
// one transaction. An unknown or already uninstalled pack is ErrNotFound.
func Uninstall(ctx context.Context, sqlDB *sql.DB, packID string) error {
	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("uninstall theme pack %s: %w", packID, err)
	}
	defer tx.Rollback()
	stamp := time.Now().UTC().Format(time.RFC3339)
	res, err := tx.ExecContext(ctx, `
		UPDATE theme_packs SET deleted_at = ?, updated_at = ? WHERE pack_id = ? AND deleted_at IS NULL`, stamp, stamp, packID)
	if err != nil {
		return fmt.Errorf("uninstall theme pack %s: %w", packID, err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM themes WHERE pack_id = ?`, packID); err != nil {
		return fmt.Errorf("uninstall theme pack %s: %w", packID, err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("uninstall theme pack %s: %w", packID, err)
	}
	return nil
}

// Pack is one theme pack with its credits and its theme ids in file order.
type Pack struct {
	PackID      string `json:"packId"`
	Name        string `json:"name"`
	Version     string `json:"version"`
	License     string `json:"license"`
	Attribution string `json:"attribution"`
	Notice      string `json:"notice"`
	// LicenseText is the full licence text of a built-in pack (its embedded
	// LICENSE); "" for an installed pack, whose licence files the admin saw
	// at upload and which are not kept.
	LicenseText string   `json:"licenseText"`
	Builtin     bool     `json:"builtin"`
	Themes      []string `json:"themes"`
	UpdatedAt   string   `json:"-"`
}

// Packs returns the live installed theme packs by name, then pack id.
func Packs(ctx context.Context, q Querier) ([]Pack, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT pack_id, name, version, license, attribution, notice, updated_at
		FROM theme_packs WHERE deleted_at IS NULL ORDER BY name, pack_id`)
	if err != nil {
		return nil, fmt.Errorf("themes: list packs: %w", err)
	}
	var out []Pack
	for rows.Next() {
		var p Pack
		if err := rows.Scan(&p.PackID, &p.Name, &p.Version, &p.License, &p.Attribution, &p.Notice, &p.UpdatedAt); err != nil {
			rows.Close()
			return nil, fmt.Errorf("themes: list packs: %w", err)
		}
		p.Themes = []string{}
		out = append(out, p)
	}
	if err := errors.Join(rows.Err(), rows.Close()); err != nil {
		return nil, fmt.Errorf("themes: list packs: %w", err)
	}
	ids, err := q.QueryContext(ctx, `SELECT pack_id, theme_id FROM themes ORDER BY pack_id, ord`)
	if err != nil {
		return nil, fmt.Errorf("themes: list packs: %w", err)
	}
	defer ids.Close()
	byPack := map[string][]string{}
	for ids.Next() {
		var pk, id string
		if err := ids.Scan(&pk, &id); err != nil {
			return nil, fmt.Errorf("themes: list packs: %w", err)
		}
		byPack[pk] = append(byPack[pk], id)
	}
	if err := ids.Err(); err != nil {
		return nil, fmt.Errorf("themes: list packs: %w", err)
	}
	for i := range out {
		if list := byPack[out[i].PackID]; list != nil {
			out[i].Themes = list
		}
	}
	return out, nil
}

// InstalledTheme is one theme of an installed pack.
type InstalledTheme struct {
	PackID string
	Theme  Theme
}

// Installed returns the themes of the live installed packs, pack by pack
// in Packs order, each pack's themes in file order. A stored row that no
// longer parses is skipped and logged (it was validated on import).
func Installed(ctx context.Context, q Querier) ([]InstalledTheme, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT t.pack_id, t.theme_id, t.data FROM themes t JOIN theme_packs p ON p.pack_id = t.pack_id
		WHERE p.deleted_at IS NULL ORDER BY p.name, p.pack_id, t.ord`)
	if err != nil {
		return nil, fmt.Errorf("themes: list: %w", err)
	}
	defer rows.Close()
	var out []InstalledTheme
	for rows.Next() {
		var pk, id, data string
		if err := rows.Scan(&pk, &id, &data); err != nil {
			return nil, fmt.Errorf("themes: list: %w", err)
		}
		t, err := ParseTheme([]byte(data))
		if err != nil || t.ID != id {
			log.Printf("themes: stored theme %s of pack %s skipped: %v", id, pk, err)
			continue
		}
		out = append(out, InstalledTheme{PackID: pk, Theme: t})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("themes: list: %w", err)
	}
	return out, nil
}
