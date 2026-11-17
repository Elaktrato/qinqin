package datapkg

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"

	"qinqin/internal/dict"
)

// Retention is how long a replaced or tombstoned revision's file stays on
// disk, so a download in progress can finish.
const Retention = 7 * 24 * time.Hour

// CatalogueFormat is the catalogue's format.
const CatalogueFormat = 1

// AllLanguages in a Catalogue language list selects every package.
const AllLanguages = "all"

// ErrNotFound reports a package id or revision the server never had (or a
// string that is not a package id).
var ErrNotFound = errors.New("datapkg: package not found")

// ErrGone reports a replaced revision whose file was purged.
var ErrGone = errors.New("datapkg: package revision gone")

// Registry is the package registry (tables packages and package_files) and
// the files under Dir (<data>/packages/<id>/r<revision>.qqpkg). Builds run
// only on the Builder's goroutine, and every build and reconcile holds
// <Dir>/.lock (lock.go), so another process on the same directory (qinqin
// seed next to qinqin serve) takes turns; Catalogue and Open are safe
// anywhere.
type Registry struct {
	DB       *sql.DB
	Dir      string           // <data>/packages
	AudioDir string           // <data>/audio, where audio packages read their clips
	Now      func() time.Time // nil: time.Now
	Busy     func() bool      // nil: idle; set by Builder.Registry (the catalogue's building)
}

func (r Registry) now() time.Time {
	if r.Now != nil {
		return r.Now().UTC()
	}
	return time.Now().UTC()
}

// Row is one catalogue row (docs/contracts/packages/catalogue.json rowKeys;
// Error only in an administrator's catalogue, on a row whose last build
// failed).
type Row struct {
	ID            string       `json:"id"`
	Type          Type         `json:"type"`
	Languages     []string     `json:"languages"`
	FormatVersion int          `json:"formatVersion"`
	Revision      int          `json:"revision"`
	ContentHash   string       `json:"contentHash"`
	SHA256        string       `json:"sha256"`
	Bytes         int64        `json:"bytes"`
	URL           *string      `json:"url"`
	State         string       `json:"state"`
	BuiltAt       *string      `json:"builtAt"`
	Requires      []string     `json:"requires"`
	Optional      bool         `json:"optional"`
	LicenseTexts  bool         `json:"licenseTexts"`
	Sources       []SourceInfo `json:"sources"`
	UpdatedAt     string       `json:"updatedAt"`
	DeletedAt     *string      `json:"deletedAt"`
	Error         string       `json:"error,omitempty"`
}

// Catalogue is GET /api/packages. ETag is the quoted entity tag of its JSON.
type Catalogue struct {
	Format     int      `json:"format"`
	InstanceID string   `json:"instanceId"`
	Languages  []string `json:"languages"`
	Building   bool     `json:"building"`
	Packages   []Row    `json:"packages"`
	ETag       string   `json:"-"`
}

// FileInfo describes an opened package file.
type FileInfo struct {
	SHA256  string
	Bytes   int64
	ModTime time.Time
}

// InstanceID returns this database's instance id (server_meta).
func InstanceID(ctx context.Context, q Querier) (string, error) {
	rows, err := q.QueryContext(ctx, `SELECT value FROM server_meta WHERE key = 'instance_id'`)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	if !rows.Next() {
		if err := rows.Err(); err != nil {
			return "", err
		}
		return "", errors.New("datapkg: no instance id in server_meta")
	}
	var id string
	if err := rows.Scan(&id); err != nil {
		return "", err
	}
	return id, rows.Err()
}

