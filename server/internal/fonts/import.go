package fonts

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"qinqin/internal/pack"
)

// DataFile is the faces list of a font pack.
const DataFile = "faces.json"

// ErrNotFound reports an uninstall of an unknown or already uninstalled
// font pack.
var ErrNotFound = errors.New("fonts: pack not found")

// Result counts an import.
type Result struct{ Faces, Slices int }

// Querier is what the readers go through (*sql.DB or *sql.Tx).
type Querier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// LoadFile reads and validates the faces.json of the pack in dir. Errors
// are pack.ErrInvalidPack naming the file, the code and the path.
func LoadFile(dir string) ([]Face, error) {
	f, err := os.Open(filepath.Join(dir, DataFile))
	if err != nil {
		return nil, fmt.Errorf("%w: %s: %v", pack.ErrInvalidPack, DataFile, err)
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, MaxFacesBytes+1))
	if err != nil {
		return nil, fmt.Errorf("%w: %s: %v", pack.ErrInvalidPack, DataFile, err)
	}
	list, err := ParseFaces(data)
	if err != nil {
		return nil, fmt.Errorf("%w: %s: %v", pack.ErrInvalidPack, DataFile, err)
	}
	return list, nil
}

// CheckPack validates the font pack p as Import would — manifest,
// faces.json and every slice file — without the installed packs (Import
// checks those). The staged upload calls it to refuse a broken pack
// before the licence review.
func CheckPack(p pack.Pack) ([]Face, error) {
	_, list, err := checkPack(p)
	return list, err
}

func checkPack(p pack.Pack) (map[string]sliceFile, []Face, error) {
	m := p.Manifest
	if err := m.Validate(); err != nil {
		return nil, nil, fmt.Errorf("%w: %v", pack.ErrInvalidPack, err)
	}
	if m.Type != pack.TypeFont || m.Format != pack.FormatFontSlices {
		return nil, nil, fmt.Errorf("%w: %q is a %s pack (format %s), not a font pack", pack.ErrInvalidPack, m.ID, m.Type, m.Format)
	}
	list, err := LoadFile(p.Dir)
	if err != nil {
		return nil, nil, err
	}
	files := map[string]sliceFile{}
	for _, f := range list {
		for _, s := range f.Slices {
			sf, err := inspect(filepath.Join(p.Dir, filepath.FromSlash(s.File)), s.Sha)
			if err != nil {
				return nil, nil, fmt.Errorf("%w: %s: %v", pack.ErrInvalidPack, s.File, err)
			}
			files[s.Sha] = sf
		}
	}
	return files, list, nil
}

// afterStoreHook is a test seam: it runs after the slices are stored.
var afterStoreHook func()

// Import installs the font pack p: faces.json and every slice file are
// validated, and no face may collide with a face another installed pack
// provides (the same face, script and style with overlapping weights)
// before anything is written. The slices are then copied into storeDir,
// one transaction upserts the font_packs row (clearing an uninstall) and
// replaces the pack's font_slices rows, and the files no row references
// any more are removed. A failure before the commit (a cancelled ctx
// included) removes the slices it stored that no installed pack uses.
func Import(ctx context.Context, sqlDB *sql.DB, p pack.Pack, storeDir string) (res Result, err error) {
	files, list, err := checkPack(p)
	if err != nil {
		return Result{}, err
	}
	m := p.Manifest
	installed, err := Faces(ctx, sqlDB)
	if err != nil {
		return Result{}, fmt.Errorf("import font pack %s: %w", m.ID, err)
	}
	for _, f := range list {
		for _, g := range installed {
			if g.PackID != m.ID && f.overlaps(g.Face) {
				return Result{}, fmt.Errorf("%w: the face %s is already provided by the installed font pack %q (as %s); uninstall that pack first",
					pack.ErrInvalidPack, f.Key(), g.PackID, g.Key())
			}
		}
	}
	// Until the rows commit, a failure (or a cancelled ctx: a shutdown)
	// removes the slices this import stored that no installed pack uses.
	stored := map[string]bool{}
	committed := false
	defer func() {
		if !committed && len(stored) > 0 {
			_ = collectBlobs(context.WithoutCancel(ctx), sqlDB, storeDir, stored)
		}
	}()
	for _, sf := range files {
		if err := storeBlob(storeDir, sf); err != nil {
			return Result{}, fmt.Errorf("import font pack %s: store %s: %w", m.ID, sf.sha, err)
		}
		stored[sf.sha] = true
	}
	if afterStoreHook != nil {
		afterStoreHook()
	}

	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return Result{}, fmt.Errorf("import font pack %s: %w", m.ID, err)
	}
	defer tx.Rollback()
	old, err := packShas(ctx, tx, m.ID)
	if err != nil {
		return Result{}, fmt.Errorf("import font pack %s: %w", m.ID, err)
	}
	stamp := time.Now().UTC().Format(time.RFC3339)
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO font_packs (pack_id, name, version, license, attribution, notice, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (pack_id) DO UPDATE SET name = excluded.name, version = excluded.version,
			license = excluded.license, attribution = excluded.attribution, notice = excluded.notice,
			updated_at = excluded.updated_at, deleted_at = NULL`,
		m.ID, m.Name, m.Version, m.License, m.Attribution, m.Notice, stamp); err != nil {
		return Result{}, fmt.Errorf("import font pack %s: %w", m.ID, err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM font_slices WHERE pack_id = ?`, m.ID); err != nil {
		return Result{}, fmt.Errorf("import font pack %s: %w", m.ID, err)
	}
	for _, f := range list {
		res.Faces++
		for i, s := range f.Slices {
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO font_slices (pack_id, face, script, weight, style, original, sha, unicode_range, ord)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				m.ID, f.Face, f.Script, f.Weight, f.Style, f.Original, s.Sha, s.UnicodeRange, i); err != nil {
				return Result{}, fmt.Errorf("import font pack %s: %w", m.ID, err)
			}
			res.Slices++
		}
	}
	if err := tx.Commit(); err != nil {
		return Result{}, fmt.Errorf("import font pack %s: %w", m.ID, err)
	}
	committed = true
	// Garbage-collect after commit: a failure here only leaves an orphan.
	if err := collectBlobs(ctx, sqlDB, storeDir, old); err != nil {
		return res, fmt.Errorf("import font pack %s: %w", m.ID, err)
	}
	return res, nil
}

// packShas returns the slice hashes the pack's rows reference.
func packShas(ctx context.Context, q Querier, packID string) (map[string]bool, error) {
	rows, err := q.QueryContext(ctx, `SELECT DISTINCT sha FROM font_slices WHERE pack_id = ?`, packID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var sha string
		if err := rows.Scan(&sha); err != nil {
			return nil, err
		}
		out[sha] = true
	}
	return out, rows.Err()
}

// collectBlobs removes the given slice files that no font_slices row
// references any more, whichever pack the row belongs to: the one refcount
// rule of Import (a pack dropped slices) and Uninstall (a pack went away).
func collectBlobs(ctx context.Context, sqlDB *sql.DB, storeDir string, candidates map[string]bool) error {
	for sha := range candidates {
		used, err := Installed(ctx, sqlDB, sha)
		if err != nil {
			return fmt.Errorf("check slice %s: %w", sha, err)
		}
		if !used {
			if err := os.Remove(BlobPath(storeDir, sha)); err != nil && !errors.Is(err, os.ErrNotExist) {
				return fmt.Errorf("remove slice %s: %w", sha, err)
			}
		}
	}
	return nil
}
