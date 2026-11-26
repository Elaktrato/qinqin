// Package images is the picture store: it imports images packs (type images,
// format images-svg, #216) into image_packs, image_pictures and image_map,
// uninstalls them, and finds the picture of a dictionary entry.
//
// A pack is a directory of
//
//	manifest.json   type images, format images-svg, languages [...], licence
//	pictures.tsv    concept, file, label, credit: one row per picture
//	pictures/<concept>.svg   the pictures, checked and stored in canonical form (CanonicalSVG)
//	map.tsv         language, target, sense, concept, score, basis, note
//
// and the pack's licence (LICENSE, ATTRIBUTION.md). The files are data, never
// embedded in the binary; scripts/prepare-images-pack.mjs builds them from the
// pinned OpenMoji and Mulberry releases. docs/contracts/images/README.md is
// the format.
package images

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"qinqin/internal/pack"
)

// Format is the one images pack format.
const Format = pack.FormatImagesSVG

// File names of a pack.
const (
	PicturesFile = "pictures.tsv"
	MapFile      = "map.tsv"
	PicturesDir  = "pictures"
)

// Input caps: pack files are untrusted. Variables so tests can lower them.
var (
	maxPictures   = 20_000
	maxMapRows    = 500_000
	maxTotalBytes = 96 << 20 // all pictures of one pack
	maxFileBytes  = 64 << 20 // pictures.tsv and map.tsv
)

// ErrNotFound reports an uninstall of an unknown or already uninstalled pack.
var ErrNotFound = pack.NotFound("images: pack not found")

// Result counts an import.
type Result struct{ Pictures, Mappings int }

// Querier is what the readers go through (*sql.DB or *sql.Tx).
type Querier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// Picture is one parsed picture of a pack.
type Picture struct {
	Concept, Label, Credit string
	SVG                    []byte
}

// Mapping is one parsed map row: the word target of language shows concept.
type Mapping struct {
	Language, Target, Concept, Basis string
	Sense, Score                     int
}

// Content is a pack's parsed and validated data.
type Content struct {
	Pictures []Picture
	Mappings []Mapping
}

// Hash fingerprints the content: the stored value that tells an unchanged
// re-import from a changed one.
func (c Content) Hash() string {
	h := sha256.New()
	for _, p := range c.Pictures {
		fmt.Fprintf(h, "P\t%s\t%s\t%s\t%d\n", p.Concept, p.Label, p.Credit, len(p.SVG))
		h.Write(p.SVG)
		h.Write([]byte{'\n'})
	}
	for _, m := range c.Mappings {
		fmt.Fprintf(h, "M\t%s\t%s\t%d\t%s\t%d\t%s\n", m.Language, m.Target, m.Sense, m.Concept, m.Score, m.Basis)
	}
	return hex.EncodeToString(h.Sum(nil))
}

// insertBatch is the rows per INSERT of image_map: 7 columns each stays under
// SQLite's 999-variable default limit.
const insertBatch = 100

// CheckPack validates the images pack p as Import would — manifest, then
// every file — and returns its content. Errors are pack.ErrInvalidPack. The
// staged upload calls it before the licence review.
func CheckPack(p pack.Pack) (Content, error) {
	m := p.Manifest
	if err := m.Validate(); err != nil {
		return Content{}, fmt.Errorf("%w: %v", pack.ErrInvalidPack, err)
	}
	if m.Type != pack.TypeImages {
		return Content{}, fmt.Errorf("%w: %q is a %s pack, not an images pack", pack.ErrInvalidPack, m.ID, m.Type)
	}
	if m.Format != Format {
		return Content{}, fmt.Errorf("%w: images pack %s: format %q is not an images format (want %s)", pack.ErrInvalidPack, m.ID, m.Format, Format)
	}
	c, err := Load(p.Dir, m.Languages)
	if err != nil {
		return Content{}, fmt.Errorf("%w: images pack %s: %w", pack.ErrInvalidPack, m.ID, err)
	}
	return c, nil
}