// Catalogue lists the packages of any of languages (sorted by id), with
// tombstones. A languages entry "all" (AllLanguages) selects every package
// and reports every language that has one; an empty list selects nothing.
// admin adds each row's last build error.
func (r Registry) Catalogue(ctx context.Context, languages []string, admin bool) (Catalogue, error) {
	instance, err := InstanceID(ctx, r.DB)
	if err != nil {
		return Catalogue{}, err
	}
	all := slices.Contains(languages, AllLanguages)
	want := map[string]bool{}
	for _, l := range languages {
		want[l] = true
	}
	rows, err := r.DB.QueryContext(ctx, `SELECT id, type, languages, format_version, revision, content_hash, file_sha256, bytes,
		built_at, state, error, requires, optional, sources, license_texts, updated_at, deleted_at FROM packages ORDER BY id`)
	if err != nil {
		return Catalogue{}, err
	}
	defer rows.Close()
	c := Catalogue{Format: CatalogueFormat, InstanceID: instance, Languages: []string{}, Packages: []Row{}}
	seen := map[string]bool{}
	for rows.Next() {
		var (
			row                      Row
			langs, requires, sources string
			builtAt, deletedAt       sql.NullString
		)
		if err := rows.Scan(&row.ID, &row.Type, &langs, &row.FormatVersion, &row.Revision, &row.ContentHash, &row.SHA256,
			&row.Bytes, &builtAt, &row.State, &row.Error, &requires, &row.Optional, &sources, &row.LicenseTexts,
			&row.UpdatedAt, &deletedAt); err != nil {
			return Catalogue{}, err
		}
		if err := errors.Join(json.Unmarshal([]byte(langs), &row.Languages), json.Unmarshal([]byte(requires), &row.Requires),
			json.Unmarshal([]byte(sources), &row.Sources)); err != nil {
			return Catalogue{}, fmt.Errorf("datapkg: catalogue row %s: %w", row.ID, err)
		}
		listed := all
		for _, l := range row.Languages {
			listed = listed || want[l]
		}
		if !listed {
			continue
		}
		for _, l := range row.Languages {
			if all && !seen[l] {
				seen[l] = true
				c.Languages = append(c.Languages, l)
			}
		}
		if builtAt.Valid {
			row.BuiltAt = &builtAt.String
		}
		if deletedAt.Valid {
			row.DeletedAt = &deletedAt.String
		}
		if row.State == stateReady {
			u := "/api/packages/" + row.ID + "/" + strconv.Itoa(row.Revision)
			row.URL = &u
		}
		if !admin {
			row.Error = ""
		}
		c.Building = c.Building || row.State == stateBuilding
		c.Packages = append(c.Packages, row)
	}
	if err := rows.Err(); err != nil {
		return Catalogue{}, err
	}
	if !all {
		for l := range want {
			c.Languages = append(c.Languages, l)
		}
	}
	slices.Sort(c.Languages)
	c.Building = c.Building || (r.Busy != nil && r.Busy())
	body, err := json.Marshal(c)
	if err != nil {
		return Catalogue{}, err
	}
	sum := sha256.Sum256(body)
	c.ETag = `"` + hex.EncodeToString(sum[:16]) + `"`
	return c, nil
}

// Open opens the file of a package revision. An id that is not a package
// id, or an id and revision the registry never had, is ErrNotFound; a
// replaced revision whose file was purged (or is past its retention) is
// ErrGone. The path is built from the validated id and the integer only.
func (r Registry) Open(ctx context.Context, id string, revision int) (*os.File, FileInfo, error) {
	if _, _, err := ParseID(id); err != nil || revision < 1 {
		return nil, FileInfo{}, ErrNotFound
	}
	var (
		info   FileInfo
		retire sql.NullString
	)
	err := r.DB.QueryRowContext(ctx, `SELECT sha256, bytes, retire_after FROM package_files WHERE id = ? AND revision = ?`, id, revision).
		Scan(&info.SHA256, &info.Bytes, &retire)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, FileInfo{}, ErrNotFound
	}
	if err != nil {
		return nil, FileInfo{}, err
	}
	retired := retire.Valid
	if retired && expired(retire.String, r.now()) {
		return nil, FileInfo{}, ErrGone
	}
	f, err := os.Open(r.filePath(id, revision))
	if errors.Is(err, os.ErrNotExist) {
		if retired {
			return nil, FileInfo{}, ErrGone
		}
		return nil, FileInfo{}, ErrNotFound // the current revision before a rebuild after a restore
	}
	if err != nil {
		return nil, FileInfo{}, err
	}
	st, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, FileInfo{}, err
	}
	info.ModTime = st.ModTime()
	return f, info, nil
}

