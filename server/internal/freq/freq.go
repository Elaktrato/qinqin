// Package freq imports frequency packs — word-frequency lists in the
// Yomitan or CSV format — into the lexicon's frequency_packs and
// frequency tables, and looks terms up in them. A frequency pack is
// not a dictionary: it carries ranks, no glosses.
package freq

import (
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"qinqin/internal/pack"
)

const (
	bom            = "\xef\xbb\xbf" // UTF-8 byte order mark
	csvFile        = "freq.csv"
	indexFile      = "index.json"
	bankGlob       = "term_meta_bank_*.json"
	insertBatch    = 150 // rows per INSERT: 5 columns each = 750 variables, under SQLite's 999 default limit
	lookupBatch    = 500 // terms per IN (...) list
	modeRank       = "rank-based"
	modeOccurrence = "occurrence-based"
)

// Input caps: pack files are untrusted, so nothing is read beyond these.
// Variables so tests can lower them.
var (
	maxIndexBytes  int64 = 1 << 20   // index.json
	maxMemberBytes int64 = 512 << 20 // a bank or the CSV, uncompressed (also the gzip-inflated size)
	maxRows              = 5_000_000 // rows per pack
)

// maxValue bounds a rank or occurrence count: above 2^53 a float64 no
// longer holds an integer exactly.
const maxValue = 1 << 53

// row is one parsed frequency row. value is the number the pack gave —
// the rank itself, or an occurrence count until ranks are derived.
type row struct {
	term, reading, display string
	value                  float64
}

// Result counts what one frequency import stored: its rows.
type Result struct {
	Entries int
}

