package auth

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"qinqin/internal/model"
)

// ErrTokenInvalid is the one answer for an unknown, expired, used or
// disabled-user reset token.
var ErrTokenInvalid = errors.New("token invalid")

// ErrResetInput marks an out-of-range reset parameter.
var ErrResetInput = errors.New("invalid reset")

// Reset link lifetimes: an administrator hands a link over by chat, so the
// default is a day; mail links (plan 3) live an hour.
const (
	DefaultResetTTL = 24 * time.Hour
	MaxResetTTL     = 168 * time.Hour
)

// IssueReset creates a reset link for userID and deletes the user's earlier
// unused ones (one live link per user). It touches neither the password nor
// the sessions: that happens when the link is used. createdBy 0: not an
// administrator (a mailed request, plan 3). Only the token's SHA-256 is
// stored; the token is returned once.
func IssueReset(ctx context.Context, sqlDB *sql.DB, createdBy, userID int64, ttl time.Duration) (token string, expires time.Time, err error) {
	return issueReset(ctx, sqlDB, createdBy, userID, ttl, false)
}

// IssueSelfServiceReset is the link of the "forgot password" mail: it replaces
// only earlier self-service links, never one an administrator issued (an
// anonymous request must not revoke an admin's link).
func IssueSelfServiceReset(ctx context.Context, sqlDB *sql.DB, userID int64, ttl time.Duration) (string, time.Time, error) {
	return issueReset(ctx, sqlDB, 0, userID, ttl, true)
}

func issueReset(ctx context.Context, sqlDB *sql.DB, createdBy, userID int64, ttl time.Duration, selfService bool) (token string, expires time.Time, err error) {
	if ttl < time.Hour || ttl > MaxResetTTL {
		return "", time.Time{}, fmt.Errorf("%w: lifetime must be between 1 and 168 hours", ErrResetInput)
	}
	token = newToken()
	expires = nowFunc().UTC().Add(ttl).Truncate(time.Second)
	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("begin issue reset: %w", err)
	}
	defer tx.Rollback()
	// A write first: one live link per user, whoever races.
	if _, err := tx.ExecContext(ctx, `DELETE FROM password_resets WHERE user_id = ?1 AND used_at IS NULL AND (?2 = 0 OR self_service = 1)`, userID, selfService); err != nil {
		return "", time.Time{}, fmt.Errorf("drop old resets: %w", err)
	}
	var exists int
	if err := tx.QueryRowContext(ctx, `SELECT 1 FROM users WHERE id = ?`, userID).Scan(&exists); errors.Is(err, sql.ErrNoRows) {
		return "", time.Time{}, ErrUserNotFound
	} else if err != nil {
		return "", time.Time{}, fmt.Errorf("read user: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO password_resets (token_hash, user_id, created_by, created_at, expires_at, self_service) VALUES (?, ?, ?, ?, ?, ?)`,
		hashToken(token), userID, nullID(createdBy), now(), expires.Format(time.RFC3339), selfService); err != nil {
		return "", time.Time{}, fmt.Errorf("insert reset: %w", err)
	}
	if err := Audit(ctx, tx, AuditEvent{Action: "reset_link_issued", ActorID: createdBy, TargetID: &userID}); err != nil {
		return "", time.Time{}, err
	}
	if err := tx.Commit(); err != nil {
		return "", time.Time{}, fmt.Errorf("commit reset: %w", err)
	}
	return token, expires, nil
}

// CheckReset returns the username and expiry behind a usable token
// (ErrTokenInvalid for every other case, a disabled account included).
func CheckReset(ctx context.Context, sqlDB *sql.DB, token string) (username, expiresAt string, err error) {
	err = sqlDB.QueryRowContext(ctx, `
		SELECT u.username, r.expires_at FROM password_resets r JOIN users u ON u.id = r.user_id
		WHERE r.token_hash = ? AND r.used_at IS NULL AND r.expires_at > ? AND u.disabled_at IS NULL`,
		hashToken(token), now()).Scan(&username, &expiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", ErrTokenInvalid
	}
	if err != nil {
		return "", "", fmt.Errorf("check reset: %w", err)
	}
	return username, expiresAt, nil
}