// Reconcile brings the registry in line with the database: it deletes
// stray .tmp files and the files of revisions past their retention,
// tombstones packages whose packs are gone, and builds every package that
// should exist and is missing, not ready, of an old formatVersion, without
// its file, failed last time, or whose sources or metadata changed. A
// package that is current is not rebuilt (pack imports and uninstalls kick
// their packages directly). Run it on the Builder (KickReconcile) so builds
// never overlap. It returns the first build error after trying them all.
// It holds the registry lock throughout (the purge of stray .tmp files must
// not meet another process's build in flight).
func (r Registry) Reconcile(ctx context.Context) error {
	unlock, err := r.lock(ctx)
	if err != nil {
		return fmt.Errorf("datapkg: lock: %w", err)
	}
	defer unlock()
	if err := r.purgeTemp(); err != nil {
		return err
	}
	if err := r.purgeExpired(ctx); err != nil {
		return err
	}
	specs, err := Plan(ctx, r.DB)
	if err != nil {
		return err
	}
	planned := map[string]Spec{}
	for _, s := range specs {
		planned[s.ID] = s
	}
	ids, err := r.rowIDs(ctx)
	if err != nil {
		return err
	}
	var first error
	for _, id := range ids {
		if _, ok := planned[id]; !ok {
			if err := r.buildLocked(ctx, id, specs); err != nil && first == nil {
				first = err
			}
		}
	}
	for _, s := range specs {
		row, ok, err := r.row(ctx, s.ID)
		if err != nil {
			return err
		}
		if ok && !r.stale(row, s) {
			continue
		}
		if err := r.buildLocked(ctx, s.ID, specs); err != nil && first == nil {
			first = err
		}
	}
	return first
}

// The package states (migration 039's CHECK).
const (
	stateBuilding = "building"
	stateReady    = "ready"
	stateFailed   = "failed"
	stateDeleted  = "deleted"
)

// pkgRow is a packages row as the builder needs it.
type pkgRow struct {
	id, state, contentHash, errText, meta string
	languages, requires                   string // JSON as stored: the manifest fields outside the content hash
	revision, formatVersion               int
	bytes                                 int64
}

func (r Registry) row(ctx context.Context, id string) (pkgRow, bool, error) {
	var (
		p                        pkgRow
		langs, requires, sources string
		optional, licenseTexts   bool
	)
	err := r.DB.QueryRowContext(ctx, `SELECT id, state, content_hash, error, revision, format_version, bytes, languages, requires,
		sources, optional, license_texts FROM packages WHERE id = ?`, id).
		Scan(&p.id, &p.state, &p.contentHash, &p.errText, &p.revision, &p.formatVersion, &p.bytes, &langs, &requires, &sources, &optional, &licenseTexts)
	if errors.Is(err, sql.ErrNoRows) {
		return pkgRow{}, false, nil
	}
	if err != nil {
		return pkgRow{}, false, err
	}
	p.meta = metaKey(langs, requires, sources, optional, licenseTexts)
	p.languages, p.requires = langs, requires
	return p, true, nil
}