// Import installs the frequency pack p: its frequency_packs row and every
// frequency row, in ONE transaction, so a malformed row — which aborts
// the pack with an error naming the file and row index — leaves nothing
// behind. The pack is parsed completely before the transaction begins.
//
// Result.Entries is the number of rows imported. A re-import replaces the
// pack's rows; when the metadata and the rows are identical to what is
// stored it writes nothing, so rows and updated_at stay as they were.
//
// ord, the pack's priority in Packs (the first pack with data for a term
// wins), is assigned at the pack's first registration — the order packs
// import in — and kept on re-import.
//
// Formats. freq-csv: freq.csv (or freq.csv.gz) with the header
// term,reading,rank; reading may be empty and matches any reading.
// yomitan-freq: a Yomitan dictionary, either unpacked in the pack
// directory (index.json and term_meta_bank_*.json) or as the one .zip
// file there; only [term, "freq", data] rows count. data is a number, a
// string such as "1234", {value, displayValue} or {reading, frequency:
// <any of those>}. index.json's frequencyMode "rank-based" (the default)
// stores values as ranks; "occurrence-based" turns counts into dense
// ranks, the highest count being rank 1. displayValue is kept as the
// hit's Display.
func Import(ctx context.Context, sqlDB *sql.DB, p *pack.Pack) (Result, error) {
	m := p.Manifest
	if err := m.Validate(); err != nil {
		return Result{}, fmt.Errorf("%w: %v", pack.ErrInvalidPack, err)
	}
	if m.Type != pack.TypeFrequency {
		return Result{}, fmt.Errorf("%w: %q is a %s pack, not a frequency pack", pack.ErrInvalidPack, m.ID, m.Type)
	}

	var (
		rows []row
		err  error
	)
	switch m.Format {
	case pack.FormatFreqCSV:
		rows, err = readCSV(p.Dir)
	case pack.FormatYomitanFreq:
		rows, err = readYomitan(p.Dir)
	default:
		err = fmt.Errorf("format %q is not a frequency format (want yomitan-freq or freq-csv)", m.Format)
	}
	if err != nil {
		return Result{}, fmt.Errorf("%w: frequency pack %s: %w", pack.ErrInvalidPack, m.ID, err)
	}
	hash := fingerprint(rows)

	tx, err := pack.BeginWrite(ctx, sqlDB)
	if err != nil {
		return Result{}, fmt.Errorf("import frequency pack %s: %w", m.ID, err)
	}
	defer tx.Rollback()

	result := Result{Entries: len(rows)}
	id, changed, err := pack.UpsertRegistry(ctx, tx, pack.Registry{Table: "frequency_packs", PackID: m.ID, Stamp: pack.Now(),
		Columns: pack.ManifestColumns(m, pack.Column{Name: "language", Value: m.Language},
			pack.Column{Name: "content_hash", Value: hash},
			pack.Column{Name: "ord", Expr: "(SELECT COALESCE(MAX(ord), 0) + 1 FROM frequency_packs)", InsertOnly: true})})
	if err != nil {
		return Result{}, fmt.Errorf("register frequency pack %s: %w", m.ID, err)
	}
	if !changed {
		return result, nil // identical: nothing to write
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM frequency WHERE pack_id = ?`, id); err != nil {
		return Result{}, fmt.Errorf("replace frequency rows of %s: %w", m.ID, err)
	}
	if err := insertRows(ctx, tx, id, rows); err != nil {
		return Result{}, fmt.Errorf("import frequency pack %s: %w", m.ID, err)
	}
	if err := tx.Commit(); err != nil {
		return Result{}, fmt.Errorf("import frequency pack %s: %w", m.ID, err)
	}
	return result, nil
}

// insertRows writes rows with rank derived from value (already final for
// rank-based packs), in multi-row INSERTs.
func insertRows(ctx context.Context, tx *sql.Tx, packID int64, rows []row) error {
	for start := 0; start < len(rows); start += insertBatch {
		batch := rows[start:min(start+insertBatch, len(rows))]
		var q strings.Builder
		q.WriteString(`INSERT INTO frequency (pack_id, term, reading, rank, display) VALUES `)
		args := make([]any, 0, len(batch)*5)
		for i, r := range batch {
			if i > 0 {
				q.WriteByte(',')
			}
			q.WriteString("(?,?,?,?,?)")
			args = append(args, packID, r.term, r.reading, int64(r.value), r.display)
		}
		if _, err := tx.ExecContext(ctx, q.String(), args...); err != nil {
			return err
		}
	}
	return nil
}

// fingerprint hashes the rows, in order, as they will be stored.
func fingerprint(rows []row) string {
	h := sha256.New()
	for _, r := range rows {
		fmt.Fprintf(h, "%s\x00%s\x00%d\x00%s\n", r.term, r.reading, int64(r.value), r.display)
	}
	return hex.EncodeToString(h.Sum(nil))
}

// readCSV parses freq.csv or freq.csv.gz of dir.
func readCSV(dir string) ([]row, error) {
	name := csvFile
	f, err := os.Open(filepath.Join(dir, csvFile))
	var src io.Reader = f
	if errors.Is(err, fs.ErrNotExist) {
		name = csvFile + ".gz"
		gz, gzErr := os.Open(filepath.Join(dir, name))
		if gzErr != nil {
			return nil, fmt.Errorf("neither %s nor %s.gz found", csvFile, csvFile)
		}
		defer gz.Close()
		zr, zErr := gzip.NewReader(gz)
		if zErr != nil {
			return nil, fmt.Errorf("%s: %w", name, zErr)
		}
		defer zr.Close()
		src = zr
	} else if err != nil {
		return nil, err
	} else {
		defer f.Close()
		info, err := f.Stat()
		if err != nil {
			return nil, err
		}
		if info.Size() > maxMemberBytes {
			return nil, tooLarge(name, maxMemberBytes)
		}
	}

	r := csv.NewReader(&capReader{r: src, limit: maxMemberBytes, what: name})
	r.FieldsPerRecord = 3
	r.ReuseRecord = true
	head, err := r.Read()
	if err != nil {
		return nil, fmt.Errorf("%s: read header: %w", name, err)
	}
	if h := strings.TrimPrefix(strings.Join(head, ","), bom); h != "term,reading,rank" {
		return nil, fmt.Errorf("%s: header is %q, want term,reading,rank", name, h)
	}
	var rows []row
	for i := 0; ; i++ {
		rec, err := r.Read()
		if errors.Is(err, io.EOF) {
			return rows, nil
		}
		if err != nil {
			return nil, fmt.Errorf("%s row %d: %w", name, i, err)
		}
		if len(rows) >= maxRows {
			return nil, fmt.Errorf("%s row %d: more than %d rows in the pack", name, i, maxRows)
		}
		if rec[0] == "" {
			return nil, fmt.Errorf("%s row %d: empty term", name, i)
		}
		rank, err := strconv.ParseInt(strings.TrimSpace(rec[2]), 10, 64)
		if err != nil || rank < 1 || rank > maxValue {
			return nil, fmt.Errorf("%s row %d: rank %q is not a positive integer up to 2^53", name, i, rec[2])
		}
		rows = append(rows, row{term: rec[0], reading: rec[1], value: float64(rank)})
	}
}

// readYomitan parses the Yomitan dictionary in dir (unpacked, or the one
// .zip file there).
func readYomitan(dir string) ([]row, error) {
	var fsys fs.FS
	if _, err := os.Stat(filepath.Join(dir, indexFile)); err == nil {
		fsys = os.DirFS(dir)
	} else {
		entries, err := os.ReadDir(dir)
		if err != nil {
			return nil, err
		}
		var zips []string
		for _, e := range entries {
			if !e.IsDir() && strings.EqualFold(filepath.Ext(e.Name()), ".zip") {
				zips = append(zips, filepath.Join(dir, e.Name()))
			}
		}
		if len(zips) != 1 {
			return nil, fmt.Errorf("want %s with term_meta_bank files, or exactly one .zip, in the pack (found %d zips)", indexFile, len(zips))
		}
		zr, err := zip.OpenReader(zips[0])
		if err != nil {
			return nil, err
		}
		defer zr.Close()
		fsys = &zr.Reader
	}

	var index struct {
		FrequencyMode string `json:"frequencyMode"`
	}
	xf, err := openMember(fsys, indexFile, maxIndexBytes)
	if err != nil {
		return nil, err
	}
	raw, err := io.ReadAll(xf)
	xf.Close()
	if err != nil {
		return nil, fmt.Errorf("%s: %w", indexFile, err)
	}
	if err := json.Unmarshal(raw, &index); err != nil {
		return nil, fmt.Errorf("%s: %w", indexFile, err)
	}
	mode := index.FrequencyMode
	switch mode {
	case "":
		mode = modeRank
	case modeRank, modeOccurrence:
	default:
		return nil, fmt.Errorf("%s: frequencyMode %q, want %s or %s", indexFile, mode, modeRank, modeOccurrence)
	}

	banks, err := fs.Glob(fsys, bankGlob)
	if err != nil {
		return nil, err
	}
	sort.Strings(banks)
	var rows []row
	for _, name := range banks {
		if rows, err = readBank(fsys, name, mode, rows); err != nil {
			return nil, err
		}
	}
	if mode == modeOccurrence {
		denseRanks(rows)
	}
	return rows, nil
}

// readBank streams one term_meta_bank file, appending its freq rows.
func readBank(fsys fs.FS, name, mode string, rows []row) ([]row, error) {
	f, err := openMember(fsys, name, maxMemberBytes)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	dec := json.NewDecoder(f)
	dec.UseNumber()
	tok, err := dec.Token()
	if err != nil {
		return nil, fmt.Errorf("%s: %w", name, err)
	}
	if tok != json.Delim('[') {
		return nil, fmt.Errorf("%s: not a JSON array of rows", name)
	}
	for i := 0; dec.More(); i++ {
		var cells []json.RawMessage
		if err := dec.Decode(&cells); err != nil {
			return nil, fmt.Errorf("%s row %d: %w", name, i, err)
		}
		if len(cells) != 3 {
			return nil, fmt.Errorf("%s row %d: want [term, type, data], got %d cells", name, i, len(cells))
		}
		var term, kind string
		if json.Unmarshal(cells[0], &term) != nil || json.Unmarshal(cells[1], &kind) != nil {
			return nil, fmt.Errorf("%s row %d: term and type must be strings", name, i)
		}
		if kind != "freq" {
			continue // pitch, ipa, ...
		}
		if len(rows) >= maxRows {
			return nil, fmt.Errorf("%s row %d: more than %d rows in the pack", name, i, maxRows)
		}
		if term == "" {
			return nil, fmt.Errorf("%s row %d: empty term", name, i)
		}
		r, err := parseData(cells[2])
		if err != nil {
			return nil, fmt.Errorf("%s row %d: %w", name, i, err)
		}
		r.term = term
		if mode == modeRank && (r.value != math.Trunc(r.value) || r.value < 1) {
			return nil, fmt.Errorf("%s row %d: rank %v is not a positive integer", name, i, r.value)
		}
		rows = append(rows, r)
	}
	if _, err := dec.Token(); err != nil {
		return nil, fmt.Errorf("%s: %w", name, err)
	}
	return rows, nil
}

// openMember opens name of fsys for reading at most limit bytes: a member
// whose header already claims more is refused, and the reader stops at
// limit however many bytes the data really holds (a zip header can lie).
func openMember(fsys fs.FS, name string, limit int64) (io.ReadCloser, error) {
	f, err := fsys.Open(name)
	if err != nil {
		return nil, err
	}
	info, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, err
	}
	if info.Size() > limit {
		f.Close()
		return nil, tooLarge(name, limit)
	}
	return struct {
		io.Reader
		io.Closer
	}{&capReader{r: f, limit: limit, what: name}, f}, nil
}

func tooLarge(what string, limit int64) error {
	return fmt.Errorf("%s exceeds the %d-byte limit", what, limit)
}

// capReader reads r and fails once more than limit bytes came out of it.
type capReader struct {
	r     io.Reader
	limit int64
	read  int64
	what  string
}

func (c *capReader) Read(p []byte) (int, error) {
	n, err := io.LimitReader(c.r, c.limit+1-c.read).Read(p)
	c.read += int64(n)
	if c.read > c.limit {
		return 0, tooLarge(c.what, c.limit)
	}
	return n, err
}

// parseData reads a freq row's data cell: a scalar, or {reading,
// frequency: scalar}.
func parseData(raw json.RawMessage) (row, error) {
	var obj struct {
		Reading   string          `json:"reading"`
		Frequency json.RawMessage `json:"frequency"`
	}
	if trimmed := bytes.TrimSpace(raw); len(trimmed) > 0 && trimmed[0] == '{' {
		if err := json.Unmarshal(raw, &obj); err != nil {
			return row{}, err
		}
		if obj.Frequency != nil {
			r, err := parseScalar(obj.Frequency)
			r.reading = obj.Reading
			return r, err
		}
	}
	return parseScalar(raw)
}

// parseScalar reads a number, a numeric string, or {value, displayValue}.
func parseScalar(raw json.RawMessage) (row, error) {
	var obj struct {
		Value        json.RawMessage `json:"value"`
		DisplayValue string          `json:"displayValue"`
	}
	r := row{}
	if trimmed := bytes.TrimSpace(raw); len(trimmed) > 0 && trimmed[0] == '{' {
		if err := json.Unmarshal(raw, &obj); err != nil {
			return row{}, fmt.Errorf("frequency object: %w", err)
		}
		if obj.Value == nil {
			return row{}, errors.New("frequency object has no value")
		}
		raw, r.display = obj.Value, obj.DisplayValue
	}
	var s string
	if json.Unmarshal(raw, &s) != nil {
		var n json.Number
		if err := json.Unmarshal(raw, &n); err != nil {
			return row{}, fmt.Errorf("frequency %s is not a number, numeric string or {value}", raw)
		}
		s = n.String()
	}
	v, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
	if err != nil || math.IsNaN(v) || math.IsInf(v, 0) || v < 0 || v > maxValue {
		return row{}, fmt.Errorf("frequency %q is not a non-negative number up to 2^53", s)
	}
	r.value = v
	return r, nil
}

// denseRanks replaces each row's occurrence count with its dense rank:
// the highest count is 1, equal counts share a rank, and the next
// distinct count follows without a gap.
func denseRanks(rows []row) {
	counts := make([]float64, 0, len(rows))
	seen := map[float64]bool{}
	for _, r := range rows {
		if !seen[r.value] {
			seen[r.value] = true
			counts = append(counts, r.value)
		}
	}
	sort.Sort(sort.Reverse(sort.Float64Slice(counts)))
	rank := make(map[float64]float64, len(counts))
	for i, c := range counts {
		rank[c] = float64(i + 1)
	}
	for i := range rows {
		rows[i].value = rank[rows[i].value]
	}
}

// ErrNotFound reports an uninstall of an unknown or already uninstalled
// frequency pack.
var ErrNotFound = pack.NotFound("freq: pack not found")

// Uninstall soft-deletes the pack with manifest id packID and removes its
// frequency rows (they carry no tombstone; a reinstall rewrites them), in
// one transaction. The pack keeps its priority (ord), so a reinstall takes
// its old place. An unknown or already uninstalled pack returns ErrNotFound.
func Uninstall(ctx context.Context, sqlDB *sql.DB, packID string) error {
	tx, err := pack.BeginWrite(ctx, sqlDB)
	if err != nil {
		return fmt.Errorf("uninstall frequency pack %s: %w", packID, err)
	}
	defer tx.Rollback()
	var id int64
	err = tx.QueryRowContext(ctx, `
		SELECT id FROM frequency_packs WHERE pack_id = ? AND deleted_at IS NULL`, packID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("uninstall frequency pack %s: %w", packID, err)
	}
	stamp := pack.Now()
	if _, err := tx.ExecContext(ctx, `
		UPDATE frequency_packs SET deleted_at = ?, updated_at = ? WHERE id = ?`, stamp, stamp, id); err != nil {
		return fmt.Errorf("uninstall frequency pack %s: %w", packID, err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM frequency WHERE pack_id = ?`, id); err != nil {
		return fmt.Errorf("uninstall frequency rows of %s: %w", packID, err)
	}
	return tx.Commit()
}

