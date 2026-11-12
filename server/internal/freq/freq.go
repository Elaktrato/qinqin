// Package freq imports frequency packs — word-frequency lists in the
// Yomitan or CSV format — into the lexicon's lx_freq_packs and
// lx_frequency tables, and looks terms up in them. A frequency pack is
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
	"time"

	"qinqin/internal/dict"
)

const (
	bom            = "\xef\xbb\xbf" // UTF-8 byte order mark
	csvFile        = "freq.csv"
	indexFile      = "index.json"
	bankGlob       = "term_meta_bank_*.json"
	insertBatch    = 150 // rows per INSERT: 5 columns each, under SQLite's 999-variable floor
	lookupBatch    = 500 // terms per IN (...) list
	modeRank       = "rank-based"
	modeOccurrence = "occurrence-based"
)

// row is one parsed frequency row. value is the number the pack gave —
// the rank itself, or an occurrence count until ranks are derived.
type row struct {
	term, reading, display string
	value                  float64
}

// Import installs the frequency pack p: its lx_freq_packs row and every
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
func Import(ctx context.Context, sqlDB *sql.DB, p *dict.Pack) (dict.Result, error) {
	m := p.Manifest
	if err := m.Validate(); err != nil {
		return dict.Result{}, fmt.Errorf("%w: %v", dict.ErrInvalidPack, err)
	}
	if m.Type != dict.TypeFrequency {
		return dict.Result{}, fmt.Errorf("%w: %q is a %s pack, not a frequency pack", dict.ErrInvalidPack, m.ID, m.Type)
	}

	var (
		rows []row
		err  error
	)
	switch m.Format {
	case dict.FormatFreqCSV:
		rows, err = readCSV(p.Dir)
	case dict.FormatYomitanFreq:
		rows, err = readYomitan(p.Dir)
	default:
		err = fmt.Errorf("format %q is not a frequency format (want yomitan-freq or freq-csv)", m.Format)
	}
	if err != nil {
		return dict.Result{}, fmt.Errorf("%w: frequency pack %s: %v", dict.ErrInvalidPack, m.ID, err)
	}
	hash := fingerprint(rows)

	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return dict.Result{}, fmt.Errorf("import frequency pack %s: %w", m.ID, err)
	}
	defer tx.Rollback()

	var (
		id                                            int64
		name, version, language, license, attribution string
		oldHash                                       string
		deleted                                       sql.NullString
	)
	err = tx.QueryRowContext(ctx, `
		SELECT id, name, version, language, license, attribution, content_hash, deleted_at
		FROM lx_freq_packs WHERE pack_id = ?`, m.ID).
		Scan(&id, &name, &version, &language, &license, &attribution, &oldHash, &deleted)
	result := dict.Result{Entries: len(rows)}
	switch {
	case errors.Is(err, sql.ErrNoRows):
		stamp := time.Now().UTC().Format(time.RFC3339)
		if err = tx.QueryRowContext(ctx, `
			INSERT INTO lx_freq_packs (pack_id, name, version, language, license, attribution, ord, content_hash, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(ord), 0) + 1 FROM lx_freq_packs), ?, ?)
			RETURNING id`,
			m.ID, m.Name, m.Version, m.Language, m.License, m.Attribution, hash, stamp).Scan(&id); err != nil {
			return dict.Result{}, fmt.Errorf("register frequency pack %s: %w", m.ID, err)
		}
	case err != nil:
		return dict.Result{}, fmt.Errorf("import frequency pack %s: %w", m.ID, err)
	default:
		if !deleted.Valid && oldHash == hash && name == m.Name && version == m.Version &&
			language == m.Language && license == m.License && attribution == m.Attribution {
			return result, nil // identical: nothing to write
		}
		if _, err = tx.ExecContext(ctx, `
			UPDATE lx_freq_packs SET name = ?, version = ?, language = ?, license = ?, attribution = ?,
				content_hash = ?, updated_at = ?, deleted_at = NULL
			WHERE id = ?`,
			m.Name, m.Version, m.Language, m.License, m.Attribution, hash,
			time.Now().UTC().Format(time.RFC3339), id); err != nil {
			return dict.Result{}, fmt.Errorf("update frequency pack %s: %w", m.ID, err)
		}
		if _, err = tx.ExecContext(ctx, `DELETE FROM lx_frequency WHERE pack_id = ?`, id); err != nil {
			return dict.Result{}, fmt.Errorf("replace frequency rows of %s: %w", m.ID, err)
		}
	}
	if err := insertRows(ctx, tx, id, rows); err != nil {
		return dict.Result{}, fmt.Errorf("import frequency pack %s: %w", m.ID, err)
	}
	if err := tx.Commit(); err != nil {
		return dict.Result{}, fmt.Errorf("import frequency pack %s: %w", m.ID, err)
	}
	return result, nil
}

