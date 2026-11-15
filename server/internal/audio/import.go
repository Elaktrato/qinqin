package audio

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"qinqin/internal/dict"
)

// ImportResult counts what an import stored. Skipped rows are term rows
// whose reading yields no match key (an unparsable pinyin reading).
type ImportResult struct{ Clips, Skipped int }

// Import loads an audio pack: its index.tsv is parsed and every clip file
// validated and hashed before anything is written; blobs are then copied
// into storeDir, the pack's rows replaced in one transaction, and blobs
// the pack no longer uses (and no other pack references) removed.
func Import(ctx context.Context, sqlDB *sql.DB, pack dict.Pack, storeDir string) (ImportResult, error) {
	m := pack.Manifest
	if err := m.Validate(); err != nil {
		return ImportResult{}, fmt.Errorf("%w: %v", dict.ErrInvalidPack, err)
	}
	if m.Type != dict.TypeAudio || m.Format != dict.FormatAudioIndex {
		return ImportResult{}, fmt.Errorf("%w: %q is not an audio-index audio pack", dict.ErrInvalidPack, m.ID)
	}
	f, err := os.Open(filepath.Join(pack.Dir, "index.tsv"))
	if err != nil {
		return ImportResult{}, fmt.Errorf("%w: open index of %s: %v", dict.ErrInvalidPack, m.ID, err)
	}
	rows, err := ParseIndex(f, m)
	f.Close()
	if err != nil {
		return ImportResult{}, fmt.Errorf("%w: %s: %v", dict.ErrInvalidPack, m.ID, err)
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
		if key == "" && r.Kind == KindTerm {
			res.Skipped++
			continue
		}
		if r.Kind == KindSyllable {
			key = r.Reading
		}
		cf, ok := seen[r.File]
		if !ok {
			ext := strings.TrimPrefix(path.Ext(r.File), ".")
			cf, err = inspect(filepath.Join(pack.Dir, filepath.FromSlash(r.File)), ext)
			if err != nil {
				return ImportResult{}, fmt.Errorf("%w: %s: index row %d: %s: %v", dict.ErrInvalidPack, m.ID, i+1, r.File, err)
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

	type blob struct{ sha, ext string }
	old := map[blob]bool{}
	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return ImportResult{}, fmt.Errorf("import audio %s: %w", m.ID, err)
	}
	defer tx.Rollback()
	stamp := time.Now().UTC().Format(time.RFC3339)
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO audio_packs (pack_id, language, name, version, license, attribution, notice, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (pack_id) DO UPDATE SET language = excluded.language, name = excluded.name,
			version = excluded.version, license = excluded.license, attribution = excluded.attribution,
			notice = excluded.notice, updated_at = excluded.updated_at, deleted_at = NULL`,
		m.ID, m.Language, m.Name, m.Version, m.License, m.Attribution, m.Notice, stamp, stamp); err != nil {
		return ImportResult{}, fmt.Errorf("import audio %s: %w", m.ID, err)
	}
	var packRow int64
	if err := tx.QueryRowContext(ctx, `SELECT id FROM audio_packs WHERE pack_id = ?`, m.ID).Scan(&packRow); err != nil {
		return ImportResult{}, fmt.Errorf("import audio %s: %w", m.ID, err)
	}
	cur, err := tx.QueryContext(ctx, `SELECT DISTINCT sha256, ext FROM audio_clips WHERE pack_id = ?`, packRow)
	if err != nil {
		return ImportResult{}, fmt.Errorf("import audio %s: %w", m.ID, err)
	}
	for cur.Next() {
		var b blob
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
	for b := range old {
		var n int
		err := sqlDB.QueryRowContext(ctx, `SELECT COUNT(*) FROM audio_clips WHERE sha256 = ? AND ext = ?`, b.sha, b.ext).Scan(&n)
		if err != nil {
			return res, fmt.Errorf("import audio %s: check blob %s: %w", m.ID, b.sha, err)
		}
		if n == 0 {
			if err := os.Remove(BlobPath(storeDir, b.sha, b.ext)); err != nil && !errors.Is(err, os.ErrNotExist) {
				return res, fmt.Errorf("import audio %s: remove blob %s: %w", m.ID, b.sha, err)
			}
		}
	}
	return res, nil
}
