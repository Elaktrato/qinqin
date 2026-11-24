package fonts

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"qinqin/internal/pack"
)

// Uninstall removes an installed font pack: its slice rows are deleted and
// the pack row is soft-deleted (a later import revives it), then every
// slice file the pack used that no remaining row references is removed
// from storeDir. An unknown or already removed pack is ErrNotFound.
func Uninstall(ctx context.Context, sqlDB *sql.DB, packID, storeDir string) error {
	tx, err := pack.BeginWrite(ctx, sqlDB)
	if err != nil {
		return fmt.Errorf("uninstall font pack %s: %w", packID, err)
	}
	defer tx.Rollback()
	var one int
	err = tx.QueryRowContext(ctx, `SELECT 1 FROM font_packs WHERE pack_id = ? AND deleted_at IS NULL`, packID).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("%w: %s", ErrNotFound, packID)
	}
	if err != nil {
		return fmt.Errorf("uninstall font pack %s: %w", packID, err)
	}
	used, err := packShas(ctx, tx, packID)
	if err != nil {
		return fmt.Errorf("uninstall font pack %s: %w", packID, err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM font_slices WHERE pack_id = ?`, packID); err != nil {
		return fmt.Errorf("uninstall font pack %s: %w", packID, err)
	}
	stamp := pack.Now()
	if _, err := tx.ExecContext(ctx, `UPDATE font_packs SET deleted_at = ?, updated_at = ? WHERE pack_id = ?`, stamp, stamp, packID); err != nil {
		return fmt.Errorf("uninstall font pack %s: %w", packID, err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("uninstall font pack %s: %w", packID, err)
	}
	if err := collectBlobs(ctx, sqlDB, storeDir, used); err != nil {
		return fmt.Errorf("uninstall font pack %s: %w", packID, err)
	}
	return nil
}
