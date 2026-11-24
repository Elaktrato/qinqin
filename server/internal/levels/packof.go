package levels

import (
	"context"
	"database/sql"
	"errors"
)

// PackOf returns the pack id and language of the schemes row id, installed
// or not, or two empty strings when there is no such row.
func PackOf(ctx context.Context, sqlDB *sql.DB, id int64) (packID, language string, err error) {
	err = sqlDB.QueryRowContext(ctx, `SELECT pack_id, language FROM schemes WHERE id = ?`, id).Scan(&packID, &language)
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", nil
	}
	return packID, language, err
}
