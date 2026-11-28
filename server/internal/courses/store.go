package courses

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"qinqin/internal/pack"
)

// DataFile is the data file of a course pack.
const DataFile = "course.json"

// ErrNotFound reports an unknown or uninstalled course pack.
var ErrNotFound = pack.NotFound("course not found")

// Querier is what the readers go through (*sql.DB or *sql.Tx).
type Querier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// Result describes an import.
type Result struct {
	Sections, Units int
}

// Hash is the content hash stored with a pack: the hex sha256 of its course.json bytes.
func Hash(raw []byte) string {
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

// CheckPack validates the course pack p as Import does — the manifest, course.json and its language against the
// manifest's — without writing. Errors are pack.ErrInvalidPack.
func CheckPack(p pack.Pack) ([]byte, *Course, error) {
	m := p.Manifest
	if err := m.Validate(); err != nil {
		return nil, nil, fmt.Errorf("%w: %v", pack.ErrInvalidPack, err)
	}
	if m.Type != pack.TypeCourse || m.Format != pack.FormatCourseJSON {
		return nil, nil, fmt.Errorf("%w: %q is a %s pack (format %s), not a course pack", pack.ErrInvalidPack, m.ID, m.Type, m.Format)
	}
	f, err := os.Open(filepath.Join(p.Dir, DataFile))
	if err != nil {
		return nil, nil, fmt.Errorf("%w: %s: %v", pack.ErrInvalidPack, DataFile, err)
	}
	defer f.Close()
	raw, err := pack.ReadCapped(f, MaxFileBytes)
	if errors.Is(err, pack.ErrTooLarge) {
		return nil, nil, fmt.Errorf("%w: %s is larger than 2 MiB", pack.ErrInvalidPack, DataFile)
	}
	if err != nil {
		return nil, nil, fmt.Errorf("%w: %s: %v", pack.ErrInvalidPack, DataFile, err)
	}
	c, err := Parse(raw)
	if err != nil {
		return nil, nil, fmt.Errorf("%w: %s: %v", pack.ErrInvalidPack, DataFile, err)
	}
	if c.Language != m.Language {
		return nil, nil, fmt.Errorf("%w: %s is a course of %q, the manifest states %q", pack.ErrInvalidPack, DataFile, c.Language, m.Language)
	}
	return raw, c, nil
}

// Import installs the course pack p: one transaction upserts the registry row with the raw course.json, clearing an
// uninstall; an identical re-import (same bytes and manifest fields) writes nothing.
func Import(ctx context.Context, sqlDB *sql.DB, p pack.Pack) (Result, error) {
	raw, c, err := CheckPack(p)
	if err != nil {
		return Result{}, err
	}
	m := p.Manifest
	res := Result{Sections: len(c.Sections)}
	for _, s := range c.Sections {
		res.Units += len(s.Units)
	}
	tx, err := pack.BeginWrite(ctx, sqlDB)
	if err != nil {
		return Result{}, fmt.Errorf("import course pack %s: %w", m.ID, err)
	}
	defer tx.Rollback()
	_, changed, err := pack.UpsertRegistry(ctx, tx, pack.Registry{Table: "course_packs", PackID: m.ID, Stamp: pack.Now(),
		Columns: pack.ManifestColumns(m, pack.Column{Name: "language", Value: m.Language},
			pack.Column{Name: "course_json", Value: string(raw)}, pack.Column{Name: "content_hash", Value: Hash(raw)})})
	if err != nil {
		return Result{}, fmt.Errorf("register course pack %s: %w", m.ID, err)
	}
	if !changed {
		return res, nil
	}
	if err := tx.Commit(); err != nil {
		return Result{}, fmt.Errorf("import course pack %s: %w", m.ID, err)
	}
	return res, nil
}

// Uninstall soft-deletes the course pack packID (a re-import revives it). Progress events are the learners' and stay.
// An unknown or already uninstalled pack is ErrNotFound.
func Uninstall(ctx context.Context, sqlDB *sql.DB, packID string) error {
	tx, err := pack.BeginWrite(ctx, sqlDB)
	if err != nil {
		return fmt.Errorf("uninstall course pack %s: %w", packID, err)
	}
	defer tx.Rollback()
	stamp := pack.Now()
	res, err := tx.ExecContext(ctx, `
		UPDATE course_packs SET deleted_at = ?, updated_at = ? WHERE pack_id = ? AND deleted_at IS NULL`, stamp, stamp, packID)
	if err != nil {
		return fmt.Errorf("uninstall course pack %s: %w", packID, err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return tx.Commit()
}

// Pack is one live course pack with its credits.
type Pack struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Version     string `json:"version"`
	Language    string `json:"language"`
	License     string `json:"license"`
	Attribution string `json:"attribution"`
	Notice      string `json:"notice"`
	// Title is the course's own title (course.json).
	Title Title `json:"title"`
	hash  string
	raw   string
}

// List returns the live course packs by pack id; language "" lists every language.
func List(ctx context.Context, q Querier, language string) ([]Pack, error) {
	rows, err := q.QueryContext(ctx, `SELECT pack_id, name, version, language, license, attribution, notice, content_hash, course_json
		FROM course_packs WHERE deleted_at IS NULL AND (? = '' OR language = ?) ORDER BY pack_id`, language, language)
	if err != nil {
		return nil, fmt.Errorf("courses: list: %w", err)
	}
	defer rows.Close()
	out := []Pack{}
	for rows.Next() {
		var p Pack
		if err := rows.Scan(&p.ID, &p.Name, &p.Version, &p.Language, &p.License, &p.Attribution, &p.Notice, &p.hash, &p.raw); err != nil {
			return nil, fmt.Errorf("courses: list: %w", err)
		}
		if c, err := Parse([]byte(p.raw)); err == nil {
			p.Title = c.Title
		} else {
			p.Title = Title{"en": p.Name} // a stored course a newer binary wrote; Get refuses it
		}
		p.raw = ""
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("courses: list: %w", err)
	}
	return out, nil
}

// get returns the live pack packID with its stored course.json and hash.
func get(ctx context.Context, q Querier, packID string) (Pack, error) {
	var p Pack
	err := q.QueryRowContext(ctx, `SELECT pack_id, name, version, language, license, attribution, notice, content_hash, course_json
		FROM course_packs WHERE pack_id = ? AND deleted_at IS NULL`, packID).
		Scan(&p.ID, &p.Name, &p.Version, &p.Language, &p.License, &p.Attribution, &p.Notice, &p.hash, &p.raw)
	if errors.Is(err, sql.ErrNoRows) {
		return Pack{}, ErrNotFound
	}
	if err != nil {
		return Pack{}, fmt.Errorf("courses: %w", err)
	}
	return p, nil
}