// Import installs the images pack p. The files are read and validated before
// anything is written (pack.ErrInvalidPack names the file and line); then ONE
// transaction upserts the registry row, clearing an uninstall, and replaces
// the pack's pictures and map rows. An identical re-import (same content and
// manifest fields) writes nothing.
func Import(ctx context.Context, sqlDB *sql.DB, p pack.Pack) (Result, error) {
	c, err := CheckPack(p)
	if err != nil {
		return Result{}, err
	}
	m := p.Manifest
	res := Result{Pictures: len(c.Pictures), Mappings: len(c.Mappings)}
	langs := slices.Clone(m.Languages)
	slices.Sort(langs)
	langsJSON, _ := json.Marshal(langs)

	tx, err := pack.BeginWrite(ctx, sqlDB)
	if err != nil {
		return Result{}, fmt.Errorf("import images pack %s: %w", m.ID, err)
	}
	defer tx.Rollback()
	stamp := pack.Now()
	_, changed, err := pack.UpsertRegistry(ctx, tx, pack.Registry{Table: "image_packs", PackID: m.ID, Stamp: stamp,
		Columns: pack.ManifestColumns(m, pack.Column{Name: "languages", Value: string(langsJSON)},
			pack.Column{Name: "content_hash", Value: c.Hash()})})
	if err != nil {
		return Result{}, fmt.Errorf("register images pack %s: %w", m.ID, err)
	}
	if !changed {
		return res, nil // identical: nothing to write
	}
	for _, q := range []string{`DELETE FROM image_pictures WHERE pack_id = ?`, `DELETE FROM image_map WHERE pack_id = ?`} {
		if _, err := tx.ExecContext(ctx, q, m.ID); err != nil {
			return Result{}, fmt.Errorf("replace images of %s: %w", m.ID, err)
		}
	}
	for _, pic := range c.Pictures {
		if _, err := tx.ExecContext(ctx, `INSERT INTO image_pictures (pack_id, concept, label, credit, svg) VALUES (?, ?, ?, ?, ?)`,
			m.ID, pic.Concept, pic.Label, pic.Credit, string(pic.SVG)); err != nil {
			return Result{}, fmt.Errorf("import images pack %s: %w", m.ID, err)
		}
	}
	for start := 0; start < len(c.Mappings); start += insertBatch {
		batch := c.Mappings[start:min(start+insertBatch, len(c.Mappings))]
		args := make([]any, 0, 7*len(batch))
		for _, mp := range batch {
			args = append(args, m.ID, mp.Language, mp.Target, mp.Sense, mp.Concept, mp.Score, mp.Basis)
		}
		q := `INSERT INTO image_map (pack_id, language, target, sense, concept, score, basis) VALUES ` + pack.Tuples(len(batch), 7)
		if _, err := tx.ExecContext(ctx, q, args...); err != nil {
			return Result{}, fmt.Errorf("import images pack %s: %w", m.ID, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return Result{}, fmt.Errorf("import images pack %s: %w", m.ID, err)
	}
	return res, nil
}

// Uninstall soft-deletes the pack packID and removes its pictures and map
// rows, in one transaction. An unknown or already uninstalled pack is
// ErrNotFound.
func Uninstall(ctx context.Context, sqlDB *sql.DB, packID string) error {
	tx, err := pack.BeginWrite(ctx, sqlDB)
	if err != nil {
		return fmt.Errorf("uninstall images pack %s: %w", packID, err)
	}
	defer tx.Rollback()
	stamp := pack.Now()
	res, err := tx.ExecContext(ctx, `
		UPDATE image_packs SET deleted_at = ?, updated_at = ?, content_hash = '' WHERE pack_id = ? AND deleted_at IS NULL`, stamp, stamp, packID)
	if err != nil {
		return fmt.Errorf("uninstall images pack %s: %w", packID, err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	for _, q := range []string{`DELETE FROM image_pictures WHERE pack_id = ?`, `DELETE FROM image_map WHERE pack_id = ?`} {
		if _, err := tx.ExecContext(ctx, q, packID); err != nil {
			return fmt.Errorf("uninstall images pack %s: %w", packID, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("uninstall images pack %s: %w", packID, err)
	}
	return nil
}

// readCapped reads a pack file of at most limit bytes.
func readCapped(path string, limit int) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, fmt.Errorf("not a regular file")
	}
	if info.Size() > int64(limit) {
		return nil, fmt.Errorf("%d bytes exceeds the %d byte limit", info.Size(), limit)
	}
	return os.ReadFile(path)
}

// Load reads and validates the data files of the pack in dir for the
// manifest languages. Every error names the file (and line).
func Load(dir string, languages []string) (Content, error) {
	raw, err := readCapped(filepath.Join(dir, PicturesFile), maxFileBytes)
	if err != nil {
		return Content{}, fmt.Errorf("%s: %w", PicturesFile, err)
	}
	pics, err := parsePictures(raw)
	if err != nil {
		return Content{}, err
	}
	if len(pics) == 0 {
		return Content{}, fmt.Errorf("%s: no pictures", PicturesFile)
	}
	total := 0
	concepts := make(map[string]bool, len(pics))
	for i := range pics {
		p := &pics[i]
		concepts[p.Concept] = true
		svg, err := readCapped(filepath.Join(dir, PicturesDir, p.Concept+".svg"), MaxSVGBytes)
		if err != nil {
			return Content{}, fmt.Errorf("%s/%s.svg: %w", PicturesDir, p.Concept, err)
		}
		canon, err := CanonicalSVG(svg)
		if err != nil {
			return Content{}, fmt.Errorf("%s/%s.svg: %w", PicturesDir, p.Concept, err)
		}
		if total += len(canon); total > maxTotalBytes {
			return Content{}, fmt.Errorf("%s: the pictures are larger than %d MiB together", PicturesDir, maxTotalBytes>>20)
		}
		p.SVG = canon
	}
	raw, err = readCapped(filepath.Join(dir, MapFile), maxFileBytes)
	if err != nil {
		return Content{}, fmt.Errorf("%s: %w", MapFile, err)
	}
	maps, err := parseMap(raw, languages, concepts)
	if err != nil {
		return Content{}, err
	}
	return Content{Pictures: pics, Mappings: maps}, nil
}

// Info is one live pack with its counts, for the Sources page.
type Info struct {
	PackID, Name, Version, License, Attribution, Notice string
	Languages                                           []string
	Pictures, Mappings                                  int
}

// Packs returns the live images packs by pack id, never nil.
func Packs(ctx context.Context, q Querier) ([]Info, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT p.pack_id, p.name, p.version, p.languages, p.license, p.attribution, p.notice,
			(SELECT COUNT(*) FROM image_pictures s WHERE s.pack_id = p.pack_id),
			(SELECT COUNT(*) FROM image_map m WHERE m.pack_id = p.pack_id)
		FROM image_packs p WHERE p.deleted_at IS NULL ORDER BY p.pack_id`)
	if err != nil {
		return nil, fmt.Errorf("images: list packs: %w", err)
	}
	defer rows.Close()
	out := []Info{}
	for rows.Next() {
		var (
			i     Info
			langs string
		)
		if err := rows.Scan(&i.PackID, &i.Name, &i.Version, &langs, &i.License, &i.Attribution, &i.Notice, &i.Pictures, &i.Mappings); err != nil {
			return nil, fmt.Errorf("images: list packs: %w", err)
		}
		if err := json.Unmarshal([]byte(langs), &i.Languages); err != nil {
			return nil, fmt.Errorf("images: pack %s: languages: %w", i.PackID, err)
		}
		out = append(out, i)
	}
	return out, rows.Err()
}

// trimCell normalises a TSV cell.
func trimCell(s string) string { return strings.TrimSpace(s) }
