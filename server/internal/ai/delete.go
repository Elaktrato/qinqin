package ai

import (
	"context"
	"database/sql"
)

// DeleteUserKey removes the user's key for a provider and clears a
// selection on that provider (never moved to another one), in one
// transaction. It works straight on the tables: deleting needs no usable
// secret and works for a provider that no longer exists. Deleting nothing
// is fine.
func DeleteUserKey(ctx context.Context, sqlDB *sql.DB, userID int64, provider string) error {
	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, q := range []string{
		`DELETE FROM ai_keys WHERE user_id = ? AND provider = ?`,
		`DELETE FROM ai_selection WHERE user_id = ? AND provider = ?`,
	} {
		if _, err := tx.ExecContext(ctx, q, userID, provider); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// DeleteCustomProvider removes a custom endpoint with every user's key for
// it and every selection on it, in one transaction; ErrUnknownProvider
// when there is no such endpoint.
func DeleteCustomProvider(ctx context.Context, sqlDB *sql.DB, id string) error {
	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx, `DELETE FROM ai_custom_providers WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrUnknownProvider
	}
	for _, q := range []string{`DELETE FROM ai_keys WHERE provider = ?`, `DELETE FROM ai_selection WHERE provider = ?`} {
		if _, err := tx.ExecContext(ctx, q, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}