// insertRows writes rows with rank derived from value (already final for
// rank-based packs), in multi-row INSERTs.
func insertRows(ctx context.Context, tx *sql.Tx, packID int64, rows []row) error {
	for start := 0; start < len(rows); start += insertBatch {
		batch := rows[start:min(start+insertBatch, len(rows))]
		var q strings.Builder
		q.WriteString(`INSERT INTO lx_frequency (pack_id, term, reading, rank, display) VALUES `)
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
	f, err := os.Open(filepath.Join(dir, csvFile))
	var src io.Reader = f
	if errors.Is(err, fs.ErrNotExist) {
		gz, gzErr := os.Open(filepath.Join(dir, csvFile+".gz"))
		if gzErr != nil {
			return nil, fmt.Errorf("neither %s nor %s.gz found", csvFile, csvFile)
		}
		defer gz.Close()
		zr, zErr := gzip.NewReader(gz)
		if zErr != nil {
			return nil, fmt.Errorf("%s.gz: %w", csvFile, zErr)
		}
		defer zr.Close()
		src = zr
	} else if err != nil {
		return nil, err
	} else {
		defer f.Close()
	}

	r := csv.NewReader(src)
	r.FieldsPerRecord = 3
	r.ReuseRecord = true
	head, err := r.Read()
	if err != nil {
		return nil, fmt.Errorf("%s: read header: %w", csvFile, err)
	}
	if h := strings.TrimPrefix(strings.Join(head, ","), bom); h != "term,reading,rank" {
		return nil, fmt.Errorf("%s: header is %q, want term,reading,rank", csvFile, h)
	}
	var rows []row
	for i := 0; ; i++ {
		rec, err := r.Read()
		if errors.Is(err, io.EOF) {
			return rows, nil
		}
		if err != nil {
			return nil, fmt.Errorf("%s row %d: %w", csvFile, i, err)
		}
		if rec[0] == "" {
			return nil, fmt.Errorf("%s row %d: empty term", csvFile, i)
		}
		rank, err := strconv.Atoi(strings.TrimSpace(rec[2]))
		if err != nil || rank < 1 {
			return nil, fmt.Errorf("%s row %d: rank %q is not a positive integer", csvFile, i, rec[2])
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
		zips, _ := filepath.Glob(filepath.Join(dir, "*.zip"))
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
	raw, err := fs.ReadFile(fsys, indexFile)
	if err != nil {
		return nil, err
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
	f, err := fsys.Open(name)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	dec := json.NewDecoder(f)
	dec.UseNumber()
	if tok, err := dec.Token(); err != nil || tok != json.Delim('[') {
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
	if err != nil || math.IsNaN(v) || math.IsInf(v, 0) || v < 0 {
		return row{}, fmt.Errorf("frequency %q is not a non-negative number", s)
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

// PackInfo describes an installed frequency pack.
type PackInfo struct {
	ID                                                    int64
	PackID, Name, Version, Language, License, Attribution string
	Ord                                                   int
}

// Packs lists the installed packs in priority order (ord): the first pack
// with data for a term is the one whose frequency ordering applies.
func (s Store) Packs(ctx context.Context) ([]PackInfo, error) {
	rows, err := s.DB.QueryContext(ctx, `
		SELECT id, pack_id, name, version, language, license, attribution, ord
		FROM lx_freq_packs WHERE deleted_at IS NULL ORDER BY ord, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PackInfo
	for rows.Next() {
		var p PackInfo
		if err := rows.Scan(&p.ID, &p.PackID, &p.Name, &p.Version, &p.Language, &p.License, &p.Attribution, &p.Ord); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// Lookup returns, for each requested term that has data, at most one Hit
// per pack, in pack order (see Packs): the best — lowest — rank among the
// term's rows in that pack. When readings[term] is non-empty the rows
// whose reading is one of them, or empty (an empty reading matches any),
// are preferred; if the pack has none of those for the term, its best row
// overall is used. Duplicate terms are harmless.
func (s Store) Lookup(ctx context.Context, terms []string, readings map[string][]string) (map[string][]Hit, error) {
	type best struct {
		any, match *Hit
	}
	type key struct {
		term string
		pack int64
	}
	var (
		uniq  []string
		seen  = map[string]bool{}
		accs  = map[key]*best{}
		order = map[string][]int64{} // term -> packs in first-seen (ord) order
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
			SELECT f.term, f.reading, f.rank, f.display, p.id, p.name
			FROM lx_frequency f JOIN lx_freq_packs p ON p.id = f.pack_id
			WHERE p.deleted_at IS NULL AND f.term IN (`+strings.TrimSuffix(strings.Repeat("?,", len(chunk)), ",")+`)
			ORDER BY p.ord, p.id, f.rowid`, args...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var (
				term, reading string
				h             Hit
			)
			if err := rows.Scan(&term, &reading, &h.Rank, &h.Display, &h.PackID, &h.PackName); err != nil {
				rows.Close()
				return nil, err
			}
			k := key{term, h.PackID}
			a := accs[k]
			if a == nil {
				a = &best{}
				accs[k] = a
				order[term] = append(order[term], h.PackID)
			}
			if a.any == nil || h.Rank < a.any.Rank {
				hit := h
				a.any = &hit
			}
			if reading == "" || contains(readings[term], reading) {
				if a.match == nil || h.Rank < a.match.Rank {
					hit := h
					a.match = &hit
				}
			}
		}
		if err := errors.Join(rows.Err(), rows.Close()); err != nil {
			return nil, err
		}
	}

	out := map[string][]Hit{}
	for term, packs := range order {
		for _, id := range packs {
			a := accs[key{term, id}]
			switch {
			case len(readings[term]) == 0:
				out[term] = append(out[term], *a.any)
			case a.match != nil:
				out[term] = append(out[term], *a.match)
			default:
				out[term] = append(out[term], *a.any)
			}
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
