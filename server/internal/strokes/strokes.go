// Package strokes is the stroke-order data store: it imports strokes packs
// (type strokes, format hanzi-writer-jsonl-gz) into stroke_packs and
// strokes, uninstalls them, and looks a character's stroke JSON up for
// GET /hanzi/U<HEX>.json. The data is stored and served byte for byte as
// the pack's line carries it (the hanzi-writer-data npm file).
package strokes

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"qinqin/internal/dict"
	"qinqin/internal/model"
)

// Format is the one strokes pack format.
const Format = dict.FormatStrokesJSONLGz

// DataFile is the data file of a strokes pack: gzipped JSON lines
// {"char": <one code point>, "data": <a JSON object>}.
const DataFile = "strokes.jsonl.gz"

// Input caps: pack files are untrusted. Variables so tests can lower them.
var (
	// MaxLineBytes bounds one line (the largest hanzi-writer-data file is
	// under 9 KiB).
	MaxLineBytes = 64 << 10
	// maxChars bounds the characters of one pack.
	maxChars = 200_000
)

// insertBatch is the rows per INSERT: 3 columns each stays under SQLite's
// 999-variable default limit.
const insertBatch = 300

// ErrNotFound reports an uninstall of an unknown or already uninstalled
// strokes pack.
var ErrNotFound = errors.New("strokes: pack not found")

// Result counts an import.
type Result struct{ Chars int }

// Querier is what Lookup and Packs read through (*sql.DB or *sql.Tx).
type Querier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// line is one parsed line of the data file.
type line struct {
	Char string          `json:"char"`
	Data json.RawMessage `json:"data"`
}

