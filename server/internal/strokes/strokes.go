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
	"unicode/utf8"

	"qinqin/internal/model"
	"qinqin/internal/pack"
)

// Format is the one strokes pack format.
const Format = pack.FormatStrokesJSONLGz

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
var ErrNotFound = pack.NotFound("strokes: pack not found")

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
// pack.ErrInvalidPack naming the line and leaves nothing behind. An
// identical re-import (same rows and manifest fields) writes nothing.
//
// ord, the pack's priority in Lookup (the first live pack with data for a
// character wins), is assigned at the pack's first registration and kept on
// re-import and reinstall.
func Import(ctx context.Context, sqlDB *sql.DB, p pack.Pack) (Result, error) {
	m := p.Manifest
	if err := m.Validate(); err != nil {
		return Result{}, fmt.Errorf("%w: %v", pack.ErrInvalidPack, err)
	}
	if m.Type != pack.TypeStrokes {
		return Result{}, fmt.Errorf("%w: %q is a %s pack, not a strokes pack", pack.ErrInvalidPack, m.ID, m.Type)
	}
	if m.Format != Format {
		return Result{}, fmt.Errorf("%w: strokes pack %s: format %q is not a strokes format (want %s)", pack.ErrInvalidPack, m.ID, m.Format, Format)
	}
	path := filepath.Join(p.Dir, DataFile)
	h := sha256.New()
	n, err := scan(path, func(l line) error {
		fmt.Fprintf(h, "%s\t%s\n", l.Char, l.Data)
		return nil
	})
	if err != nil {
		return Result{}, fmt.Errorf("%w: strokes pack %s: %w", pack.ErrInvalidPack, m.ID, err)
	}
	hash := hex.EncodeToString(h.Sum(nil))
	langs := slices.Clone(m.Languages)
	slices.Sort(langs)
	langsJSON, _ := json.Marshal(langs)

	tx, err := pack.BeginWrite(ctx, sqlDB)
	if err != nil {
		return Result{}, fmt.Errorf("import strokes pack %s: %w", m.ID, err)
	}
	defer tx.Rollback()
	stamp := pack.Now()
	_, changed, err := pack.UpsertRegistry(ctx, tx, pack.Registry{Table: "stroke_packs", PackID: m.ID, Stamp: stamp,
		Columns: pack.ManifestColumns(m, pack.Column{Name: "languages", Value: string(langsJSON)},
			pack.Column{Name: "content_hash", Value: hash},
			pack.Column{Name: "ord", Expr: "(SELECT COALESCE(MAX(ord), 0) + 1 FROM stroke_packs)", InsertOnly: true})})
	if err != nil {
		return Result{}, fmt.Errorf("register strokes pack %s: %w", m.ID, err)
	}
	if !changed {
		return Result{Chars: n}, nil // identical: nothing to write
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM strokes WHERE pack_id = ?`, m.ID); err != nil {
		return Result{}, fmt.Errorf("replace strokes of %s: %w", m.ID, err)
	}

	batch := make([]any, 0, 3*insertBatch)
	flush := func() error {
		if len(batch) == 0 {
			return nil
		}
		q := "INSERT INTO strokes (pack_id, char, data) VALUES " + pack.Tuples(len(batch)/3, 3)
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
// one transaction, and turns the startup auto-install of the bundled pack
// off (AutoInstallOff). An unknown or already uninstalled pack returns
// ErrNotFound.
func Uninstall(ctx context.Context, sqlDB *sql.DB, packID string) error {
	tx, err := pack.BeginWrite(ctx, sqlDB)
	if err != nil {
		return fmt.Errorf("uninstall strokes pack %s: %w", packID, err)
	}
	defer tx.Rollback()
	stamp := pack.Now()
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
	// An administrator removed stroke data: serve must not bring the bundled
	// pack back at its next start.
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO server_meta (key, value) VALUES (?, 'off') ON CONFLICT (key) DO UPDATE SET value = 'off'`, autoInstallKey); err != nil {
		return fmt.Errorf("uninstall strokes pack %s: %w", packID, err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("uninstall strokes pack %s: %w", packID, err)
	}
	return nil
}

// autoInstallKey is the server_meta key whose value "off" stops serve from
// installing the bundled strokes pack (set by every Uninstall).
const autoInstallKey = "strokes_auto_install"

// AutoInstallOff reports whether an uninstall turned the startup
// auto-install of the bundled strokes pack off.
func AutoInstallOff(ctx context.Context, q Querier) (bool, error) {
	var v string
	err := q.QueryRowContext(ctx, `SELECT value FROM server_meta WHERE key = ?`, autoInstallKey).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("strokes: auto-install flag: %w", err)
	}
	return v == "off", nil
}

