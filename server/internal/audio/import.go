package audio

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strings"

	"qinqin/internal/pack"
)

// ImportResult counts what an import stored. Skipped rows are term rows
// whose reading yields no match key (an unparsable pinyin reading).
type ImportResult struct{ Clips, Skipped int }

// Import loads an audio pack: its index.tsv is parsed and every clip file
// validated and hashed before anything is written; blobs are then copied
// into storeDir, the pack's rows replaced in one transaction, and blobs
// the pack no longer uses (and no other pack references) removed.
func Import(ctx context.Context, sqlDB *sql.DB, pk pack.Pack, storeDir string) (ImportResult, error) {
	m := pk.Manifest
	if err := m.Validate(); err != nil {
		return ImportResult{}, fmt.Errorf("%w: %v", pack.ErrInvalidPack, err)
	}
	if m.Type != pack.TypeAudio || m.Format != pack.FormatAudioIndex {
		return ImportResult{}, fmt.Errorf("%w: %q is not an audio-index audio pack", pack.ErrInvalidPack, m.ID)
	}
	f, err := os.Open(filepath.Join(pk.Dir, "index.tsv"))
	if err != nil {
		return ImportResult{}, fmt.Errorf("%w: open index of %s: %v", pack.ErrInvalidPack, m.ID, err)
	}
	rows, err := ParseIndex(f, m)
	f.Close()
	if err != nil {
		return ImportResult{}, fmt.Errorf("%w: %s: %v", pack.ErrInvalidPack, m.ID, err)
	}

	type clip struct {
		row Row
		key string
		cf  clipFile
	}
	var (
		res   ImportResult
		clips []clip
		seen  = map[string]clipFile{}
	)
	for i, r := range rows {
		key := ReadingKey(m.Language, r.Reading)
		if key == "" && r.Kind == KindTerm && strings.TrimSpace(r.Reading) != "" {
			res.Skipped++
			continue
		}
		if r.Kind == KindSyllable {
			key = r.Reading
		}
		cf, ok := seen[r.File]
		if !ok {
			ext := strings.TrimPrefix(path.Ext(r.File), ".")
			cf, err = inspect(filepath.Join(pk.Dir, filepath.FromSlash(r.File)), ext)
			if err != nil {
				return ImportResult{}, fmt.Errorf("%w: %s: index row %d: %s: %v", pack.ErrInvalidPack, m.ID, i+1, r.File, err)
			}
			seen[r.File] = cf
		}
		clips = append(clips, clip{r, key, cf})
	}

	for _, c := range clips {
		if err := storeBlob(storeDir, c.cf); err != nil {
			return ImportResult{}, fmt.Errorf("import audio %s: store %s: %w", m.ID, c.row.File, err)
		}
	}

	old := map[blobKey]bool{}
	tx, err := pack.BeginWrite(ctx, sqlDB)
	if err != nil {
		return ImportResult{}, fmt.Errorf("import audio %s: %w", m.ID, err)
	}
	defer tx.Rollback()
	want := make([]clipRow, len(clips))
	for i, c := range clips {
		want[i] = clipRow{c.row.Kind, c.row.Form, c.key, c.cf.sha, c.cf.ext, c.cf.size, c.row.License, c.row.Attribution, c.row.Source}
	}
	have, err := packClips(ctx, tx, m.ID)
	if err != nil {
		return ImportResult{}, fmt.Errorf("import audio %s: %w", m.ID, err)
	}
	stamp := pack.Now()
	// The registry row holds no fingerprint of the clips, so a change of
	// them alone writes it too (Force): its updated_at says the pack changed.
	packRow, changed, err := pack.UpsertRegistry(ctx, tx, pack.Registry{Table: "audio_packs", PackID: m.ID, Stamp: stamp,
		Columns: pack.ManifestColumns(m, pack.Column{Name: "language", Value: m.Language},
			pack.Column{Name: "created_at", Value: stamp, InsertOnly: true}),
		Force: !slices.Equal(have, want)})
	if err != nil {
		return ImportResult{}, fmt.Errorf("import audio %s: %w", m.ID, err)
	}
	if !changed {
		res.Clips = len(clips) // the clips are the stored ones: nothing to write
		return res, nil
	}
	cur, err := tx.QueryContext(ctx, `SELECT DISTINCT sha256, ext FROM audio_clips WHERE pack_id = ?`, packRow)
	if err != nil {
		return ImportResult{}, fmt.Errorf("import audio %s: %w", m.ID, err)
	}
	for cur.Next() {
		var b blobKey
		if err := cur.Scan(&b.sha, &b.ext); err != nil {
			cur.Close()
			return ImportResult{}, fmt.Errorf("import audio %s: %w", m.ID, err)
		}
		old[b] = true
	}
	err = cur.Err()
	cur.Close()
	if err != nil {
		return ImportResult{}, fmt.Errorf("import audio %s: %w", m.ID, err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM audio_clips WHERE pack_id = ?`, packRow); err != nil {
		return ImportResult{}, fmt.Errorf("import audio %s: %w", m.ID, err)
	}
	for _, c := range clips {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO audio_clips (pack_id, kind, form, reading_key, sha256, ext, bytes, license, attribution, source)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			packRow, c.row.Kind, c.row.Form, c.key, c.cf.sha, c.cf.ext, c.cf.size, c.row.License, c.row.Attribution, c.row.Source); err != nil {
			return ImportResult{}, fmt.Errorf("import audio %s: %w", m.ID, err)
		}
		res.Clips++
	}
	if err := tx.Commit(); err != nil {
		return ImportResult{}, fmt.Errorf("import audio %s: %w", m.ID, err)
	}

	// Garbage-collect after commit: a failure here only leaves an orphan.
	if err := collectBlobs(ctx, sqlDB, storeDir, old); err != nil {
		return res, fmt.Errorf("import audio %s: %w", m.ID, err)
	}
	return res, nil
}

// clipRow is one audio_clips row of a pack, without its ids.
type clipRow struct {
	kind, form, readingKey, sha, ext string
	bytes                            int64
	license, attribution, source     string
}

// packClips returns the stored clip rows of the pack packID in id order
// (the order an import inserts them).
func packClips(ctx context.Context, tx *sql.Tx, packID string) ([]clipRow, error) {
	rows, err := tx.QueryContext(ctx, `SELECT c.kind, c.form, c.reading_key, c.sha256, c.ext, c.bytes, c.license, c.attribution, c.source
		FROM audio_clips c JOIN audio_packs p ON p.id = c.pack_id WHERE p.pack_id = ? ORDER BY c.id`, packID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []clipRow{}
	for rows.Next() {
		var r clipRow
		if err := rows.Scan(&r.kind, &r.form, &r.readingKey, &r.sha, &r.ext, &r.bytes, &r.license, &r.attribution, &r.source); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// blobKey names a stored clip file: its hash and extension.
type blobKey struct{ sha, ext string }

// collectBlobs removes the given blobs that no clip row references any more,
// whichever pack the row belongs to. It is the one refcount rule shared by
// Import (a pack dropped clips) and Uninstall (a pack went away).
func collectBlobs(ctx context.Context, sqlDB *sql.DB, storeDir string, candidates map[blobKey]bool) error {
	for b := range candidates {
		var n int
		err := sqlDB.QueryRowContext(ctx, `SELECT COUNT(*) FROM audio_clips WHERE sha256 = ? AND ext = ?`, b.sha, b.ext).Scan(&n)
		if err != nil {
			return fmt.Errorf("check blob %s: %w", b.sha, err)
		}
		if n == 0 {
			if err := os.Remove(BlobPath(storeDir, b.sha, b.ext)); err != nil && !errors.Is(err, os.ErrNotExist) {
				return fmt.Errorf("remove blob %s: %w", b.sha, err)
			}
		}
	}
	return nil
}