func (r Registry) rowIDs(ctx context.Context) ([]string, error) {
	rows, err := r.DB.QueryContext(ctx, `SELECT id FROM packages WHERE state <> 'deleted' ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// specMeta is the registry columns a spec decides (JSON as stored).
type specMeta struct{ languages, requires, sources string }

func metaOf(s Spec) specMeta {
	langs, _ := json.Marshal(s.Languages)
	req := s.Requires
	if req == nil {
		req = []string{}
	}
	requires, _ := json.Marshal(req)
	infos := make([]SourceInfo, 0, len(s.Sources))
	for _, src := range s.Sources {
		infos = append(infos, SourceInfo{Type: src.Type, PackID: src.PackID, Name: src.Name, Version: src.Version,
			License: src.License, Attribution: src.Attribution, Notice: src.Notice})
	}
	sources, _ := json.Marshal(infos)
	return specMeta{string(langs), string(requires), string(sources)}
}

func metaKey(langs, requires, sources string, optional, licenseTexts bool) string {
	return strings.Join([]string{langs, requires, sources, strconv.FormatBool(optional), strconv.FormatBool(licenseTexts)}, "\x00")
}

func specKey(s Spec) string {
	m := metaOf(s)
	return metaKey(m.languages, m.requires, m.sources, s.Optional, s.LicenseTexts())
}

// stale reports whether a planned package needs a build at reconcile: also
// when the current file's size is not the row's (a file of another build
// under the same name, e.g. after an interrupted commit).
func (r Registry) stale(p pkgRow, s Spec) bool {
	return p.state != stateReady || p.formatVersion != FormatVersion || p.errText != "" ||
		p.meta != specKey(s) || !r.fileExists(p.id, p.revision) || r.fileSize(p.id, p.revision) != p.bytes
}

// fileSize is the size of a revision's file (-1 when it cannot be read).
func (r Registry) fileSize(id string, revision int) int64 {
	st, err := os.Stat(r.filePath(id, revision))
	if err != nil {
		return -1
	}
	return st.Size()
}

func (r Registry) filePath(id string, revision int) string {
	return filepath.Join(r.Dir, id, "r"+strconv.Itoa(revision)+".qqpkg")
}

func (r Registry) fileExists(id string, revision int) bool {
	if revision < 1 {
		return false
	}
	st, err := os.Stat(r.filePath(id, revision))
	return err == nil && st.Mode().IsRegular()
}

// build makes the registry row and file of one package id match the
// database: a tombstone when no spec plans it, else a build that becomes a
// new revision only when its content hash differs from the current one.
// A failed build keeps a ready revision ready and records the error. It
// takes the registry lock and plans under it; a lock that cannot be taken
// (an unusable directory) is that package's build failure, recorded on its
// row without touching files.
func (r Registry) build(ctx context.Context, id string) error {
	if _, _, err := ParseID(id); err != nil {
		return err
	}
	unlock, lockErr := r.lock(ctx)
	if lockErr != nil && ctx.Err() != nil {
		return lockErr
	}
	if lockErr == nil {
		defer unlock()
	}
	specs, err := Plan(ctx, r.DB)
	if err != nil {
		return err
	}
	if lockErr != nil {
		return r.buildOrFail(ctx, id, specs, fmt.Errorf("lock: %w", lockErr))
	}
	return r.buildLocked(ctx, id, specs)
}

// buildLocked is build under the registry lock, against specs.
func (r Registry) buildLocked(ctx context.Context, id string, specs []Spec) error {
	return r.buildOrFail(ctx, id, specs, nil)
}

// buildOrFail builds id, or with fail set only records fail as the build's
// failure (rows only).
func (r Registry) buildOrFail(ctx context.Context, id string, specs []Spec, fail error) error {
	if _, _, err := ParseID(id); err != nil {
		return err
	}
	now := r.now()
	stamp := now.Format(time.RFC3339)
	row, exists, err := r.row(ctx, id)
	if err != nil {
		return err
	}
	i := slices.IndexFunc(specs, func(s Spec) bool { return s.ID == id })
	if i < 0 {
		if !exists || row.state == stateDeleted {
			return nil
		}
		return r.tombstone(ctx, id, now)
	}
	spec := specs[i]
	m := metaOf(spec)
	if !exists {
		if _, err := r.DB.ExecContext(ctx, `INSERT INTO packages (id, type, languages, format_version, revision, content_hash,
			file_sha256, bytes, built_at, state, error, requires, optional, sources, license_texts, updated_at)
			VALUES (?, ?, ?, ?, 0, '', '', 0, NULL, 'building', '', ?, ?, ?, ?, ?)`,
			id, string(spec.Type), m.languages, FormatVersion, m.requires, spec.Optional, m.sources, spec.LicenseTexts(), stamp); err != nil {
			return err
		}
		row = pkgRow{id: id, state: stateBuilding}
	}
	if fail != nil {
		return r.recordFailure(ctx, row, spec, fail, stamp)
	}
	maxRev := row.revision
	if err := r.DB.QueryRowContext(ctx, `SELECT COALESCE(MAX(revision), 0) FROM package_files WHERE id = ?`, id).Scan(&maxRev); err != nil {
		return err
	}
	maxRev = max(maxRev, row.revision)

	// A ready revision whose file is missing (a restored database): build
	// that revision again; only a content change makes a new one.
	cand := maxRev + 1
	if row.state == stateReady && row.revision >= 1 && !r.fileExists(id, row.revision) {
		cand = row.revision
	}
	built, err := r.buildFile(ctx, spec, cand, now)
	if err != nil {
		return r.recordFailure(ctx, row, spec, err, stamp)
	}
	// The manifest carries languages and requires, which the content hash
	// does not cover: a change of them is a new revision too, so the file's
	// manifest.json and the catalogue row agree. (optional is catalogue
	// only: revive updates it in place.)
	same := row.revision >= 1 && built.ContentHash == row.contentHash && row.formatVersion == FormatVersion &&
		row.languages == m.languages && row.requires == m.requires
	switch {
	case same && cand == row.revision:
		return r.commit(ctx, spec, built, cand, now)
	case same && r.fileExists(id, row.revision):
		os.Remove(built.Path)
		return r.revive(ctx, row, spec, stamp)
	case same:
		// The current revision's file is gone (purged after a tombstone):
		// rebuild it under its own number.
		os.Remove(built.Path)
		again, err := r.buildFile(ctx, spec, row.revision, now)
		if err != nil {
			return r.recordFailure(ctx, row, spec, err, stamp)
		}
		return r.commit(ctx, spec, again, row.revision, now)
	case cand == row.revision:
		// Restored database, but the content differs: a new revision.
		os.Remove(built.Path)
		again, err := r.buildFile(ctx, spec, maxRev+1, now)
		if err != nil {
			return r.recordFailure(ctx, row, spec, err, stamp)
		}
		return r.commit(ctx, spec, again, maxRev+1, now)
	}
	return r.commit(ctx, spec, built, cand, now)
}

// buildHook runs before every package build (tests count builds and inject
// failures); a non-nil error fails the build.
var buildHook func(id string) error

func (r Registry) buildFile(ctx context.Context, spec Spec, revision int, now time.Time) (Built, error) {
	if buildHook != nil {
		if err := buildHook(spec.ID); err != nil {
			return Built{}, err
		}
	}
	instance, err := InstanceID(ctx, r.DB)
	if err != nil {
		return Built{}, err
	}
	if err := os.MkdirAll(r.Dir, 0o755); err != nil {
		return Built{}, err
	}
	return Build(ctx, r.DB, spec, BuildMeta{InstanceID: instance, Revision: revision, Now: now, AudioDir: r.AudioDir}, r.Dir)
}

// commit makes a built file the package's ready revision rev and moves it
// into place; every other live file of the package starts its retention.
// The rows go first: an interruption before the rename leaves a ready row
// without its file (the next reconcile rebuilds it), never a file whose
// bytes the rows do not describe.
func (r Registry) commit(ctx context.Context, spec Spec, b Built, rev int, now time.Time) error {
	dest := r.filePath(spec.ID, rev)
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		os.Remove(b.Path)
		return err
	}
	if err := r.commitRows(ctx, spec, b, rev, now); err != nil {
		os.Remove(b.Path)
		return err
	}
	if err := os.Rename(b.Path, dest); err != nil {
		os.Remove(b.Path)
		return err
	}
	return nil
}

func (r Registry) commitRows(ctx context.Context, spec Spec, b Built, rev int, now time.Time) error {
	stamp := now.Format(time.RFC3339)
	m := metaOf(spec)
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `INSERT INTO package_files (id, revision, sha256, bytes, retire_after) VALUES (?, ?, ?, ?, NULL)
		ON CONFLICT (id, revision) DO UPDATE SET sha256 = excluded.sha256, bytes = excluded.bytes, retire_after = NULL`,
		spec.ID, rev, b.SHA256, b.Bytes); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE package_files SET retire_after = ? WHERE id = ? AND revision <> ? AND retire_after IS NULL`,
		now.Add(Retention).Format(time.RFC3339), spec.ID, rev); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE packages SET type = ?, languages = ?, format_version = ?, revision = ?, content_hash = ?,
		file_sha256 = ?, bytes = ?, built_at = ?, state = 'ready', error = '', requires = ?, optional = ?, sources = ?,
		license_texts = ?, updated_at = ?, deleted_at = NULL WHERE id = ?`,
		string(spec.Type), m.languages, FormatVersion, rev, b.ContentHash, b.SHA256, b.Bytes, b.Manifest.BuiltAt,
		m.requires, spec.Optional, m.sources, spec.LicenseTexts(), stamp, spec.ID); err != nil {
		return err
	}
	return tx.Commit()
}

// revive keeps the current revision after an equal rebuild (equal content
// and manifest): nothing changes unless the row was not ready, carried an
// error or its catalogue-only metadata (optional) moved.
func (r Registry) revive(ctx context.Context, row pkgRow, spec Spec, stamp string) error {
	if row.state == stateReady && row.errText == "" && row.meta == specKey(spec) {
		return nil
	}
	m := metaOf(spec)
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `UPDATE package_files SET retire_after = NULL WHERE id = ? AND revision = ?`, row.id, row.revision); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE packages SET state = 'ready', error = '', languages = ?, requires = ?, optional = ?,
		sources = ?, license_texts = ?, updated_at = ?, deleted_at = NULL WHERE id = ?`,
		m.languages, m.requires, spec.Optional, m.sources, spec.LicenseTexts(), stamp, row.id); err != nil {
		return err
	}
	return tx.Commit()
}

