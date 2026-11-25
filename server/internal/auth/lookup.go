package auth

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
)

// CountUsers counts every user row, disabled ones included (zero means the
// instance has not been set up yet).
func CountUsers(ctx context.Context, q querier) (int, error) {
	var n int
	err := q.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&n)
	return n, err
}

// ActiveUserInfo is the name and administrator flag of an active user.
type ActiveUserInfo struct {
	Username string
	Admin    bool
}

// ActiveUser returns the name and admin flag of a user who is not
// disabled; ErrUserNotFound for a disabled or unknown user.
func ActiveUser(ctx context.Context, q querier, id int64) (ActiveUserInfo, error) {
	var u ActiveUserInfo
	err := q.QueryRowContext(ctx, `SELECT admin, username FROM users WHERE id = ? AND disabled_at IS NULL`, id).Scan(&u.Admin, &u.Username)
	if errors.Is(err, sql.ErrNoRows) {
		return ActiveUserInfo{}, ErrUserNotFound
	}
	return u, err
}

// Username returns the name of a user, disabled or not; ErrUserNotFound
// for an unknown id.
func Username(ctx context.Context, q querier, id int64) (string, error) {
	var name string
	err := q.QueryRowContext(ctx, `SELECT username FROM users WHERE id = ?`, id).Scan(&name)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrUserNotFound
	}
	return name, err
}

// Disabled reports whether a user is disabled; ErrUserNotFound for an
// unknown id.
func Disabled(ctx context.Context, q querier, id int64) (bool, error) {
	var disabled bool
	err := q.QueryRowContext(ctx, `SELECT disabled_at IS NOT NULL FROM users WHERE id = ?`, id).Scan(&disabled)
	if errors.Is(err, sql.ErrNoRows) {
		return false, ErrUserNotFound
	}
	return disabled, err
}

// AuditRecord is one stored audit event. A nil ActorID is a system action
// (ActorName says which); a nil TargetID has no target.
type AuditRecord struct {
	ID                    int64
	At, Action            string
	ActorID, TargetID     *int64
	ActorName, TargetName string
	Detail                json.RawMessage
}

// AuditLog is one page of the audit log, newest first. Next is the id to
// pass as before for the following page, nil at the end.
type AuditLog struct {
	Records []AuditRecord
	Next    *int64
}

// AuditPage returns up to limit audit events with an id below before (0:
// from the newest), newest first.
func AuditPage(ctx context.Context, sqlDB *sql.DB, before int64, limit int) (AuditLog, error) {
	if before <= 0 {
		before = 1<<62 - 1
	}
	rows, err := sqlDB.QueryContext(ctx, `
		SELECT id, at, action, actor_id, actor_name, target_id, target_name, detail
		FROM auth_audit WHERE id < ? ORDER BY id DESC LIMIT ?`, before, limit+1)
	if err != nil {
		return AuditLog{}, fmt.Errorf("read audit: %w", err)
	}
	defer rows.Close()
	log := AuditLog{Records: []AuditRecord{}}
	for rows.Next() {
		var e AuditRecord
		var actorID, targetID sql.NullInt64
		var detail string
		if err := rows.Scan(&e.ID, &e.At, &e.Action, &actorID, &e.ActorName, &targetID, &e.TargetName, &detail); err != nil {
			return AuditLog{}, fmt.Errorf("read audit: %w", err)
		}
		if actorID.Valid {
			e.ActorID = &actorID.Int64
		}
		if targetID.Valid {
			e.TargetID = &targetID.Int64
		}
		e.Detail = json.RawMessage(detail)
		log.Records = append(log.Records, e)
	}
	if err := rows.Err(); err != nil {
		return AuditLog{}, fmt.Errorf("read audit: %w", err)
	}
	if len(log.Records) > limit {
		log.Records = log.Records[:limit]
		next := log.Records[limit-1].ID
		log.Next = &next
	}
	return log, nil
}

// DisableTOTP removes the user's authenticator and recovery codes and
// writes the mfa_disabled audit row, in one transaction.
func DisableTOTP(ctx context.Context, sqlDB *sql.DB, userID int64) error {
	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := RemoveTOTP(ctx, tx, userID); err != nil {
		return err
	}
	if err := Audit(ctx, tx, AuditEvent{Action: "mfa_disabled", ActorID: userID, TargetID: &userID, Detail: map[string]any{"scope": "totp"}}); err != nil {
		return err
	}
	return tx.Commit()
}