// Store reads frequency data.
type Store struct{ DB *sql.DB }

// Hit is one pack's frequency for a term: Rank 1 is the most frequent.
// Display is the pack's own text for the value, empty when it gave none.
type Hit struct {
	PackID   int64
	PackName string
	Rank     int
	Display  string
}

// PackInfo describes an installed frequency pack. ContentHash
// fingerprints its rows (it changes when a re-import changes them).
type PackInfo struct {
	ID                                                            int64
	PackID, Name, Version, Language, License, Attribution, Notice string
	Ord                                                           int
	ContentHash                                                   string
}

// Packs lists the installed packs in priority order (ord): the first pack
// with data for a term is the one whose frequency ordering applies.
func (s Store) Packs(ctx context.Context) ([]PackInfo, error) {
	rows, err := s.DB.QueryContext(ctx, `
		SELECT id, pack_id, name, version, language, license, attribution, notice, ord, content_hash
		FROM frequency_packs WHERE deleted_at IS NULL ORDER BY ord, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PackInfo
	for rows.Next() {
		var p PackInfo
		if err := rows.Scan(&p.ID, &p.PackID, &p.Name, &p.Version, &p.Language, &p.License, &p.Attribution, &p.Notice, &p.Ord, &p.ContentHash); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// Row is one stored frequency row with its pack: Reading "" applies to
// any reading of the term.
type Row struct {
	PackID                 int64
	PackName               string
	Term, Reading, Display string
	Rank                   int
	ord, rowid             int64 // pack priority and row position: the Rows order
}

// Rows returns every row of the active packs for the given terms —
// one statement per lookupBatch terms, under SQLite's variable limit —
// ordered by pack priority (ord, id), then row position. Duplicate terms
// are harmless.
func (s Store) Rows(ctx context.Context, terms []string) ([]Row, error) {
	var (
		uniq []string
		seen = map[string]bool{}
		out  []Row
	)
	for _, t := range terms {
		if !seen[t] {
			seen[t] = true
			uniq = append(uniq, t)
		}
	}
	for start := 0; start < len(uniq); start += lookupBatch {
		chunk := uniq[start:min(start+lookupBatch, len(uniq))]
		args := make([]any, len(chunk))
		for i, t := range chunk {
			args[i] = t
		}
		rows, err := s.DB.QueryContext(ctx, `
			SELECT f.term, f.reading, f.rank, f.display, p.id, p.name, p.ord, f.rowid
			FROM frequency f JOIN frequency_packs p ON p.id = f.pack_id
			WHERE p.deleted_at IS NULL AND f.term IN (`+pack.Placeholders(len(chunk))+`)
			ORDER BY p.ord, p.id, f.rowid`, args...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var r Row
			if err := rows.Scan(&r.Term, &r.Reading, &r.Rank, &r.Display, &r.PackID, &r.PackName, &r.ord, &r.rowid); err != nil {
				rows.Close()
				return nil, err
			}
			out = append(out, r)
		}
		if err := errors.Join(rows.Err(), rows.Close()); err != nil {
			return nil, err
		}
	}
	// Each chunk comes sorted; restore the global order across chunks.
	sort.SliceStable(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if a.ord != b.ord {
			return a.ord < b.ord
		}
		if a.PackID != b.PackID {
			return a.PackID < b.PackID
		}
		return a.rowid < b.rowid
	})
	return out, nil
}

// BestHits returns at most one Hit per pack, in the order packs first
// appear in rows (the Rows order: pack priority): the best — lowest —
// rank among the rows of any of terms. As in Yomitan, a row that carries
// a reading applies only to headwords with that reading: with readings
// non-empty only rows whose reading is listed, or empty (an empty
// reading matches any), count, and a pack with no such row gives no
// hit. With no readings the best row overall counts. Reading comparison
// is exact. On equal ranks the earlier row wins.
func BestHits(rows []Row, terms, readings []string) []Hit {
	var (
		order []int64
		best  = map[int64]*Row{}
		seen  = map[int64]bool{}
	)
	for i := range rows {
		r := &rows[i]
		if !contains(terms, r.Term) {
			continue
		}
		if !seen[r.PackID] {
			seen[r.PackID] = true
			order = append(order, r.PackID)
		}
		if len(readings) > 0 && r.Reading != "" && !contains(readings, r.Reading) {
			continue // the row names another reading
		}
		if b := best[r.PackID]; b == nil || r.Rank < b.Rank {
			best[r.PackID] = r
		}
	}
	var out []Hit
	for _, id := range order {
		if b := best[id]; b != nil {
			out = append(out, Hit{PackID: b.PackID, PackName: b.PackName, Rank: b.Rank, Display: b.Display})
		}
	}
	return out
}

// Lookup returns, for each requested term that has data, at most one Hit
// per pack, in pack order (see Packs): BestHits of the term's rows with
// readings[term]. As in Yomitan, a row that carries a reading applies
// only to headwords with that reading: when readings[term] is non-empty
// only rows whose reading is listed, or empty (an empty reading matches
// any), count, and a pack with no such row for the term gives no hit.
// When no readings are passed for the term, the best row overall
// counts. Reading comparison is exact: hiragana and katakana are
// different readings, so callers pass both script variants. Duplicate
// terms are harmless.
func (s Store) Lookup(ctx context.Context, terms []string, readings map[string][]string) (map[string][]Hit, error) {
	rows, err := s.Rows(ctx, terms)
	if err != nil {
		return nil, err
	}
	byTerm := map[string][]Row{}
	for _, r := range rows {
		byTerm[r.Term] = append(byTerm[r.Term], r)
	}
	out := map[string][]Hit{}
	for term, rs := range byTerm {
		if hits := BestHits(rs, []string{term}, readings[term]); len(hits) > 0 {
			out[term] = hits
		}
	}
	return out, nil
}

func contains(l []string, s string) bool {
	for _, x := range l {
		if x == s {
			return true
		}
	}
	return false
}
