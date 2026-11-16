package auth

import (
	"context"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// Personal access tokens (docs/contracts/auth/tokens-format.json): the
// prefix and 64 lowercase hex characters (32 random bytes). Only
// hashToken(token) and the hint are stored; the token itself exists in the
// create answer and nowhere else.
const (
	TokenPrefix  = "qq_pat_"
	tokenHexLen  = 64
	tokenHintLen = 6

	// MaxTokens is how many live (unexpired) tokens one user may hold.
	MaxTokens = 20
	// TokenExpiredKeep is how long an expired token stays listed (as
	// expired) before the janitor deletes it.
	TokenExpiredKeep = 30 * 24 * time.Hour
	// MaxTokenDays bounds expiresInDays; there are no never-expiring tokens.
	MaxTokenDays = 365

	maxTokenNameRunes = 64
)

// Token scopes. There is no admin scope.
const (
	ScopeRead  = "read"
	ScopeWrite = "write"
)

var (
	ErrTokenLimit        = errors.New("access token limit reached")
	ErrTokenRequest      = errors.New("invalid access token request")
	ErrTokenNotFound     = errors.New("access token not found")
	ErrWorkspaceNotFound = errors.New("workspace not found")
)

// TokenRequestError is an ErrTokenRequest naming the field and saying what
// is wrong in a sentence the API passes on.
type TokenRequestError struct{ Field, Message string }

func (e *TokenRequestError) Error() string { return "invalid access token request: " + e.Field }
func (e *TokenRequestError) Unwrap() error { return ErrTokenRequest }

// TokenRequest is what a user asks for. WorkspaceID nil: all workspaces.
type TokenRequest struct {
	Name          string
	Scope         string
	WorkspaceID   *int64
	ExpiresInDays int
}

// TokenInfo is one row of the token list. Never the token, never the hash.
type TokenInfo struct {
	ID          int64   `json:"id"`
	Name        string  `json:"name"`
	Hint        string  `json:"hint"`
	Scope       string  `json:"scope"`
	WorkspaceID *int64  `json:"workspaceId"`
	CreatedAt   string  `json:"createdAt"`
	ExpiresAt   string  `json:"expiresAt"`
	LastUsedAt  *string `json:"lastUsedAt"`
	Expired     bool    `json:"expired"`
}

// maxLiveTokens is MaxTokens; a test raises it to mint many tokens.
var maxLiveTokens = MaxTokens

// IsTokenShaped reports whether s is exactly an access token string. It
// looks at the shape only, never at a stored value.
func IsTokenShaped(s string) bool {
	if len(s) != len(TokenPrefix)+tokenHexLen || !strings.HasPrefix(s, TokenPrefix) {
		return false
	}
	for _, c := range s[len(TokenPrefix):] {
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return false
		}
	}
	return true
}

// tokenHint is the 6 hex characters after the prefix ("" when malformed).
func tokenHint(s string) string {
	if !IsTokenShaped(s) {
		return ""
	}
	return s[len(TokenPrefix) : len(TokenPrefix)+tokenHintLen]
}

// cleanTokenName drops control and format characters and trims spaces.
func cleanTokenName(s string) string {
	var b strings.Builder
	for _, r := range s {
		if unicode.IsControl(r) || unicode.Is(unicode.Cf, r) {
			continue
		}
		b.WriteRune(r)
	}
	return strings.TrimSpace(b.String())
}

// validate checks the request and returns the cleaned name.
func (req TokenRequest) validate() (string, error) {
	name := cleanTokenName(req.Name)
	if n := utf8.RuneCountInString(name); n < 1 || n > maxTokenNameRunes {
		return "", &TokenRequestError{"name", "The name must be 1 to 64 characters."}
	}
	if req.Scope != ScopeRead && req.Scope != ScopeWrite {
		return "", &TokenRequestError{"scope", "The scope must be read or write."}
	}
	if req.ExpiresInDays < 1 || req.ExpiresInDays > MaxTokenDays {
		return "", &TokenRequestError{"expiresInDays", "The expiry must be 1 to 365 days."}
	}
	return name, nil
}

// ValidateTokenRequest is CreateToken's request check on its own (a
// *TokenRequestError), so a caller can refuse a bad form before it asks for
// the password.
func ValidateTokenRequest(req TokenRequest) error {
	_, err := req.validate()
	return err
}

