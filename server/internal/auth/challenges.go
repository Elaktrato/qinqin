package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"strconv"
	"time"
)

// Challenge kinds.
const (
	ChallengeMFA         = "mfa"          // second step of a password sign-in
	ChallengeEmailLogin  = "email_login"  // passwordless sign-in by emailed code
	ChallengeEmailVerify = "email_verify" // confirming a self-entered address
)

// Challenge limits (smtp-mfa spec section 6).
const (
	ChallengeTTL = 10 * time.Minute
	MaxSends     = 3
	ResendEvery  = 60 * time.Second
	MaxAttempts  = 5
)

// Challenge errors.
var (
	// ErrChallengeInvalid: unknown, expired, already used or exhausted.
	ErrChallengeInvalid = errors.New("challenge invalid")
	// ErrCodeWrong: a wrong code; the challenge is still alive.
	ErrCodeWrong = errors.New("code wrong")
	// ErrResendTooSoon: the 60 s between two sends has not passed.
	ErrResendTooSoon = errors.New("resend too soon")
	// ErrTooManySends: the third mail of this challenge was already sent.
	ErrTooManySends = errors.New("too many sends")
)

// Challenge is a live challenge row (no secret in it).
type Challenge struct {
	ID        int64
	Kind      string
	UserID    int64 // 0: none (an unknown identifier)
	EmailNorm string
	Device    string
	Sends     int
	Attempts  int
	ExpiresAt time.Time
	LastSent  time.Time
}

// AttemptsLeft is how many wrong codes remain.
func (c Challenge) AttemptsLeft() int { return max(MaxAttempts-c.Attempts, 0) }

// CodeError carries what the caller needs to answer a refused code.
type CodeError struct {
	Err          error
	AttemptsLeft int
	Retry        time.Duration // ErrResendTooSoon / ErrTooManySends: how long to wait
}

func (e *CodeError) Error() string { return e.Err.Error() }
func (e *CodeError) Unwrap() error { return e.Err }

