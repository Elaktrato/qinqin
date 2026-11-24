package components

import (
	"cmp"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"qinqin/internal/pack"
)

// insertBatch is the rows per INSERT: 3 columns each stays under SQLite's
// 999-variable default limit.
const insertBatch = 300

// ErrNotFound reports an uninstall of an unknown or already uninstalled
// components pack.
var ErrNotFound = errors.New("components: pack not found")

// Result counts an import: the characters and the distinct parts they
// use.
type Result struct{ Chars, Parts int }

// PackInfo is an installed components pack's credit line.
type PackInfo struct {
	PackID, Name, Version, Language, License, Attribution, Notice, UpdatedAt string
}

// Part is one part of an Index: its glyph, its stroke count (0 when no
// pack gives one) and the number of characters containing it.
type Part struct {
	C string `json:"c"`
	S int    `json:"s"`
	N int    `json:"n"`
}

// Set is the union of a language's active components packs (Index).
type Set struct {
	Parts []Part
	Chars map[string][]string
}

// Import installs the components pack p (type components, format
// components-tsv): components.tsv and the optional parts.tsv of its
// directory are parsed completely (Parse), then ONE transaction upserts
// the component_packs row (clearing an uninstall) and replaces the pack's
// rows. The language is stored as its primary subtag (zh-tw -> zh). A
// malformed pack is pack.ErrInvalidPack and leaves nothing behind.
func Import(ctx context.Context, sqlDB *sql.DB, p pack.Pack) (Result, error) {
	m := p.Manifest
	if err := m.Validate(); err != nil {
		return Result{}, fmt.Errorf("%w: %v", pack.ErrInvalidPack, err)
	}
	if m.Type != pack.TypeComponents {
		return Result{}, fmt.Errorf("%w: %q is a %s pack, not a components pack", pack.ErrInvalidPack, m.ID, m.Type)
	}
	if m.Format != pack.FormatComponentsTSV {
		return Result{}, fmt.Errorf("%w: components pack %s: format %q is not a components format (want components-tsv)", pack.ErrInvalidPack, m.ID, m.Format)
	}
	d, err := readDir(p.Dir)
	if err != nil {
		return Result{}, fmt.Errorf("%w: components pack %s: %w", pack.ErrInvalidPack, m.ID, err)
	}
	chars := make([]string, 0, len(d.Chars))
	used := map[string]bool{}
	for c, parts := range d.Chars {
		chars = append(chars, c)
		for _, x := range parts {
			used[x] = true
		}
	}
	slices.Sort(chars)
	parts := make([]string, 0, len(d.Strokes))
	for x := range d.Strokes {
		parts = append(parts, x)
	}
	slices.Sort(parts)
	hash := fingerprint(chars, parts, d)

	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return Result{}, fmt.Errorf("import components pack %s: %w", m.ID, err)
	}
	defer tx.Rollback()
	// The lookup asks by primary subtag (a zh-TW workspace asks for zh), so a
	// pack's language is stored as its primary subtag: zh-tw -> zh.
	language, _, _ := strings.Cut(m.Language, "-")
	stamp := time.Now().UTC().Format(time.RFC3339)
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO component_packs (pack_id, name, version, language, license, attribution, notice, content_hash, updated_at, deleted_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
		ON CONFLICT (pack_id) DO UPDATE SET name = excluded.name, version = excluded.version,
			language = excluded.language, license = excluded.license, attribution = excluded.attribution,
			notice = excluded.notice, content_hash = excluded.content_hash, updated_at = excluded.updated_at,
			deleted_at = NULL`,
		m.ID, m.Name, m.Version, language, m.License, m.Attribution, m.Notice, hash, stamp); err != nil {
		return Result{}, fmt.Errorf("import components pack %s: %w", m.ID, err)
	}
	if err := deleteRows(ctx, tx, m.ID); err != nil {
		return Result{}, fmt.Errorf("import components pack %s: %w", m.ID, err)
	}
	if err := insert(ctx, tx, "components (pack_id, char, parts)", len(chars), func(i int) []any {
		raw, _ := json.Marshal(d.Chars[chars[i]])
		return []any{m.ID, chars[i], string(raw)}
	}); err != nil {
		return Result{}, fmt.Errorf("import components pack %s: %w", m.ID, err)
	}
	if err := insert(ctx, tx, "component_parts (pack_id, part, strokes)", len(parts), func(i int) []any {
		return []any{m.ID, parts[i], d.Strokes[parts[i]]}
	}); err != nil {
		return Result{}, fmt.Errorf("import components pack %s: %w", m.ID, err)
	}
	if err := tx.Commit(); err != nil {
		return Result{}, fmt.Errorf("import components pack %s: %w", m.ID, err)
	}
	return Result{Chars: len(chars), Parts: len(used)}, nil
}

// readDir parses components.tsv and the optional parts.tsv of dir.
func readDir(dir string) (Data, error) {
	cf, err := os.Open(filepath.Join(dir, ComponentsFile))
	if err != nil {
		return Data{}, fmt.Errorf("%s: %w", ComponentsFile, err)
	}
	defer cf.Close()
	var parts io.Reader
	pf, err := os.Open(filepath.Join(dir, PartsFile))
	switch {
	case err == nil:
		defer pf.Close()
		parts = pf
	case !errors.Is(err, fs.ErrNotExist):
		return Data{}, fmt.Errorf("%s: %w", PartsFile, err)
	}
	return Parse(cf, parts)
}

// fingerprint hashes a pack's rows in a canonical order.
func fingerprint(chars, parts []string, d Data) string {
	h := sha256.New()
	for _, c := range chars {
		fmt.Fprintf(h, "c\t%s\t%s\n", c, strings.Join(d.Chars[c], " "))
	}
	for _, x := range parts {
		fmt.Fprintf(h, "p\t%s\t%d\n", x, d.Strokes[x])
	}
	return hex.EncodeToString(h.Sum(nil))
}

func deleteRows(ctx context.Context, tx *sql.Tx, packID string) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM components WHERE pack_id = ?`, packID); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `DELETE FROM component_parts WHERE pack_id = ?`, packID)
	return err
}

