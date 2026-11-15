package auth

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"sync"

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