// recordFailure records a failed build: a ready revision stays ready with
// the error; any other row becomes failed at revision 0 (as building).
func (r Registry) recordFailure(ctx context.Context, row pkgRow, spec Spec, cause error, stamp string) error {
	msg := cause.Error()
	if msg == "" {
		msg = "build failed"
	}
	var err error
	if row.state == stateReady {
		_, err = r.DB.ExecContext(ctx, `UPDATE packages SET error = ?, updated_at = ? WHERE id = ?`, msg, stamp, row.id)
	} else {
		m := metaOf(spec)
		_, err = r.DB.ExecContext(ctx, `UPDATE packages SET state = 'failed', error = ?, revision = 0, content_hash = '',
			file_sha256 = '', bytes = 0, built_at = NULL, languages = ?, requires = ?, optional = ?, sources = ?,
			license_texts = ?, updated_at = ?, deleted_at = NULL WHERE id = ?`,
			msg, m.languages, m.requires, spec.Optional, m.sources, spec.LicenseTexts(), stamp, row.id)
	}
	return errors.Join(fmt.Errorf("datapkg: build %s: %w", spec.ID, cause), err)
}

// tombstone marks a package deleted, keeping its last build's values, and
// starts the retention of its files.
func (r Registry) tombstone(ctx context.Context, id string, now time.Time) error {
	stamp := now.Format(time.RFC3339)
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `UPDATE packages SET state = 'deleted', error = '', updated_at = ?, deleted_at = ? WHERE id = ?`,
		stamp, stamp, id); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE package_files SET retire_after = ? WHERE id = ? AND retire_after IS NULL`,
		now.Add(Retention).Format(time.RFC3339), id); err != nil {
		return err
	}
	return tx.Commit()
}

// purgeTemp deletes the .tmp files of interrupted builds.
func (r Registry) purgeTemp() error {
	ents, err := os.ReadDir(r.Dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, e := range ents {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".tmp") {
			if err := os.Remove(filepath.Join(r.Dir, e.Name())); err != nil && !errors.Is(err, os.ErrNotExist) {
				return err
			}
		}
	}
	return nil
}

// purgeExpired deletes the files of revisions past their retention; their
// package_files rows stay, so a download of one answers "gone".
func (r Registry) purgeExpired(ctx context.Context) error {
	rows, err := r.DB.QueryContext(ctx, `SELECT id, revision, retire_after FROM package_files WHERE retire_after IS NOT NULL`)
	if err != nil {
		return err
	}
	type file struct {
		id  string
		rev int
	}
	var gone []file
	now := r.now()
	for rows.Next() {
		var (
			f      file
			retire string
		)
		if err := rows.Scan(&f.id, &f.rev, &retire); err != nil {
			rows.Close()
			return err
		}
		if expired(retire, now) {
			gone = append(gone, f)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, f := range gone {
		if _, _, err := ParseID(f.id); err != nil || f.rev < 1 {
			continue
		}
		if err := os.Remove(r.filePath(f.id, f.rev)); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	return nil
}

// expired reports whether a retire_after stamp has passed (an unreadable
// stamp counts as passed).
func expired(retire string, now time.Time) bool {
	t, err := time.Parse(time.RFC3339, retire)
	return err != nil || !now.Before(t)
}

// AffectedIDs returns the packages a change of one pack (its type,
// registry id and language) touches: a dictionary its language's lexicon
// and the levels and sentences packages of that language (their rows keep
// only live entries); any other pack its own package. Uninstalled packs
// are included: their packages become tombstones.
func AffectedIDs(ctx context.Context, q Querier, typ, packID, language string) []string {
	var ids []string
	add := func(id string) {
		if _, _, err := ParseID(id); err == nil && !slices.Contains(ids, id) {
			ids = append(ids, id)
		}
	}
	if typ != dict.TypeDictionary {
		add(typ + "." + packID)
		return ids
	}
	add(string(TypeLexicon) + "." + language)
	for _, query := range []struct{ typ, sql string }{
		{string(TypeLevels), `SELECT pack_id FROM schemes WHERE language = ? AND deleted_at IS NULL ORDER BY pack_id`},
		{string(TypeSentences), `SELECT pack_id FROM sentence_packs WHERE language = ? AND deleted_at IS NULL ORDER BY pack_id`},
	} {
		rows, err := q.QueryContext(ctx, query.sql, language)
		if err != nil {
			continue // the lexicon is kicked; a reconcile catches the rest
		}
		for rows.Next() {
			var p string
			if rows.Scan(&p) == nil {
				add(query.typ + "." + p)
			}
		}
		rows.Close()
	}
	return ids
}
