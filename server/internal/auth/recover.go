package auth

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// ErrRecoverDisabledAdmin refuses --admin on a disabled account without
// --enable: the account would be an administrator that cannot sign in.
var ErrRecoverDisabledAdmin = errors.New("account is disabled: --admin needs --enable")

// RecoverOptions describe `qinqin recover`.
type RecoverOptions struct {
	Username string
	Hash     string // argon2id digest of the new password, computed by the caller
	Enable   bool   // clear disabled_at
	Admin    bool   // grant the admin bit
	ResetMFA bool   // remove the authenticator, recovery codes and the email method
}

// RecoverAccount is the lockout recovery for an instance whose only admin
// lost the password: it sets the new password with a forced change (flag,
// watermark and EVERY session deleted, like ForcePasswordChange), and
// optionally re-enables and/or makes the user admin, all in one
// transaction with an audit row whose actor is "cli". Re-enabling cannot
// bring an old session back: they are all deleted here.
func RecoverAccount(ctx context.Context, sqlDB *sql.DB, o RecoverOptions) (int64, error) {
	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin recover: %w", err)
	}
	defer tx.Rollback()
	if o.Admin && !o.Enable {
		var off sql.NullString
		if err := tx.QueryRowContext(ctx, `SELECT disabled_at FROM users WHERE username = ?`, o.Username).Scan(&off); err == nil && off.Valid {
			return 0, ErrRecoverDisabledAdmin
		}
	}
	var id int64
	err = tx.QueryRowContext(ctx, `
		UPDATE users SET hash = ?1, must_change_password = 1, updated_at = ?2,
		       must_change_after = COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'sessions'), 0),
		       disabled_at = CASE WHEN ?3 THEN NULL ELSE disabled_at END,
		       admin = CASE WHEN ?4 THEN 1 ELSE admin END
		WHERE username = ?5 RETURNING id`, o.Hash, now(), o.Enable, o.Admin, o.Username).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrUserNotFound
	}
	if err != nil {
		return 0, fmt.Errorf("recover user: %w", err)
	}
	revoked, tokens, err := revokeCredentials(ctx, tx, id, 0)
	if err != nil {
		return 0, err
	}
	if err := dropPendingResets(ctx, tx, id); err != nil {
		return 0, err
	}
	if o.ResetMFA {
		// credentials and links are gone already (above): nothing more to count
		if _, _, err := ResetMFA(ctx, tx, id); err != nil {
			return 0, err
		}
		if err := Audit(ctx, tx, AuditEvent{Action: "mfa_reset", ActorName: "cli", TargetID: &id}); err != nil {
			return 0, err
		}
	}
	if err := Audit(ctx, tx, AuditEvent{Action: "password_change_forced", ActorName: "cli", TargetID: &id,
		Detail: map[string]any{"signedOutOthers": revoked, "tokens": tokens, "enabled": o.Enable, "admin": o.Admin}}); err != nil {
		return 0, err
	}
	return id, tx.Commit()
}