// Import installs the strokes pack p. The data file is read twice,
// streaming: once to validate every line and hash the pack, once inside
// ONE transaction that upserts the stroke_packs row (clearing an
// uninstall) and replaces the pack's rows. A malformed line — not JSON, a
// char that is not exactly one code point, data that is not a JSON object,
// a repeated char, a line over MaxLineBytes, an unknown key — is
// dict.ErrInvalidPack naming the line and leaves nothing behind. An
// identical re-import (same rows and manifest fields) writes nothing.
//
// ord, the pack's priority in Lookup (the first live pack with data for a
// character wins), is assigned at the pack's first registration and kept on
// re-import and reinstall.
func Import(ctx context.Context, sqlDB *sql.DB, p dict.Pack) (Result, error) {
	m := p.Manifest
	if err := m.Validate(); err != nil {
		return Result{}, fmt.Errorf("%w: %v", dict.ErrInvalidPack, err)
	}
	if m.Type != dict.TypeStrokes {
		return Result{}, fmt.Errorf("%w: %q is a %s pack, not a strokes pack", dict.ErrInvalidPack, m.ID, m.Type)
	}
	if m.Format != Format {
		return Result{}, fmt.Errorf("%w: strokes pack %s: format %q is not a strokes format (want %s)", dict.ErrInvalidPack, m.ID, m.Format, Format)
	}
	path := filepath.Join(p.Dir, DataFile)
	h := sha256.New()
	n, err := scan(path, func(l line) error {
		fmt.Fprintf(h, "%s\t%s\n", l.Char, l.Data)
		return nil
	})
	if err != nil {
		return Result{}, fmt.Errorf("%w: strokes pack %s: %w", dict.ErrInvalidPack, m.ID, err)
	}
	hash := hex.EncodeToString(h.Sum(nil))
	langs := slices.Clone(m.Languages)
	slices.Sort(langs)
	langsJSON, _ := json.Marshal(langs)

	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return Result{}, fmt.Errorf("import strokes pack %s: %w", m.ID, err)
	}
	defer tx.Rollback()
	var (
		name, version, languages, license, attribution, notice, oldHash string
		deleted                                                         sql.NullString
	)
	err = tx.QueryRowContext(ctx, `
		SELECT name, version, languages, license, attribution, notice, content_hash, deleted_at
		FROM stroke_packs WHERE pack_id = ?`, m.ID).
		Scan(&name, &version, &languages, &license, &attribution, &notice, &oldHash, &deleted)
	stamp := time.Now().UTC().Format(time.RFC3339)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO stroke_packs (pack_id, name, version, languages, license, attribution, notice, content_hash, ord, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(ord), 0) + 1 FROM stroke_packs), ?)`,
			m.ID, m.Name, m.Version, string(langsJSON), m.License, m.Attribution, m.Notice, hash, stamp); err != nil {
			return Result{}, fmt.Errorf("register strokes pack %s: %w", m.ID, err)
		}
	case err != nil:
		return Result{}, fmt.Errorf("import strokes pack %s: %w", m.ID, err)
	default:
		if !deleted.Valid && oldHash == hash && name == m.Name && version == m.Version && languages == string(langsJSON) &&
			license == m.License && attribution == m.Attribution && notice == m.Notice {
			return Result{Chars: n}, nil // identical: nothing to write
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE stroke_packs SET name = ?, version = ?, languages = ?, license = ?, attribution = ?, notice = ?,
				content_hash = ?, updated_at = ?, deleted_at = NULL
			WHERE pack_id = ?`,
			m.Name, m.Version, string(langsJSON), m.License, m.Attribution, m.Notice, hash, stamp, m.ID); err != nil {
			return Result{}, fmt.Errorf("update strokes pack %s: %w", m.ID, err)
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM strokes WHERE pack_id = ?`, m.ID); err != nil {
			return Result{}, fmt.Errorf("replace strokes of %s: %w", m.ID, err)
		}
	}

	batch := make([]any, 0, 3*insertBatch)
	flush := func() error {
		if len(batch) == 0 {
			return nil
		}
		q := "INSERT INTO strokes (pack_id, char, data) VALUES " + strings.TrimSuffix(strings.Repeat("(?, ?, ?), ", len(batch)/3), ", ")
		_, err := tx.ExecContext(ctx, q, batch...)
		batch = batch[:0]
		return err
	}
	// The file is read again; a file changed between the passes still has
	// to be valid line by line, and its rows are what is stored.
	if _, err := scan(path, func(l line) error {
		batch = append(batch, m.ID, l.Char, string(l.Data))
		if len(batch) == cap(batch) {
			return flush()
		}
		return nil
	}); err != nil {
		return Result{}, fmt.Errorf("import strokes pack %s: %w", m.ID, err)
	}
	if err := flush(); err != nil {
		return Result{}, fmt.Errorf("import strokes pack %s: %w", m.ID, err)
	}
	if err := tx.Commit(); err != nil {
		return Result{}, fmt.Errorf("import strokes pack %s: %w", m.ID, err)
	}
	return Result{Chars: n}, nil
}

// scan reads the gzipped data file at path line by line, validates each
// line and passes it to fn; it returns the number of lines. Memory is one
// line plus the set of characters seen.
func scan(path string, fn func(line) error) (int, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", DataFile, err)
	}
	defer f.Close()
	zr, err := gzip.NewReader(f)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", DataFile, err)
	}
	defer zr.Close()
	br := bufio.NewReaderSize(zr, 64<<10)
	seen := map[string]bool{}
	n := 0
	for i := 1; ; i++ {
		raw, err := readLine(br)
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return 0, fmt.Errorf("%s line %d: %w", DataFile, i, err)
		}
		l, err := parseLine(raw)
		if err != nil {
			return 0, fmt.Errorf("%s line %d: %w", DataFile, i, err)
		}
		if seen[l.Char] {
			return 0, fmt.Errorf("%s line %d: %q appears twice", DataFile, i, l.Char)
		}
		if len(seen) >= maxChars {
			return 0, fmt.Errorf("%s line %d: more than %d characters in the pack", DataFile, i, maxChars)
		}
		seen[l.Char] = true
		if err := fn(l); err != nil {
			return 0, err
		}
		n++
	}
	if n == 0 {
		return 0, fmt.Errorf("%s: no characters", DataFile)
	}
	return n, nil
}

// readLine returns the next line without its "\n", refusing one longer
// than MaxLineBytes. It returns io.EOF only at the end of the input.
func readLine(br *bufio.Reader) ([]byte, error) {
	var buf []byte
	for {
		chunk, err := br.ReadSlice('\n')
		buf = append(buf, chunk...)
		if len(buf) > MaxLineBytes+1 {
			return nil, fmt.Errorf("line longer than %d bytes", MaxLineBytes)
		}
		switch {
		case err == nil:
			return bytes.TrimSuffix(buf, []byte("\n")), nil
		case errors.Is(err, bufio.ErrBufferFull):
			continue
		case errors.Is(err, io.EOF):
			if len(buf) == 0 {
				return nil, io.EOF
			}
			return buf, nil // a last line without "\n"
		default:
			return nil, err
		}
	}
}

// parseLine decodes and checks one line.
func parseLine(raw []byte) (line, error) {
	var l line
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&l); err != nil {
		return line{}, fmt.Errorf("not a {\"char\", \"data\"} JSON line: %w", err)
	}
	if dec.More() {
		return line{}, errors.New("more than one JSON value on the line")
	}
	if !utf8.ValidString(l.Char) || utf8.RuneCountInString(l.Char) != 1 {
		return line{}, fmt.Errorf("char %q is not exactly one character", l.Char)
	}
	data := bytes.TrimSpace(l.Data)
	if len(data) == 0 || data[0] != '{' {
		return line{}, fmt.Errorf("data of %q is not a JSON object", l.Char)
	}
	l.Data = data
	return l, nil
}

// Uninstall soft-deletes the strokes pack packID and removes its rows, in
// one transaction. An unknown or already uninstalled pack returns
// ErrNotFound.
func Uninstall(ctx context.Context, sqlDB *sql.DB, packID string) error {
	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("uninstall strokes pack %s: %w", packID, err)
	}
	defer tx.Rollback()
	stamp := time.Now().UTC().Format(time.RFC3339)
	res, err := tx.ExecContext(ctx, `
		UPDATE stroke_packs SET deleted_at = ?, updated_at = ? WHERE pack_id = ? AND deleted_at IS NULL`, stamp, stamp, packID)
	if err != nil {
		return fmt.Errorf("uninstall strokes pack %s: %w", packID, err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM strokes WHERE pack_id = ?`, packID); err != nil {
		return fmt.Errorf("uninstall strokes pack %s: %w", packID, err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("uninstall strokes pack %s: %w", packID, err)
	}
	return nil
}

