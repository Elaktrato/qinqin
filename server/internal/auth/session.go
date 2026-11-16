package auth

import (
	"context"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"time"

	"qinqin/internal/model"
)

// SessionIdle is how long a session may go unused before it stops
// authenticating (and the janitor prunes it). There is no absolute limit.
const SessionIdle = 90 * 24 * time.Hour

// lastUsedEvery bounds how often a session's last_used_at is written, so
// reads do not become writes.
const lastUsedEvery = 5 * time.Minute

// Session levels.
const (
	LevelFull   = "full"
	LevelEnroll = "enroll"
)

// LoginOptions shape a new session. Level "" means full.
type LoginOptions struct {
	Device string
	Level  string
	// Gate, when set, runs after the password verified (and the account is
	// enabled) and decides what the sign-in becomes: a session of a given
	// level, or no session at all yet (Defer: a second step comes first, so
	// no session row exists before it is passed).
	Gate func(ctx context.Context, u model.User) (SessionPlan, error)
}

// SessionPlan is a Gate's decision.
type SessionPlan struct {
	Level string // "" full, or LevelEnroll
	Defer bool   // create no session
}

// SessionInfo is one row of the session list. No token, no hash.
type SessionInfo struct {
	ID         int64  `json:"id"`
	Device     string `json:"device"`
	CreatedAt  string `json:"createdAt"`
	LastUsedAt string `json:"lastUsedAt"`
	Current    bool   `json:"current"`
}

// NewSession stores a session for userID and returns its bearer token
// (64 hex characters, shown once; only its SHA-256 is stored).
func NewSession(ctx context.Context, sqlDB *sql.DB, userID int64, o LoginOptions) (string, error) {
	level := o.Level
	if level == "" {
		level = LevelFull
	}
	if level != LevelFull && level != LevelEnroll {
		return "", fmt.Errorf("new session: unknown level %q", level)
	}
	token := hex.EncodeToString(randomBytes(32))
	at := now()
	if _, err := sqlDB.ExecContext(ctx,
		`INSERT INTO sessions (token_hash, user_id, level, device, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?)`,
		hashToken(token), userID, level, CleanDevice(o.Device), at, at); err != nil {
		return "", fmt.Errorf("insert session: %w", err)
	}
	return token, nil
}

// Authenticate resolves the bearer token of r. nil, nil means the request
// is not authenticated (no token, unknown, idle too long, or the user is
// disabled); an error means the lookup failed.
func Authenticate(r *http.Request, sqlDB *sql.DB) (*Principal, error) {
	token := bearerToken(r)
	if token == "" {
		return nil, nil
	}
	at := nowFunc().UTC()
	var p Principal
	var admin, must int
	var email, verified sql.NullString
	var mustAfter sql.NullInt64
	err := sqlDB.QueryRowContext(r.Context(), `
		SELECT users.id, users.username, users.admin, users.email, users.email_verified_at,
		       users.must_change_password, users.must_change_after, users.created_at,
		       sessions.id, sessions.level
		FROM sessions JOIN users ON users.id = sessions.user_id
		WHERE sessions.token_hash = ? AND users.disabled_at IS NULL AND sessions.last_used_at > ?`,
		hashToken(token), at.Add(-SessionIdle).Format(time.RFC3339)).Scan(
		&p.User.ID, &p.User.Username, &admin, &email, &verified, &must, &mustAfter, &p.User.CreatedAt,
		&p.SessionID, &p.Level)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("lookup session: %w", err)
	}
	p.User.Admin = admin != 0
	p.User.MustChangePassword = must != 0
	p.User.EmailVerified = verified.Valid
	if email.Valid {
		p.User.Email = &email.String
	}
	p.TemporarySession = p.User.MustChangePassword && mustAfter.Valid && p.SessionID > mustAfter.Int64
	if _, err := sqlDB.ExecContext(r.Context(),
		`UPDATE sessions SET last_used_at = ? WHERE id = ? AND last_used_at < ?`,
		at.Format(time.RFC3339), p.SessionID, at.Add(-lastUsedEvery).Format(time.RFC3339)); err != nil {
		return nil, fmt.Errorf("touch session: %w", err)
	}
	return &p, nil
}