// CreateToken mints a token for userID and stores its hash, audited
// (token_created) in the same transaction. The returned token is the only
// copy: the caller shows it once and never logs it. A workspace that is
// not the user's is ErrWorkspaceNotFound; MaxTokens live tokens already is
// ErrTokenLimit (checked in the INSERT itself, so parallel creates cannot
// pass it).
func CreateToken(ctx context.Context, sqlDB *sql.DB, userID int64, req TokenRequest) (string, TokenInfo, error) {
	name, err := req.validate()
	if err != nil {
		return "", TokenInfo{}, err
	}
	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return "", TokenInfo{}, fmt.Errorf("begin create token: %w", err)
	}
	defer tx.Rollback()
	if req.WorkspaceID != nil {
		var one int
		err := tx.QueryRowContext(ctx, `SELECT 1 FROM workspaces WHERE id = ? AND user_id = ?`, *req.WorkspaceID, userID).Scan(&one)
		if errors.Is(err, sql.ErrNoRows) {
			return "", TokenInfo{}, ErrWorkspaceNotFound
		}
		if err != nil {
			return "", TokenInfo{}, fmt.Errorf("read workspace: %w", err)
		}
	}
	at := nowFunc().UTC().Truncate(time.Second)
	created := at.Format(time.RFC3339)
	expires := at.Add(time.Duration(req.ExpiresInDays) * 24 * time.Hour).Format(time.RFC3339)
	token := TokenPrefix + hex.EncodeToString(randomBytes(tokenHexLen/2))
	var ws any
	if req.WorkspaceID != nil {
		ws = *req.WorkspaceID
	}
	res, err := tx.ExecContext(ctx, `
		INSERT INTO access_tokens (user_id, name, token_hash, hint, scope, workspace_id, created_at, expires_at)
		SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
		WHERE (SELECT COUNT(*) FROM access_tokens WHERE user_id = ?1 AND expires_at > ?7) < ?9`,
		userID, name, hashToken(token), tokenHint(token), req.Scope, ws, created, expires, maxLiveTokens)
	if err != nil {
		return "", TokenInfo{}, fmt.Errorf("insert token: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return "", TokenInfo{}, ErrTokenLimit
	}
	id, err := res.LastInsertId()
	if err != nil {
		return "", TokenInfo{}, fmt.Errorf("token id: %w", err)
	}
	if err := Audit(ctx, tx, AuditEvent{Action: "token_created", ActorID: userID, TargetID: &userID,
		Detail: map[string]any{"tokenId": id, "scope": req.Scope, "days": req.ExpiresInDays, "limited": req.WorkspaceID != nil}}); err != nil {
		return "", TokenInfo{}, err
	}
	if err := tx.Commit(); err != nil {
		return "", TokenInfo{}, fmt.Errorf("commit create token: %w", err)
	}
	info := TokenInfo{ID: id, Name: name, Hint: tokenHint(token), Scope: req.Scope, WorkspaceID: req.WorkspaceID,
		CreatedAt: created, ExpiresAt: expires}
	return token, info, nil
}