// Lookup returns the stroke JSON of char from the first live pack (by ord)
// that has it, byte for byte as imported; ok is false when none has it.
func Lookup(ctx context.Context, q Querier, char string) (data json.RawMessage, ok bool, err error) {
	var s string
	err = q.QueryRowContext(ctx, `
		SELECT s.data FROM strokes s JOIN stroke_packs p ON p.pack_id = s.pack_id
		WHERE s.char = ? AND p.deleted_at IS NULL
		ORDER BY p.ord LIMIT 1`, char).Scan(&s)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("strokes: lookup %q: %w", char, err)
	}
	return json.RawMessage(s), true, nil
}

// Packs returns the live strokes packs in lookup order (ord).
func Packs(ctx context.Context, q Querier) ([]model.StrokePack, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT pack_id, name, version, languages, license, attribution, notice, ord, updated_at
		FROM stroke_packs WHERE deleted_at IS NULL ORDER BY ord`)
	if err != nil {
		return nil, fmt.Errorf("strokes: list packs: %w", err)
	}
	defer rows.Close()
	out := []model.StrokePack{}
	for rows.Next() {
		var (
			p     model.StrokePack
			langs string
		)
		if err := rows.Scan(&p.PackID, &p.Name, &p.Version, &langs, &p.License, &p.Attribution, &p.Notice, &p.Ord, &p.UpdatedAt); err != nil {
			return nil, fmt.Errorf("strokes: list packs: %w", err)
		}
		if err := json.Unmarshal([]byte(langs), &p.Languages); err != nil {
			return nil, fmt.Errorf("strokes: pack %s: languages: %w", p.PackID, err)
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("strokes: list packs: %w", err)
	}
	return out, nil
}
