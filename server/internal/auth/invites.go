package auth

import (
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"time"
	"unicode/utf8"

	"qinqin/internal/model"
)

// ErrInviteInvalid is the one answer for an unknown, expired, used up or
// revoked invite: the caller must not be able to tell them apart.
var ErrInviteInvalid = errors.New("invite invalid")

// ErrInviteInput marks an out-of-range invite parameter.
var ErrInviteInput = errors.New("invalid invite")

// MaxInviteNoteRunes caps the admin's label of an invite.
const MaxInviteNoteRunes = 100

// Invite is one invite as an admin sees it. The token is never part of it.
type Invite struct {
	ID        int64   `json:"id"`
	Note      string  `json:"note"`
	MaxUses   int     `json:"maxUses"`
	Uses      int     `json:"uses"`
	ExpiresAt *string `json:"expiresAt"`
	CreatedAt string  `json:"createdAt"`
	CreatedBy NameRef `json:"createdBy"`
	State     string  `json:"state"`
}

// NameRef is an id with the name at the time of reading.
type NameRef struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

// newToken is 32 random bytes as 43 base64url characters (URL-safe, usable
// in a link fragment).
func newToken() string {
	return base64.RawURLEncoding.EncodeToString(randomBytes(32))
}

// CreateInvite stores an invite and returns it with its token, which is
// shown once (only its SHA-256 is stored). expiresInDays nil: no expiry.
func CreateInvite(ctx context.Context, sqlDB *sql.DB, actorID int64, maxUses int, expiresInDays *int, note string) (Invite, string, error) {
	if maxUses < 1 || maxUses > 100 {
		return Invite{}, "", fmt.Errorf("%w: uses must be between 1 and 100", ErrInviteInput)
	}
	if expiresInDays != nil && (*expiresInDays < 1 || *expiresInDays > 90) {
		return Invite{}, "", fmt.Errorf("%w: expiry must be between 1 and 90 days", ErrInviteInput)
	}
	if utf8.RuneCountInString(note) > MaxInviteNoteRunes {
		return Invite{}, "", fmt.Errorf("%w: the note is limited to %d characters", ErrInviteInput, MaxInviteNoteRunes)
	}
	token := newToken()
	created := now()
	var expires any
	if expiresInDays != nil {
		expires = nowFunc().UTC().Add(time.Duration(*expiresInDays) * 24 * time.Hour).Format(time.RFC3339)
	}
	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return Invite{}, "", fmt.Errorf("begin invite: %w", err)
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx, `
		INSERT INTO invites (token_hash, note, max_uses, expires_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		hashToken(token), note, maxUses, expires, actorID, created)
	if err != nil {
		return Invite{}, "", fmt.Errorf("insert invite: %w", err)
	}
	id, _ := res.LastInsertId()
	if err := Audit(ctx, tx, AuditEvent{Action: "invite_created", ActorID: actorID, Detail: map[string]any{"maxUses": maxUses}}); err != nil {
		return Invite{}, "", err
	}
	if err := tx.Commit(); err != nil {
		return Invite{}, "", fmt.Errorf("commit invite: %w", err)
	}
	inv := Invite{ID: id, Note: note, MaxUses: maxUses, CreatedAt: created, State: "active"}
	if s, ok := expires.(string); ok {
		inv.ExpiresAt = &s
	}
	var name string
	sqlDB.QueryRowContext(ctx, `SELECT username FROM users WHERE id = ?`, actorID).Scan(&name)
	inv.CreatedBy = NameRef{ID: actorID, Name: name}
	return inv, token, nil
}

// ListInvites returns every invite, newest first, with its state. The
// state is "inactive" for an otherwise active invite while registration is
// closed.
func ListInvites(ctx context.Context, sqlDB *sql.DB, registration string) ([]Invite, error) {
	rows, err := sqlDB.QueryContext(ctx, `
		SELECT i.id, i.note, i.max_uses, i.uses, i.expires_at, i.created_at, i.created_by,
		       COALESCE(u.username, ''), i.revoked_at
		FROM invites i LEFT JOIN users u ON u.id = i.created_by ORDER BY i.id DESC`)
	if err != nil {
		return nil, fmt.Errorf("list invites: %w", err)
	}
	defer rows.Close()
	out := []Invite{}
	at := now()
	for rows.Next() {
		var inv Invite
		var expires, revoked sql.NullString
		if err := rows.Scan(&inv.ID, &inv.Note, &inv.MaxUses, &inv.Uses, &expires, &inv.CreatedAt,
			&inv.CreatedBy.ID, &inv.CreatedBy.Name, &revoked); err != nil {
			return nil, fmt.Errorf("scan invite: %w", err)
		}
		if expires.Valid {
			inv.ExpiresAt = &expires.String
		}
		switch {
		case revoked.Valid:
			inv.State = "revoked"
		case inv.Uses >= inv.MaxUses:
			inv.State = "used_up"
		case expires.Valid && expires.String <= at:
			inv.State = "expired"
		case registration == "closed":
			inv.State = "inactive"
		default:
			inv.State = "active"
		}
		out = append(out, inv)
	}
	return out, rows.Err()
}

// RevokeInvite sets revoked_at (false: no such invite or already revoked).
func RevokeInvite(ctx context.Context, sqlDB *sql.DB, actorID, id int64) (bool, error) {
	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return false, fmt.Errorf("begin revoke invite: %w", err)
	}
	defer tx.Rollback()
	var uses int
	err = tx.QueryRowContext(ctx, `
		UPDATE invites SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL RETURNING uses`, now(), id).Scan(&uses)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("revoke invite: %w", err)
	}
	if err := Audit(ctx, tx, AuditEvent{Action: "invite_revoked", ActorID: actorID, Detail: map[string]any{"uses": uses}}); err != nil {
		return false, err
	}
	return true, tx.Commit()
}

// CheckInvite reports whether token is a usable invite and when it
// expires; ErrInviteInvalid for every kind of bad token. It does not spend
// a use.
func CheckInvite(ctx context.Context, sqlDB *sql.DB, token string) (expiresAt *string, err error) {
	var expires sql.NullString
	err = sqlDB.QueryRowContext(ctx, `
		SELECT expires_at FROM invites WHERE token_hash = ? AND uses < max_uses AND revoked_at IS NULL
		AND (expires_at IS NULL OR expires_at > ?)`, hashToken(token), now()).Scan(&expires)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrInviteInvalid
	}
	if err != nil {
		return nil, fmt.Errorf("check invite: %w", err)
	}
	if expires.Valid {
		return &expires.String, nil
	}
	return nil, nil
}

// RegisterWithInvite spends one use of the invite and inserts the user in
// ONE transaction. The guarded UPDATE is the first statement; a username
// or email clash rolls the use back.
func RegisterWithInvite(ctx context.Context, sqlDB *sql.DB, token string, nu NewUser) (model.User, error) {
	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return model.User{}, fmt.Errorf("begin invite registration: %w", err)
	}
	defer tx.Rollback()
	var uses int
	err = tx.QueryRowContext(ctx, `
		UPDATE invites SET uses = uses + 1 WHERE token_hash = ? AND uses < max_uses AND revoked_at IS NULL
		AND (expires_at IS NULL OR expires_at > ?) RETURNING uses`, hashToken(token), now()).Scan(&uses)
	if errors.Is(err, sql.ErrNoRows) {
		return model.User{}, ErrInviteInvalid
	}
	if err != nil {
		return model.User{}, fmt.Errorf("spend invite: %w", err)
	}
	u, err := CreateUserWith(ctx, tx, nu)
	if err != nil {
		return model.User{}, err
	}
	if err := Audit(ctx, tx, AuditEvent{Action: "invite_used", ActorID: u.ID, TargetID: &u.ID, Detail: map[string]any{"uses": uses}}); err != nil {
		return model.User{}, err
	}
	if err := tx.Commit(); err != nil {
		return model.User{}, fmt.Errorf("commit invite registration: %w", err)
	}
	return u, nil
}