// RevokeSession deletes one session of userID; false when it does not
// exist or belongs to someone else.
func RevokeSession(ctx context.Context, sqlDB *sql.DB, userID, sessionID int64) (bool, error) {
	res, err := sqlDB.ExecContext(ctx, `DELETE FROM sessions WHERE id = ? AND user_id = ?`, sessionID, userID)
	if err != nil {
		return false, fmt.Errorf("revoke session: %w", err)
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// RevokeSessions deletes every session of userID except exceptSessionID
// (0 deletes them all) and returns how many went.
func RevokeSessions(ctx context.Context, sqlDB *sql.DB, userID, exceptSessionID int64) (int64, error) {
	return revokeSessions(ctx, sqlDB, userID, exceptSessionID)
}

type execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

func revokeSessions(ctx context.Context, ex execer, userID, exceptSessionID int64) (int64, error) {
	res, err := ex.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = ? AND id <> ?`, userID, exceptSessionID)
	if err != nil {
		return 0, fmt.Errorf("revoke sessions: %w", err)
	}
	n, _ := res.RowsAffected()
	return n, nil
}

// ListSessions returns the sessions of userID, most recently used first.
// A device label from before migration 032 (empty) reads "Unknown device".
// Current is left false; the caller marks its own session.
func ListSessions(ctx context.Context, sqlDB *sql.DB, userID int64) ([]SessionInfo, error) {
	rows, err := sqlDB.QueryContext(ctx,
		`SELECT id, device, created_at, last_used_at FROM sessions WHERE user_id = ? ORDER BY last_used_at DESC, id DESC`, userID)
	if err != nil {
		return nil, fmt.Errorf("list sessions: %w", err)
	}
	defer rows.Close()
	out := []SessionInfo{}
	for rows.Next() {
		var s SessionInfo
		if err := rows.Scan(&s.ID, &s.Device, &s.CreatedAt, &s.LastUsedAt); err != nil {
			return nil, fmt.Errorf("scan session: %w", err)
		}
		if s.Device == "" {
			s.Device = "Unknown device"
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// RevokeSessionAudited is RevokeSession plus its audit row in one
// transaction: either both happen or neither.
func RevokeSessionAudited(ctx context.Context, sqlDB *sql.DB, userID, sessionID int64) (bool, error) {
	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return false, fmt.Errorf("begin revoke: %w", err)
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx, `DELETE FROM sessions WHERE id = ? AND user_id = ?`, sessionID, userID)
	if err != nil {
		return false, fmt.Errorf("revoke session: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return false, nil
	}
	if err := Audit(ctx, tx, AuditEvent{Action: "sessions_revoked", ActorID: userID, TargetID: &userID,
		Detail: map[string]any{"scope": "one", "revoked": 1}}); err != nil {
		return false, err
	}
	return true, tx.Commit()
}

// RevokeOthersAudited deletes every session of userID except exceptSessionID
// (0: all) and writes the audit row (scope names the request: "others" or
// "all"), in one transaction.
func RevokeOthersAudited(ctx context.Context, sqlDB *sql.DB, userID, exceptSessionID int64, scope string) (int64, error) {
	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin revoke: %w", err)
	}
	defer tx.Rollback()
	n, err := revokeSessions(ctx, tx, userID, exceptSessionID)
	if err != nil {
		return 0, err
	}
	if err := dropPendingResets(ctx, tx, userID); err != nil {
		return 0, err
	}
	if err := Audit(ctx, tx, AuditEvent{Action: "sessions_revoked", ActorID: userID, TargetID: &userID,
		Detail: map[string]any{"scope": scope, "revoked": n}}); err != nil {
		return 0, err
	}
	return n, tx.Commit()
}

// PromoteSession turns an enrolment session into a full one (the user has
// just enrolled a second factor).
func PromoteSession(ctx context.Context, sqlDB *sql.DB, userID, sessionID int64) error {
	if _, err := sqlDB.ExecContext(ctx, `UPDATE sessions SET level = 'full' WHERE id = ? AND user_id = ?`, sessionID, userID); err != nil {
		return fmt.Errorf("promote session: %w", err)
	}
	return nil
}

// RevokeAllExcept deletes every session of every user except one (the
// acting administrator's current session) and audits it.
func RevokeAllExcept(ctx context.Context, sqlDB *sql.DB, actorID, exceptSessionID int64) (int64, error) {
	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin revoke all: %w", err)
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx, `DELETE FROM sessions WHERE id <> ?`, exceptSessionID)
	if err != nil {
		return 0, fmt.Errorf("revoke all sessions: %w", err)
	}
	n, _ := res.RowsAffected()
	if err := Audit(ctx, tx, AuditEvent{Action: "sessions_revoked", ActorID: actorID, Detail: map[string]any{"scope": "everyone", "count": n}}); err != nil {
		return 0, err
	}
	return n, tx.Commit()
}