// ListTokens returns the user's tokens, newest first, expired ones flagged.
func ListTokens(ctx context.Context, sqlDB *sql.DB, userID int64) ([]TokenInfo, error) {
	at := now()
	rows, err := sqlDB.QueryContext(ctx, `
		SELECT id, name, hint, scope, workspace_id, created_at, expires_at, last_used_at, expires_at <= ?
		FROM access_tokens WHERE user_id = ? ORDER BY id DESC`, at, userID)
	if err != nil {
		return nil, fmt.Errorf("list tokens: %w", err)
	}
	defer rows.Close()
	out := []TokenInfo{}
	for rows.Next() {
		var t TokenInfo
		var ws sql.NullInt64
		var last sql.NullString
		if err := rows.Scan(&t.ID, &t.Name, &t.Hint, &t.Scope, &ws, &t.CreatedAt, &t.ExpiresAt, &last, &t.Expired); err != nil {
			return nil, fmt.Errorf("scan token: %w", err)
		}
		if ws.Valid {
			t.WorkspaceID = &ws.Int64
		}
		if last.Valid {
			t.LastUsedAt = &last.String
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// RevokeToken deletes one token of userID (ErrTokenNotFound when it is
// unknown or someone else's), audited in the same transaction.
func RevokeToken(ctx context.Context, sqlDB *sql.DB, userID, tokenID int64) error {
	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin revoke token: %w", err)
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx, `DELETE FROM access_tokens WHERE id = ? AND user_id = ?`, tokenID, userID)
	if err != nil {
		return fmt.Errorf("revoke token: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrTokenNotFound
	}
	if err := Audit(ctx, tx, AuditEvent{Action: "token_revoked", ActorID: userID, TargetID: &userID,
		Detail: map[string]any{"scope": "one", "count": 1}}); err != nil {
		return err
	}
	return tx.Commit()
}

// RevokeAllTokens deletes every token of userID and returns how many went,
// audited in the same transaction.
func RevokeAllTokens(ctx context.Context, sqlDB *sql.DB, userID int64) (int64, error) {
	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin revoke tokens: %w", err)
	}
	defer tx.Rollback()
	n, err := revokeTokens(ctx, tx, userID)
	if err != nil {
		return 0, err
	}
	if err := Audit(ctx, tx, AuditEvent{Action: "token_revoked", ActorID: userID, TargetID: &userID,
		Detail: map[string]any{"scope": "all", "count": n}}); err != nil {
		return 0, err
	}
	return n, tx.Commit()
}

// revokeTokens deletes every access token of userID in the caller's
// transaction.
func revokeTokens(ctx context.Context, ex execer, userID int64) (int64, error) {
	res, err := ex.ExecContext(ctx, `DELETE FROM access_tokens WHERE user_id = ?`, userID)
	if err != nil {
		return 0, fmt.Errorf("revoke tokens: %w", err)
	}
	n, _ := res.RowsAffected()
	return n, nil
}

// TokenFromRequest returns the bearer value of r when it is an access
// token candidate (it starts with TokenPrefix); ok false otherwise. The
// value is not validated or looked up here.
func TokenFromRequest(r *http.Request) (raw string, ok bool) {
	raw = bearerToken(r)
	return raw, strings.HasPrefix(raw, TokenPrefix)
}

// AuthenticateToken resolves an access token. nil, nil means refuse (401):
// malformed, unknown, expired, revoked, or its owner is disabled. There is
// one lookup, on the hash of the presented string; no secret is compared
// in Go. It records no use: the caller calls TouchToken once the request
// has passed every check, so a refused request is not a use.
func AuthenticateToken(ctx context.Context, sqlDB *sql.DB, raw string) (*Principal, error) {
	if !IsTokenShaped(raw) {
		return nil, nil
	}
	at := nowFunc().UTC()
	stamp := at.Format(time.RFC3339)
	var p Principal
	var admin, must int
	var email, verified, last sql.NullString
	var ws sql.NullInt64
	err := sqlDB.QueryRowContext(ctx, `
		SELECT users.id, users.username, users.admin, users.email, users.email_verified_at,
		       users.must_change_password, users.created_at,
		       access_tokens.id, access_tokens.scope, access_tokens.workspace_id, access_tokens.last_used_at
		FROM access_tokens JOIN users ON users.id = access_tokens.user_id
		WHERE access_tokens.token_hash = ? AND users.disabled_at IS NULL AND access_tokens.expires_at > ?`,
		hashToken(raw), stamp).Scan(
		&p.User.ID, &p.User.Username, &admin, &email, &verified, &must, &p.User.CreatedAt,
		&p.TokenID, &p.TokenScope, &ws, &last)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("lookup access token: %w", err)
	}
	p.User.Admin = admin != 0
	p.User.MustChangePassword = must != 0
	p.User.EmailVerified = verified.Valid
	if email.Valid {
		p.User.Email = &email.String
	}
	if ws.Valid {
		p.TokenWorkspace = &ws.Int64
	}
	p.Level = LevelFull
	p.tokenLastUsed = last
	return &p, nil
}

// TouchToken records a use of the token behind p (a principal of
// AuthenticateToken): last_used_at at most every lastUsedEvery, and the
// first use (NULL to a value) audited once, token_first_used, even under
// parallel requests (the guarded UPDATE has one winner).
func TouchToken(ctx context.Context, sqlDB *sql.DB, p *Principal) error {
	if p == nil || !p.ViaToken() {
		return nil
	}
	return touchToken(ctx, sqlDB, p.TokenID, p.User.ID, p.tokenLastUsed, nowFunc().UTC())
}

// touchToken records a use: the first one with its audit row, later ones
// at most every lastUsedEvery (a read that sees a recent stamp writes
// nothing).
func touchToken(ctx context.Context, sqlDB *sql.DB, tokenID, userID int64, last sql.NullString, at time.Time) error {
	stamp := at.Format(time.RFC3339)
	if !last.Valid {
		tx, err := sqlDB.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("begin first use: %w", err)
		}
		defer tx.Rollback()
		res, err := tx.ExecContext(ctx, `UPDATE access_tokens SET last_used_at = ? WHERE id = ? AND last_used_at IS NULL`, stamp, tokenID)
		if err != nil {
			return fmt.Errorf("touch access token: %w", err)
		}
		if n, _ := res.RowsAffected(); n == 1 {
			if err := Audit(ctx, tx, AuditEvent{Action: "token_first_used", ActorID: userID, TargetID: &userID,
				Detail: map[string]any{"tokenId": tokenID}}); err != nil {
				return err
			}
		}
		return tx.Commit()
	}
	cutoff := at.Add(-lastUsedEvery).Format(time.RFC3339)
	if last.String >= cutoff {
		return nil
	}
	if _, err := sqlDB.ExecContext(ctx, `UPDATE access_tokens SET last_used_at = ? WHERE id = ? AND last_used_at < ?`,
		stamp, tokenID, cutoff); err != nil {
		return fmt.Errorf("touch access token: %w", err)
	}
	return nil
}
