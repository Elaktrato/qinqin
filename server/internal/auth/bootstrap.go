package auth

import (
	"context"
	"database/sql"
	"fmt"

	"qinqin/internal/model"
)

// BootstrapAdmin creates the instance's first admin from deployment
// configuration, with a forced password change: the flag and the
// session-id watermark are set exactly as ForcePasswordChange sets them
// (no session exists yet, so the first sign-in is already the temporary
// one). Like CreateFirstUser it acts only while the users table is empty,
// the check and the insert being one statement in one transaction with the
// audit row; a non-empty table yields ErrNotFirst and writes nothing.
func BootstrapAdmin(ctx context.Context, sqlDB *sql.DB, username, password string) (model.User, error) {
	hash := Hash(password) // before the transaction: no lock across an argon2 run
	created := now()
	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return model.User{}, fmt.Errorf("begin bootstrap admin: %w", err)
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx, `
		INSERT INTO users (username, hash, admin, updated_at, created_at, username_key,
		                   must_change_password, must_change_after)
		SELECT ?, ?, 1, ?, ?, ?, 1, COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'sessions'), 0)
		WHERE NOT EXISTS (SELECT 1 FROM users)`,
		username, hash, created, created, model.UsernameKey(username))
	if err != nil {
		return model.User{}, fmt.Errorf("insert bootstrap admin %q: %w", username, err)
	}
	if n, err := res.RowsAffected(); err != nil {
		return model.User{}, fmt.Errorf("insert bootstrap admin %q: rows affected: %w", username, err)
	} else if n == 0 {
		return model.User{}, ErrNotFirst
	}
	id, err := res.LastInsertId()
	if err != nil {
		return model.User{}, fmt.Errorf("insert bootstrap admin %q: last insert id: %w", username, err)
	}
	if err := Audit(ctx, tx, AuditEvent{Action: "bootstrap_admin_created", ActorName: "bootstrap", TargetID: &id,
		Detail: map[string]any{"admin": true, "forced": true}}); err != nil {
		return model.User{}, err
	}
	if err := tx.Commit(); err != nil {
		return model.User{}, fmt.Errorf("commit bootstrap admin: %w", err)
	}
	return model.User{ID: id, Username: username, Admin: true, MustChangePassword: true, CreatedAt: created}, nil
}
