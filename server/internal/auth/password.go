package auth

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// VerifyUserPassword reports whether password is the user's current one.
// The caller runs it behind the hash gate; it never holds a transaction.
func VerifyUserPassword(ctx context.Context, sqlDB *sql.DB, userID int64, password string) (bool, error) {
	var hash string
	err := sqlDB.QueryRowContext(ctx, `SELECT hash FROM users WHERE id = ?`, userID).Scan(&hash)
	if errors.Is(err, sql.ErrNoRows) {
		verifyPassword(dummyHash(), password)
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("select hash: %w", err)
	}
	return verifyPassword(hash, password), nil
}

// ChangePassword stores newHash (computed by the caller, before any
// transaction: a write transaction never holds SQLite's lock across an
// argon2 run), clears a forced-change flag, and removes the user's other
// sessions when revokeOthers is set or a change was forced, all in one
// transaction with the audit row. keepSessionID is the session that stays.
func ChangePassword(ctx context.Context, sqlDB *sql.DB, userID int64, newHash string, keepSessionID int64, revokeOthers bool) error {
	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin change password: %w", err)
	}
	defer tx.Rollback()
	var forced int
	if err := tx.QueryRowContext(ctx, `SELECT must_change_password FROM users WHERE id = ?`, userID).Scan(&forced); err != nil {
		return fmt.Errorf("read user: %w", err)
	}
	at := now()
	if _, err := tx.ExecContext(ctx, `
		UPDATE users SET hash = ?, must_change_password = 0, must_change_set_at = NULL,
		       password_changed_at = ?, updated_at = ? WHERE id = ?`, newHash, at, at, userID); err != nil {
		return fmt.Errorf("update password: %w", err)
	}
	revoked := int64(0)
	if revokeOthers || forced != 0 {
		if revoked, err = revokeSessions(ctx, tx, userID, keepSessionID); err != nil {
			return err
		}
	}
	if err := Audit(ctx, tx, AuditEvent{Action: "password_changed", ActorID: userID, TargetID: &userID,
		Detail: map[string]any{"forced": forced != 0, "signedOutOthers": revoked}}); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit change password: %w", err)
	}
	return nil
}
