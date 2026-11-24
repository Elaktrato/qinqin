package audio

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"qinqin/internal/pack"
)

// ErrPackNotFound reports an uninstall of a pack that is not installed.
var ErrPackNotFound = pack.NotFound("audio pack not installed")

// UninstallResult counts what an uninstall removed.
type UninstallResult struct{ Clips int }

// Uninstall removes an installed audio pack: its clip rows are deleted and the
// pack row is soft-deleted (a later import revives it), then every blob the
// pack used that no remaining clip row references is removed from storeDir.
// A blob another pack shares stays. An unknown or already removed pack is
// ErrPackNotFound.
func Uninstall(ctx context.Context, sqlDB *sql.DB, packID, storeDir string) (UninstallResult, error) {
	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return UninstallResult{}, fmt.Errorf("uninstall audio %s: %w", packID, err)
	}
	defer tx.Rollback()
	var row int64
	err = tx.QueryRowContext(ctx, `SELECT id FROM audio_packs WHERE pack_id = ? AND deleted_at IS NULL`, packID).Scan(&row)
	if errors.Is(err, sql.ErrNoRows) {
		return UninstallResult{}, fmt.Errorf("%w: %s", ErrPackNotFound, packID)
	}
	if err != nil {
		return UninstallResult{}, fmt.Errorf("uninstall audio %s: %w", packID, err)
	}
	used := map[blobKey]bool{}
	cur, err := tx.QueryContext(ctx, `SELECT sha256, ext FROM audio_clips WHERE pack_id = ?`, row)
	if err != nil {
		return UninstallResult{}, fmt.Errorf("uninstall audio %s: %w", packID, err)
	}
	var res UninstallResult
	for cur.Next() {
		var b blobKey
		if err := cur.Scan(&b.sha, &b.ext); err != nil {
			cur.Close()
			return UninstallResult{}, fmt.Errorf("uninstall audio %s: %w", packID, err)
		}
		used[b] = true
		res.Clips++
	}
	err = cur.Err()
	cur.Close()
	if err != nil {
		return UninstallResult{}, fmt.Errorf("uninstall audio %s: %w", packID, err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM audio_clips WHERE pack_id = ?`, row); err != nil {
		return UninstallResult{}, fmt.Errorf("uninstall audio %s: %w", packID, err)
	}
	stamp := time.Now().UTC().Format(time.RFC3339)
	if _, err := tx.ExecContext(ctx, `UPDATE audio_packs SET deleted_at = ?, updated_at = ? WHERE id = ?`, stamp, stamp, row); err != nil {
		return UninstallResult{}, fmt.Errorf("uninstall audio %s: %w", packID, err)
	}
	if err := tx.Commit(); err != nil {
		return UninstallResult{}, fmt.Errorf("uninstall audio %s: %w", packID, err)
	}
	if err := collectBlobs(ctx, sqlDB, storeDir, used); err != nil {
		return res, fmt.Errorf("uninstall audio %s: %w", packID, err)
	}
	return res, nil
}