// Live reports whether any strokes pack is installed.
func Live(ctx context.Context, q Querier) (bool, error) {
	var n int
	if err := q.QueryRowContext(ctx, `SELECT COUNT(*) FROM stroke_packs WHERE deleted_at IS NULL`).Scan(&n); err != nil {
		return false, fmt.Errorf("strokes: live packs: %w", err)
	}
	return n > 0, nil
}

// Lookup returns the stroke JSON of char from the first live pack (by ord)
// that has it, byte for byte as imported; ok is false when none has it.
func Lookup(ctx context.Context, q Querier, char string) (data json.RawMessage, ok bool, err error) {
	return LookupFor(ctx, q, char, "")
}

// LookupFor is Lookup for a reader of one language (a code like "ja"): the
// same character is drawn differently in Chinese and Japanese, so a live pack
// that lists lang comes first, and among those the one with the fewest
// languages (a pack made for Japanese alone beats a shared pack); then the
// order of registration (ord) decides. A character only one pack has is
// served whatever the language, and an empty or unlisted lang is plain Lookup.
func LookupFor(ctx context.Context, q Querier, char, lang string) (data json.RawMessage, ok bool, err error) {
	rows, err := q.QueryContext(ctx, `
		SELECT s.data, p.languages FROM strokes s JOIN stroke_packs p ON p.pack_id = s.pack_id
		WHERE s.char = ? AND p.deleted_at IS NULL
		ORDER BY p.ord`, char)
	if err != nil {
		return nil, false, fmt.Errorf("strokes: lookup %q: %w", char, err)
	}
	defer rows.Close()
	best, bestRank := "", -1 // rank 0: lang not listed; else 1 + (100 - the number of languages listed)
	for rows.Next() {
		var d, langs string
		if err := rows.Scan(&d, &langs); err != nil {
			return nil, false, fmt.Errorf("strokes: lookup %q: %w", char, err)
		}
		rank := 0
		if lang != "" {
			var list []string
			if err := json.Unmarshal([]byte(langs), &list); err != nil {
				return nil, false, fmt.Errorf("strokes: lookup %q: languages: %w", char, err)
			}
			if slices.Contains(list, lang) {
				rank = 1 + max(0, 100-len(list))
			}
		}
		if bestRank < 0 || rank > bestRank { // strictly better only: ties keep the earlier ord
			best, bestRank = d, rank
		}
	}
	if err := rows.Err(); err != nil {
		return nil, false, fmt.Errorf("strokes: lookup %q: %w", char, err)
	}
	if bestRank < 0 {
		return nil, false, nil
	}
	return json.RawMessage(best), true, nil
}

// Has reports which of chars any live strokes pack has stroke data for
// (whatever the language: LookupFor serves a character from any pack that
// has it). One query per 500 characters.
func Has(ctx context.Context, q Querier, chars []string) (map[string]bool, error) {
	out := map[string]bool{}
	const chunk = 500
	for start := 0; start < len(chars); start += chunk {
		part := chars[start:min(start+chunk, len(chars))]
		args := make([]any, len(part))
		marks := make([]string, len(part))
		for i, c := range part {
			args[i] = c
			marks[i] = "?"
		}
		rows, err := q.QueryContext(ctx, `
			SELECT DISTINCT s.char FROM strokes s JOIN stroke_packs p ON p.pack_id = s.pack_id
			WHERE p.deleted_at IS NULL AND s.char IN (`+strings.Join(marks, ",")+`)`, args...)
		if err != nil {
			return nil, fmt.Errorf("strokes: has: %w", err)
		}
		for rows.Next() {
			var c string
			if err := rows.Scan(&c); err != nil {
				rows.Close()
				return nil, fmt.Errorf("strokes: has: %w", err)
			}
			out[c] = true
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, fmt.Errorf("strokes: has: %w", err)
		}
	}
	return out, nil
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