// UseReset spends the token and sets the password digest newHash (computed
// by the caller before this call, behind the hash gate) in ONE transaction:
// the guarded UPDATE of the token is the first statement, so two uses race
// to one winner; the password is replaced, a forced change is cleared, and
// every session of the user is deleted. It returns the user.
func UseReset(ctx context.Context, sqlDB *sql.DB, token, newHash string) (model.User, error) {
	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return model.User{}, fmt.Errorf("begin use reset: %w", err)
	}
	defer tx.Rollback()
	var userID int64
	err = tx.QueryRowContext(ctx, `
		UPDATE password_resets SET used_at = ?1 WHERE token_hash = ?2 AND used_at IS NULL AND expires_at > ?1
		AND user_id IN (SELECT id FROM users WHERE disabled_at IS NULL) RETURNING user_id`, now(), hashToken(token)).Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		return model.User{}, ErrTokenInvalid
	}
	if err != nil {
		return model.User{}, fmt.Errorf("spend reset: %w", err)
	}
	at := now()
	if _, err := tx.ExecContext(ctx, `
		UPDATE users SET hash = ?, must_change_password = 0, must_change_after = NULL, password_changed_at = ?, updated_at = ?
		WHERE id = ?`, newHash, at, at, userID); err != nil {
		return model.User{}, fmt.Errorf("set password: %w", err)
	}
	revoked, tokens, err := revokeCredentials(ctx, tx, userID, 0)
	if err != nil {
		return model.User{}, err
	}
	if err := dropPendingResets(ctx, tx, userID); err != nil {
		return model.User{}, err
	}
	if err := Audit(ctx, tx, AuditEvent{Action: "password_reset", ActorID: userID, TargetID: &userID,
		Detail: map[string]any{"signedOutOthers": revoked, "tokens": tokens}}); err != nil {
		return model.User{}, err
	}
	u, err := LoadUser(ctx, tx, userID)
	if err != nil {
		return model.User{}, err
	}
	if err := tx.Commit(); err != nil {
		return model.User{}, fmt.Errorf("commit reset: %w", err)
	}
	return u, nil
}

// LoadUser reads the user object of id (ErrUserNotFound when absent).
func LoadUser(ctx context.Context, ex querier, id int64) (model.User, error) {
	var u model.User
	var admin, must int
	var email, verified sql.NullString
	err := ex.QueryRowContext(ctx, `
		SELECT id, username, admin, email, email_verified_at, must_change_password, created_at FROM users WHERE id = ?`, id).
		Scan(&u.ID, &u.Username, &admin, &email, &verified, &must, &u.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return model.User{}, ErrUserNotFound
	}
	if err != nil {
		return model.User{}, fmt.Errorf("load user: %w", err)
	}
	u.Admin, u.MustChangePassword, u.EmailVerified = admin != 0, must != 0, verified.Valid
	if email.Valid {
		u.Email = &email.String
	}
	return u, nil
}

// dropPendingResets deletes the user's unused reset links. Every action
// that contains an account runs it in the same transaction: a link issued
// before the containment (by an attacker with admin access, or one that
// leaked) must not open the account again afterwards.
func dropPendingResets(ctx context.Context, ex execer, userID int64) error {
	if _, err := ex.ExecContext(ctx, `DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL`, userID); err != nil {
		return fmt.Errorf("drop pending resets: %w", err)
	}
	return nil
}

// DropPendingResets deletes the user's unused reset links (containment after
// a change of the recovery address).
func DropPendingResets(ctx context.Context, sqlDB *sql.DB, userID int64) error {
	return dropPendingResets(ctx, sqlDB, userID)
}