// NewChallenge stores a challenge and returns its token (shown once, the
// client's handle; only its SHA-256 is stored). userID nil: an unknown
// identifier of an emailed sign-in, stored so the answer is the same.
func NewChallenge(ctx context.Context, sqlDB *sql.DB, kind string, userID *int64, emailNorm, device string) (string, Challenge, error) {
	token := newToken()
	at := nowFunc().UTC()
	var uid any
	if userID != nil {
		uid = *userID
	}
	res, err := sqlDB.ExecContext(ctx, `
		INSERT INTO auth_challenges (token_hash, kind, user_id, email_norm, expires_at, created_at, device)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		hashToken(token), kind, uid, emailNorm, at.Add(ChallengeTTL).Format(time.RFC3339), at.Format(time.RFC3339), CleanDevice(device))
	if err != nil {
		return "", Challenge{}, fmt.Errorf("insert challenge: %w", err)
	}
	id, _ := res.LastInsertId()
	c := Challenge{ID: id, Kind: kind, EmailNorm: emailNorm, Device: CleanDevice(device), ExpiresAt: at.Add(ChallengeTTL)}
	if userID != nil {
		c.UserID = *userID
	}
	return token, c, nil
}

func scanChallenge(row *sql.Row) (Challenge, string, error) {
	var c Challenge
	var uid sql.NullInt64
	var exp string
	var last sql.NullString
	var codeHash string
	err := row.Scan(&c.ID, &c.Kind, &uid, &c.EmailNorm, &c.Device, &c.Sends, &c.Attempts, &exp, &last, &codeHash)
	if errors.Is(err, sql.ErrNoRows) {
		return Challenge{}, "", ErrChallengeInvalid
	}
	if err != nil {
		return Challenge{}, "", fmt.Errorf("load challenge: %w", err)
	}
	c.UserID = uid.Int64
	c.ExpiresAt, _ = time.Parse(time.RFC3339, exp)
	if last.Valid {
		c.LastSent, _ = time.Parse(time.RFC3339, last.String)
	}
	return c, codeHash, nil
}

const challengeColumns = `id, kind, user_id, email_norm, device, sends, attempts, expires_at, last_sent_at, code_hash`

// LoadChallenge returns the live challenge behind token.
func LoadChallenge(ctx context.Context, sqlDB *sql.DB, token string) (Challenge, error) {
	c, _, err := scanChallenge(sqlDB.QueryRowContext(ctx,
		`SELECT `+challengeColumns+` FROM auth_challenges WHERE token_hash = ? AND expires_at > ?`,
		hashToken(token), now()))
	return c, err
}

// LoadUserChallenge returns the user's live challenge of kind (the newest).
func LoadUserChallenge(ctx context.Context, sqlDB *sql.DB, userID int64, kind string) (Challenge, error) {
	c, _, err := scanChallenge(sqlDB.QueryRowContext(ctx,
		`SELECT `+challengeColumns+` FROM auth_challenges WHERE user_id = ? AND kind = ? AND expires_at > ? ORDER BY id DESC LIMIT 1`,
		userID, kind, now()))
	return c, err
}

// DropUserChallenges deletes the user's challenges of kind (a new one
// replaces them).
func DropUserChallenges(ctx context.Context, sqlDB *sql.DB, userID int64, kind string) error {
	_, err := sqlDB.ExecContext(ctx, `DELETE FROM auth_challenges WHERE user_id = ? AND kind = ?`, userID, kind)
	return err
}

// DeleteChallenge removes a challenge by id (after a successful use).
func DeleteChallenge(ctx context.Context, ex execer, id int64) error {
	_, err := ex.ExecContext(ctx, `DELETE FROM auth_challenges WHERE id = ?`, id)
	return err
}

// codeHash binds the code to its challenge row: SHA-256(id ":" code), hex.
func codeHash(id int64, code string) string {
	sum := sha256.Sum256([]byte(strconv.FormatInt(id, 10) + ":" + code))
	return hex.EncodeToString(sum[:])
}

// newCode returns a uniform six-digit code (crypto/rand with rejection
// sampling inside rand.Int).
func newCode() string {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		panic("auth: crypto/rand: " + err.Error())
	}
	return fmt.Sprintf("%06d", n.Int64())
}

// SetCode issues a fresh code for the challenge and returns it for the
// mail. At most MaxSends per challenge, ResendEvery apart; the guarded
// UPDATE makes two parallel requests spend one send between them. A send
// does not reset the attempt counter.
func SetCode(ctx context.Context, sqlDB *sql.DB, id int64) (string, error) {
	code := newCode()
	at := nowFunc().UTC()
	res, err := sqlDB.ExecContext(ctx, `
		UPDATE auth_challenges SET code_hash = ?1, sends = sends + 1, last_sent_at = ?2
		WHERE id = ?3 AND expires_at > ?2 AND sends < ?4 AND (last_sent_at IS NULL OR last_sent_at <= ?5)`,
		codeHash(id, code), at.Format(time.RFC3339), id, MaxSends, at.Add(-ResendEvery).Format(time.RFC3339))
	if err != nil {
		return "", fmt.Errorf("set code: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 1 {
		return code, nil
	}
	// Refused: say why.
	var sends int
	var last, exp string
	if err := sqlDB.QueryRowContext(ctx, `SELECT sends, COALESCE(last_sent_at, ''), expires_at FROM auth_challenges WHERE id = ?`, id).Scan(&sends, &last, &exp); err != nil {
		return "", ErrChallengeInvalid
	}
	expires, _ := time.Parse(time.RFC3339, exp)
	if !expires.After(at) {
		return "", ErrChallengeInvalid
	}
	if sends >= MaxSends {
		return "", &CodeError{Err: ErrTooManySends, Retry: expires.Sub(at)}
	}
	lastT, _ := time.Parse(time.RFC3339, last)
	return "", &CodeError{Err: ErrResendTooSoon, Retry: ResendEvery - at.Sub(lastT)}
}

// IsSixDigits reports whether code is exactly six ASCII digits; the length
// of a code is public, so anything else is refused before comparing.
func IsSixDigits(code string) bool {
	if len(code) != 6 {
		return false
	}
	for i := 0; i < 6; i++ {
		if code[i] < '0' || code[i] > '9' {
			return false
		}
	}
	return true
}

// VerifyCode checks a code against the challenge selected by where/args
// (token hash or user and kind). Every call spends one of the MaxAttempts
// first (a guarded UPDATE, so parallel guesses all count); the code is
// compared in constant time on equal-length hex digests; success deletes the
// challenge (single use), as does the last wrong attempt. Errors:
// ErrChallengeInvalid (gone, expired, exhausted) or a *CodeError wrapping
// ErrCodeWrong with the attempts left.
func verifyCode(ctx context.Context, sqlDB *sql.DB, where string, args []any, code string) (Challenge, error) {
	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return Challenge{}, fmt.Errorf("begin verify code: %w", err)
	}
	defer tx.Rollback()
	args = append(args, now(), MaxAttempts)
	c, stored, err := scanChallenge(tx.QueryRowContext(ctx, `
		UPDATE auth_challenges SET attempts = attempts + 1
		WHERE id = (SELECT id FROM auth_challenges WHERE `+where+` AND expires_at > ? AND attempts < ? ORDER BY id DESC LIMIT 1)
		RETURNING `+challengeColumns, args...))
	if err != nil {
		return Challenge{}, err
	}
	good := 0
	if IsSixDigits(code) && stored != "" {
		good = subtle.ConstantTimeCompare([]byte(codeHash(c.ID, code)), []byte(stored))
	}
	if good == 1 {
		if err := DeleteChallenge(ctx, tx, c.ID); err != nil {
			return Challenge{}, err
		}
		return c, tx.Commit()
	}
	if c.Attempts >= MaxAttempts {
		if err := DeleteChallenge(ctx, tx, c.ID); err != nil {
			return Challenge{}, err
		}
		if err := tx.Commit(); err != nil {
			return Challenge{}, err
		}
		return Challenge{}, ErrChallengeInvalid
	}
	if err := tx.Commit(); err != nil {
		return Challenge{}, err
	}
	return c, &CodeError{Err: ErrCodeWrong, AttemptsLeft: c.AttemptsLeft()}
}

// VerifyCode checks a code against the challenge behind token.
func VerifyCode(ctx context.Context, sqlDB *sql.DB, token, code string) (Challenge, error) {
	return verifyCode(ctx, sqlDB, `token_hash = ?`, []any{hashToken(token)}, code)
}

// VerifyUserCode checks a code against the user's newest live challenge of kind.
func VerifyUserCode(ctx context.Context, sqlDB *sql.DB, userID int64, kind, code string) (Challenge, error) {
	return verifyCode(ctx, sqlDB, `user_id = ? AND kind = ?`, []any{userID, kind}, code)
}

// PruneChallenges deletes challenges past their expiry.
func PruneChallenges(ctx context.Context, sqlDB *sql.DB, at time.Time) error {
	_, err := sqlDB.ExecContext(ctx, `DELETE FROM auth_challenges WHERE expires_at <= ?`, at.UTC().Format(time.RFC3339))
	if err != nil {
		return fmt.Errorf("prune challenges: %w", err)
	}
	return nil
}