// insert writes n rows of three values into table in batches.
func insert(ctx context.Context, tx *sql.Tx, table string, n int, row func(i int) []any) error {
	for start := 0; start < n; start += insertBatch {
		end := min(start+insertBatch, n)
		args := make([]any, 0, 3*(end-start))
		for i := start; i < end; i++ {
			args = append(args, row(i)...)
		}
		q := "INSERT INTO " + table + " VALUES " + strings.TrimSuffix(strings.Repeat("(?, ?, ?), ", end-start), ", ")
		if _, err := tx.ExecContext(ctx, q, args...); err != nil {
			return err
		}
	}
	return nil
}

// Uninstall soft-deletes the pack with manifest id packID and removes its
// rows, in one transaction. An unknown or already uninstalled pack
// returns ErrNotFound.
func Uninstall(ctx context.Context, sqlDB *sql.DB, packID string) error {
	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("uninstall components pack %s: %w", packID, err)
	}
	defer tx.Rollback()
	stamp := time.Now().UTC().Format(time.RFC3339)
	res, err := tx.ExecContext(ctx, `
		UPDATE component_packs SET deleted_at = ?, updated_at = ? WHERE pack_id = ? AND deleted_at IS NULL`, stamp, stamp, packID)
	if err != nil {
		return fmt.Errorf("uninstall components pack %s: %w", packID, err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	if err := deleteRows(ctx, tx, packID); err != nil {
		return fmt.Errorf("uninstall components pack %s: %w", packID, err)
	}
	return tx.Commit()
}

// List returns the installed packs by pack id.
func List(ctx context.Context, sqlDB *sql.DB) ([]PackInfo, error) {
	rows, err := sqlDB.QueryContext(ctx, `
		SELECT pack_id, name, version, language, license, attribution, notice, updated_at
		FROM component_packs WHERE deleted_at IS NULL ORDER BY pack_id`)
	if err != nil {
		return nil, fmt.Errorf("components: list: %w", err)
	}
	defer rows.Close()
	out := []PackInfo{}
	for rows.Next() {
		var p PackInfo
		if err := rows.Scan(&p.PackID, &p.Name, &p.Version, &p.Language, &p.License, &p.Attribution, &p.Notice, &p.UpdatedAt); err != nil {
			return nil, fmt.Errorf("components: list: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// NoPacks is the Version of a language without live packs.
const NoPacks = "0"

// Version returns a value that changes whenever language's Index can:
// the live packs' ids and content hashes; NoPacks when the language has
// none. Read it before Index.
func Version(ctx context.Context, sqlDB *sql.DB, language string) (string, error) {
	rows, err := sqlDB.QueryContext(ctx, `
		SELECT pack_id, content_hash FROM component_packs
		WHERE language = ? AND deleted_at IS NULL ORDER BY pack_id`, language)
	if err != nil {
		return "", fmt.Errorf("components: version: %w", err)
	}
	defer rows.Close()
	h := sha256.New()
	n := 0
	for rows.Next() {
		n++
		var id, hash string
		if err := rows.Scan(&id, &hash); err != nil {
			return "", fmt.Errorf("components: version: %w", err)
		}
		fmt.Fprintf(h, "%s\t%s\n", id, hash)
	}
	if err := rows.Err(); err != nil {
		return "", fmt.Errorf("components: version: %w", err)
	}
	if n == 0 {
		return NoPacks, nil
	}
	return hex.EncodeToString(h.Sum(nil)[:12]), nil
}

// Index returns the union of language's active packs. A character in
// several packs keeps the parts of the first pack by pack id. A part's S
// is the largest stroke count any active pack gives it (0 when none), N
// the number of characters of the union containing it. Parts are sorted
// by S ascending with 0 last, then code point. Parts and Chars are never
// nil.
func Index(ctx context.Context, sqlDB *sql.DB, language string) (Set, error) {
	idx := Set{Parts: []Part{}, Chars: map[string][]string{}}
	rows, err := sqlDB.QueryContext(ctx, `
		SELECT c.char, c.parts FROM components c
		JOIN component_packs p ON p.pack_id = c.pack_id AND p.deleted_at IS NULL
		WHERE p.language = ? ORDER BY c.pack_id`, language)
	if err != nil {
		return Set{}, fmt.Errorf("components: index: %w", err)
	}
	for rows.Next() {
		var char, raw string
		if err := rows.Scan(&char, &raw); err != nil {
			rows.Close()
			return Set{}, fmt.Errorf("components: index: %w", err)
		}
		if _, ok := idx.Chars[char]; ok {
			continue
		}
		var parts []string
		if err := json.Unmarshal([]byte(raw), &parts); err != nil {
			rows.Close()
			return Set{}, fmt.Errorf("components: index: parts of %s: %w", char, err)
		}
		idx.Chars[char] = parts
	}
	if err := errors.Join(rows.Err(), rows.Close()); err != nil {
		return Set{}, fmt.Errorf("components: index: %w", err)
	}

	strokes := map[string]int{}
	rows, err = sqlDB.QueryContext(ctx, `
		SELECT x.part, MAX(x.strokes) FROM component_parts x
		JOIN component_packs p ON p.pack_id = x.pack_id AND p.deleted_at IS NULL
		WHERE p.language = ? GROUP BY x.part`, language)
	if err != nil {
		return Set{}, fmt.Errorf("components: index: %w", err)
	}
	for rows.Next() {
		var part string
		var s int
		if err := rows.Scan(&part, &s); err != nil {
			rows.Close()
			return Set{}, fmt.Errorf("components: index: %w", err)
		}
		strokes[part] = s
	}
	if err := errors.Join(rows.Err(), rows.Close()); err != nil {
		return Set{}, fmt.Errorf("components: index: %w", err)
	}

	count := map[string]int{}
	for _, parts := range idx.Chars {
		for _, x := range parts {
			count[x]++
		}
	}
	for x, n := range count {
		idx.Parts = append(idx.Parts, Part{C: x, S: strokes[x], N: n})
	}
	slices.SortFunc(idx.Parts, func(a, b Part) int {
		if (a.S == 0) != (b.S == 0) {
			if a.S == 0 {
				return 1
			}
			return -1
		}
		return cmp.Or(cmp.Compare(a.S, b.S), strings.Compare(a.C, b.C))
	})
	return idx, nil
}
