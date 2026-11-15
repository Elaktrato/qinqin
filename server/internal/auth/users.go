package auth

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"qinqin/internal/model"
)

// Users owns every administrative change of the users table. Each guarded
// statement runs under mu (one process): the statement is the real
// guarantee for the last-admin rule, the mutex only removes SQLite busy
// retries between two admins acting at once.
type Users struct {
	DB *sql.DB
	mu sync.Mutex
}

// NewUsers returns the service for sqlDB. One per process.
func NewUsers(sqlDB *sql.DB) *Users { return &Users{DB: sqlDB} }

// WithUserLock runs fn while holding the users mutex, for flows (backup
// restore) that must not interleave with a user deletion. Take it BEFORE
// opening a transaction, never inside one.
func (u *Users) WithUserLock(fn func() error) error {
	u.mu.Lock()
	defer u.mu.Unlock()
	return fn()
}

// NewUser describes an account to insert. Hash is the argon2id digest the
// caller computed before opening any transaction.
type NewUser struct {
	Username      string
	Hash          string
	Email         *string // display form; nil for none
	EmailNorm     *string
	Admin         bool
	MustChange    bool // admin-created: the temporary password must be changed
	EmailVerified bool // an address an admin entered counts as verified
}

type execQuerier interface {
	execer
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// CreateUserWith inserts nu through ex (a *sql.Tx so the insert can share a
// transaction with an invite use) and returns the user. ErrUsernameTaken /
// ErrEmailTaken mark the collisions. A forced change records the
// session-id watermark in the insert, like ForcePasswordChange does for an
// existing user (a new user has no sessions to revoke).
func CreateUserWith(ctx context.Context, ex execer, nu NewUser) (model.User, error) {
	created := now()
	var verified any
	if nu.EmailVerified && nu.Email != nil {
		verified = created
	}
	var watermark any
	if nu.MustChange {
		watermark = int64(0)
	}
	res, err := ex.ExecContext(ctx, `
		INSERT INTO users (username, hash, admin, updated_at, created_at, username_key,
		                   email, email_norm, email_verified_at, must_change_password, must_change_after)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
		        CASE WHEN ? THEN COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'sessions'), 0) END)`,
		nu.Username, nu.Hash, nu.Admin, created, created, model.UsernameKey(nu.Username),
		nu.Email, nu.EmailNorm, verified, nu.MustChange, watermark != nil)
	if err != nil {
		if isUniqueViolation(err) {
			if strings.Contains(err.Error(), "email_norm") {
				return model.User{}, ErrEmailTaken
			}
			return model.User{}, ErrUsernameTaken
		}
		return model.User{}, fmt.Errorf("insert user %q: %w", nu.Username, err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return model.User{}, fmt.Errorf("insert user %q: last insert id: %w", nu.Username, err)
	}
	return model.User{ID: id, Username: nu.Username, Admin: nu.Admin, Email: nu.Email,
		EmailVerified: verified != nil, MustChangePassword: nu.MustChange, CreatedAt: created}, nil
}

// EmailTaken reports whether another user already has the address (norm is
// the lower-cased form), ignoring user exceptID (0: none).
func EmailTaken(ctx context.Context, ex execQuerier, norm string, exceptID int64) (bool, error) {
	var one int
	err := ex.QueryRowContext(ctx, `SELECT 1 FROM users WHERE email_norm = ? AND id <> ?`, norm, exceptID).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("check email: %w", err)
	}
	return true, nil
}

// Errors of the admin user operations.
var (
	ErrLastAdmin    = errors.New("last administrator")
	ErrUserNotFound = errors.New("user not found")
)

// AdminUser is a user as an administrator sees it.
type AdminUser struct {
	ID                 int64   `json:"id"`
	Username           string  `json:"username"`
	Email              *string `json:"email"`
	EmailVerified      bool    `json:"emailVerified"`
	Admin              bool    `json:"admin"`
	Disabled           bool    `json:"disabled"`
	MustChangePassword bool    `json:"mustChangePassword"`
	CreatedAt          string  `json:"createdAt"`
	LastSeenAt         *string `json:"lastSeenAt"`
}

const adminUserSelect = `
	SELECT u.id, u.username, u.email, u.email_verified_at, u.admin, u.disabled_at, u.must_change_password, u.created_at,
	       (SELECT MAX(s.last_used_at) FROM sessions s WHERE s.user_id = u.id)
	FROM users u`

type rowScanner interface{ Scan(dest ...any) error }

func scanAdminUser(r rowScanner) (AdminUser, error) {
	var a AdminUser
	var email, verified, disabled, seen sql.NullString
	var admin, must int
	if err := r.Scan(&a.ID, &a.Username, &email, &verified, &admin, &disabled, &must, &a.CreatedAt, &seen); err != nil {
		return AdminUser{}, err
	}
	a.Admin, a.MustChangePassword = admin != 0, must != 0
	a.Disabled, a.EmailVerified = disabled.Valid, verified.Valid
	if email.Valid {
		a.Email = &email.String
	}
	if seen.Valid {
		a.LastSeenAt = &seen.String
	}
	return a, nil
}

// ListUsers returns every user ordered by username. hideEmail blanks the
// stored addresses (the email policy is off).
func (u *Users) ListUsers(ctx context.Context, hideEmail bool) ([]AdminUser, error) {
	rows, err := u.DB.QueryContext(ctx, adminUserSelect+` ORDER BY u.username COLLATE NOCASE, u.id`)
	if err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}
	defer rows.Close()
	out := []AdminUser{}
	for rows.Next() {
		a, err := scanAdminUser(rows)
		if err != nil {
			return nil, fmt.Errorf("scan user: %w", err)
		}
		if hideEmail {
			a.Email, a.EmailVerified = nil, false
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// GetUser returns one user (ErrUserNotFound when there is none).
func (u *Users) GetUser(ctx context.Context, id int64, hideEmail bool) (AdminUser, error) {
	a, err := scanAdminUser(u.DB.QueryRowContext(ctx, adminUserSelect+` WHERE u.id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return AdminUser{}, ErrUserNotFound
	}
	if err != nil {
		return AdminUser{}, fmt.Errorf("get user: %w", err)
	}
	if hideEmail {
		a.Email, a.EmailVerified = nil, false
	}
	return a, nil
}

// Create inserts an admin-created user and audits it, in one transaction.
func (u *Users) Create(ctx context.Context, actorID int64, nu NewUser) (model.User, error) {
	u.mu.Lock()
	defer u.mu.Unlock()
	tx, err := u.DB.BeginTx(ctx, nil)
	if err != nil {
		return model.User{}, fmt.Errorf("begin create user: %w", err)
	}
	defer tx.Rollback()
	created, err := CreateUserWith(ctx, tx, nu)
	if err != nil {
		return model.User{}, err
	}
	if err := Audit(ctx, tx, AuditEvent{Action: "user_created", ActorID: actorID, TargetID: &created.ID,
		Detail: map[string]any{"forced": nu.MustChange}}); err != nil {
		return model.User{}, err
	}
	return created, tx.Commit()
}

// SetAdmin grants or removes the admin bit. Removing it is one guarded
// statement that refuses to leave the instance without an active admin
// (ErrLastAdmin); granting or removing nothing is a no-op.
func (u *Users) SetAdmin(ctx context.Context, actorID, id int64, admin bool) error {
	u.mu.Lock()
	defer u.mu.Unlock()
	tx, err := u.DB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin set admin: %w", err)
	}
	defer tx.Rollback()
	var res sql.Result
	if admin {
		res, err = tx.ExecContext(ctx, `UPDATE users SET admin = 1, updated_at = ?2 WHERE id = ?1 AND admin = 0`, id, now())
	} else {
		// A disabled admin is not counted as one, so removing their bit
		// never endangers the rule.
		res, err = tx.ExecContext(ctx, `
			UPDATE users SET admin = 0, updated_at = ?2 WHERE id = ?1 AND admin = 1
			AND (disabled_at IS NOT NULL OR EXISTS (SELECT 1 FROM users WHERE id <> ?1 AND admin = 1 AND disabled_at IS NULL))`, id, now())
	}
	if err != nil {
		return fmt.Errorf("set admin: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		var isAdmin int
		switch err := tx.QueryRowContext(ctx, `SELECT admin FROM users WHERE id = ?`, id).Scan(&isAdmin); {
		case errors.Is(err, sql.ErrNoRows):
			return ErrUserNotFound
		case err != nil:
			return fmt.Errorf("read admin: %w", err)
		case !admin && isAdmin != 0:
			return ErrLastAdmin
		}
		return nil // already in the requested state
	}
	action := "admin_revoked"
	if admin {
		action = "admin_granted"
	}
	if err := Audit(ctx, tx, AuditEvent{Action: action, ActorID: actorID, TargetID: &id}); err != nil {
		return err
	}
	return tx.Commit()
}

// SetDisabled disables or re-enables an account. Disabling deletes ALL the
// user's sessions in the same transaction as disabled_at (a disabled user
// never authenticates, and a re-enabled one starts with no session, so an
// old token can never come back). Disabling the last active admin is
// refused with ErrLastAdmin by the guarded statement.
func (u *Users) SetDisabled(ctx context.Context, actorID, id int64, disabled bool) error {
	u.mu.Lock()
	defer u.mu.Unlock()
	tx, err := u.DB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin set disabled: %w", err)
	}
	defer tx.Rollback()
	var res sql.Result
	if disabled {
		res, err = tx.ExecContext(ctx, `
			UPDATE users SET disabled_at = ?2, updated_at = ?2 WHERE id = ?1 AND disabled_at IS NULL
			AND (admin = 0 OR EXISTS (SELECT 1 FROM users WHERE id <> ?1 AND admin = 1 AND disabled_at IS NULL))`, id, now())
	} else {
		res, err = tx.ExecContext(ctx, `UPDATE users SET disabled_at = NULL, updated_at = ?2 WHERE id = ?1 AND disabled_at IS NOT NULL`, id, now())
	}
	if err != nil {
		return fmt.Errorf("set disabled: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		var off sql.NullString
		switch err := tx.QueryRowContext(ctx, `SELECT disabled_at FROM users WHERE id = ?`, id).Scan(&off); {
		case errors.Is(err, sql.ErrNoRows):
			return ErrUserNotFound
		case err != nil:
			return fmt.Errorf("read disabled: %w", err)
		case disabled && !off.Valid:
			return ErrLastAdmin
		}
		return nil
	}
	revoked, err := revokeSessions(ctx, tx, id, 0)
	if err != nil {
		return err
	}
	action := "user_enabled"
	if disabled {
		action = "user_disabled"
	}
	if err := Audit(ctx, tx, AuditEvent{Action: action, ActorID: actorID, TargetID: &id, Detail: map[string]any{"revoked": revoked}}); err != nil {
		return err
	}
	return tx.Commit()
}

// SetEmail stores an address an administrator entered (verified) or clears
// it (norm nil). ErrEmailTaken when another account has it.
func (u *Users) SetEmail(ctx context.Context, actorID, id int64, email, norm *string) error {
	u.mu.Lock()
	defer u.mu.Unlock()
	tx, err := u.DB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin set email: %w", err)
	}
	defer tx.Rollback()
	var verified any
	if email != nil {
		verified = now()
	}
	res, err := tx.ExecContext(ctx, `
		UPDATE users SET email = ?, email_norm = ?, email_verified_at = ?, updated_at = ? WHERE id = ?`,
		email, norm, verified, now(), id)
	if err != nil {
		if isUniqueViolation(err) {
			return ErrEmailTaken
		}
		return fmt.Errorf("set email: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrUserNotFound
	}
	if err := Audit(ctx, tx, AuditEvent{Action: "settings_changed", ActorID: actorID, TargetID: &id,
		Detail: map[string]any{"field": "email", "to": email != nil}}); err != nil {
		return err
	}
	return tx.Commit()
}

// ForcePasswordChange forces a new password at the next sign-in
// (flag, watermark, every session deleted, one transaction).
func (u *Users) ForcePasswordChange(ctx context.Context, actorID, id int64) error {
	u.mu.Lock()
	defer u.mu.Unlock()
	err := ForcePasswordChange(ctx, u.DB, id, actorID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrUserNotFound
	}
	return err
}

// RevokeAllSessions signs the user out everywhere, audited with the
// administrator as the actor.
func (u *Users) RevokeAllSessions(ctx context.Context, actorID, id int64) (int64, error) {
	u.mu.Lock()
	defer u.mu.Unlock()
	tx, err := u.DB.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin revoke: %w", err)
	}
	defer tx.Rollback()
	var exists int
	if err := tx.QueryRowContext(ctx, `SELECT 1 FROM users WHERE id = ?`, id).Scan(&exists); errors.Is(err, sql.ErrNoRows) {
		return 0, ErrUserNotFound
	} else if err != nil {
		return 0, fmt.Errorf("read user: %w", err)
	}
	n, err := revokeSessions(ctx, tx, id, 0)
	if err != nil {
		return 0, err
	}
	if err := Audit(ctx, tx, AuditEvent{Action: "sessions_revoked", ActorID: actorID, TargetID: &id,
		Detail: map[string]any{"scope": "all", "revoked": n}}); err != nil {
		return 0, err
	}
	return n, tx.Commit()
}

// IssueReset issues an admin reset link (see IssueReset), under the users
// mutex like every administrative change.
func (u *Users) IssueReset(ctx context.Context, actorID, id int64, ttl time.Duration) (string, time.Time, error) {
	u.mu.Lock()
	defer u.mu.Unlock()
	return IssueReset(ctx, u.DB, actorID, id, ttl)
}
