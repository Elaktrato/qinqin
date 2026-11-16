package auth

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"qinqin/internal/secretbox"
)

// Two-factor errors.
var (
	// ErrMFAUnavailable: no usable QINQIN_SECRET, or the stored secret was
	// sealed with another one (an administrator resets two-factor, or a
	// recovery code is used).
	ErrMFAUnavailable = errors.New("two-factor unavailable")
	// ErrNoTOTP: the user has no confirmed authenticator.
	ErrNoTOTP = errors.New("no authenticator")
	// ErrNoPending: no setup is waiting for its first code (none, or expired).
	ErrNoPending = errors.New("no pending setup")
	// ErrTOTPCodeInvalid covers a wrong code and a replayed one.
	ErrTOTPCodeInvalid = errors.New("code invalid")
	// ErrRecoveryInvalid: unknown or already used.
	ErrRecoveryInvalid = errors.New("recovery code invalid")
)

// Sizes and lifetimes.
const (
	totpSecretBytes   = 20
	PendingTTL        = 10 * time.Minute
	RecoveryCodeCount = 10
)

// MFA holds the sealers for TOTP secrets. Current nil: TOTP is unavailable.
type MFA struct {
	DB       *sql.DB
	Current  *secretbox.Sealer
	Previous *secretbox.Sealer
}

// TOTPAAD binds a sealed secret to its user.
func TOTPAAD(userID int64) string { return fmt.Sprintf("qinqin/mfa_totp/v1|user=%d", userID) }

func (m *MFA) open(ct, nonce []byte, fp string, userID int64) ([]byte, error) {
	for _, s := range []*secretbox.Sealer{m.Current, m.Previous} {
		if s != nil && s.Fingerprint() == fp {
			plain, err := s.Open(ct, nonce, TOTPAAD(userID))
			if err != nil {
				return nil, ErrMFAUnavailable
			}
			return plain, nil
		}
	}
	return nil, ErrMFAUnavailable
}

// Available reports whether TOTP can be enrolled (a usable secret exists).
func (m *MFA) Available() bool { return m != nil && m.Current != nil }

// BeginTOTP starts a setup: a new secret goes into the user's PENDING
// columns (a confirmed secret is untouched until the pending one is
// confirmed) and is returned base32 encoded, once.
func (m *MFA) BeginTOTP(ctx context.Context, userID int64, at time.Time) (secret string, expires time.Time, err error) {
	if !m.Available() {
		return "", time.Time{}, ErrMFAUnavailable
	}
	raw := randomBytes(totpSecretBytes)
	ct, nonce, err := m.Current.Seal(raw, TOTPAAD(userID))
	if err != nil {
		return "", time.Time{}, err
	}
	_, err = m.DB.ExecContext(ctx, `
		INSERT INTO mfa_totp (user_id, pending_ct, pending_nonce, pending_fp, pending_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)
		ON CONFLICT(user_id) DO UPDATE SET pending_ct = ?2, pending_nonce = ?3, pending_fp = ?4, pending_at = ?5`,
		userID, ct, nonce, m.Current.Fingerprint(), at.UTC().Format(time.RFC3339))
	if err != nil {
		return "", time.Time{}, fmt.Errorf("begin totp: %w", err)
	}
	return base32NoPad.EncodeToString(raw), at.Add(PendingTTL), nil
}

// matchStep compares code against the steps t-1, t, t+1 in constant time
// (all three are always computed) and returns the matching step, 0 if none.
func matchStep(secret []byte, code string, at time.Time) (uint64, bool) {
	if !IsSixDigits(code) {
		return 0, false
	}
	cur := totpStep(at)
	var hit uint64
	found := 0
	for _, step := range []uint64{cur - 1, cur, cur + 1} {
		eq := subtle.ConstantTimeCompare([]byte(hotp(secret, step, totpDigits)), []byte(code))
		if eq == 1 {
			hit = step
		}
		found |= eq
	}
	return hit, found == 1
}

// ConfirmTOTP checks the first code against the pending secret and makes it
// the user's authenticator; it returns the new recovery codes (the old set,
// if any, is replaced). The code's step becomes last_step, so it cannot be
// replayed right after.
func (m *MFA) ConfirmTOTP(ctx context.Context, userID int64, code string, at time.Time) ([]string, error) {
	var ct, nonce []byte
	var fp, pendingAt sql.NullString
	err := m.DB.QueryRowContext(ctx, `SELECT pending_ct, pending_nonce, pending_fp, pending_at FROM mfa_totp WHERE user_id = ?`, userID).Scan(&ct, &nonce, &fp, &pendingAt)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && len(ct) == 0) {
		return nil, ErrNoPending
	}
	if err != nil {
		return nil, fmt.Errorf("load pending totp: %w", err)
	}
	if started, perr := time.Parse(time.RFC3339, pendingAt.String); perr != nil || at.Sub(started) > PendingTTL {
		return nil, ErrNoPending
	}
	secret, err := m.open(ct, nonce, fp.String, userID)
	if err != nil {
		return nil, err
	}
	step, ok := matchStep(secret, code, at)
	if !ok {
		return nil, ErrTOTPCodeInvalid
	}
	codes, hashes := newRecoverySet()
	tx, err := m.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin confirm totp: %w", err)
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx, `
		UPDATE mfa_totp SET secret_ct = pending_ct, secret_nonce = pending_nonce, secret_fp = pending_fp, confirmed_at = ?1, last_step = ?2,
			pending_ct = NULL, pending_nonce = NULL, pending_fp = NULL, pending_at = NULL
		WHERE user_id = ?3 AND pending_ct IS NOT NULL`, at.UTC().Format(time.RFC3339), step, userID)
	if err != nil {
		return nil, fmt.Errorf("confirm totp: %w", err)
	}
	if n, _ := res.RowsAffected(); n != 1 {
		return nil, ErrNoPending // another confirm won
	}
	if err := replaceRecoveryCodes(ctx, tx, userID, hashes); err != nil {
		return nil, err
	}
	if err := Audit(ctx, tx, AuditEvent{Action: "mfa_enabled", ActorID: userID, TargetID: &userID, Detail: map[string]any{"scope": "totp"}}); err != nil {
		return nil, err
	}
	return codes, tx.Commit()
}

// HasTOTP reports whether the user has a confirmed authenticator.
func HasTOTP(ctx context.Context, ex querier, userID int64) (bool, error) {
	var n int
	err := ex.QueryRowContext(ctx, `SELECT COUNT(*) FROM mfa_totp WHERE user_id = ? AND confirmed_at IS NOT NULL`, userID).Scan(&n)
	return n > 0, err
}

// VerifyTOTP checks a code for the user's confirmed authenticator. A code is
// accepted only for a step above the last accepted one, written with a
// guarded UPDATE so two parallel uses of one code cannot both pass (replay
// protection). ErrNoTOTP, ErrMFAUnavailable or ErrTOTPCodeInvalid otherwise.
func (m *MFA) VerifyTOTP(ctx context.Context, userID int64, code string, at time.Time) error {
	var ct, nonce []byte
	var fp sql.NullString
	var last int64
	err := m.DB.QueryRowContext(ctx, `SELECT secret_ct, secret_nonce, secret_fp, last_step FROM mfa_totp WHERE user_id = ? AND confirmed_at IS NOT NULL`, userID).Scan(&ct, &nonce, &fp, &last)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNoTOTP
	}
	if err != nil {
		return fmt.Errorf("load totp: %w", err)
	}
	secret, err := m.open(ct, nonce, fp.String, userID)
	if err != nil {
		return err
	}
	step, ok := matchStep(secret, code, at)
	if !ok || int64(step) <= last {
		return ErrTOTPCodeInvalid
	}
	res, err := m.DB.ExecContext(ctx, `UPDATE mfa_totp SET last_step = ? WHERE user_id = ? AND last_step < ?`, step, userID, step)
	if err != nil {
		return fmt.Errorf("record totp step: %w", err)
	}
	if n, _ := res.RowsAffected(); n != 1 {
		return ErrTOTPCodeInvalid // a parallel request used the code first
	}
	return nil
}

// RemoveTOTP deletes the user's authenticator and recovery codes.
func RemoveTOTP(ctx context.Context, ex execer, userID int64) error {
	if _, err := ex.ExecContext(ctx, `DELETE FROM mfa_totp WHERE user_id = ?`, userID); err != nil {
		return fmt.Errorf("remove totp: %w", err)
	}
	if _, err := ex.ExecContext(ctx, `DELETE FROM mfa_recovery_codes WHERE user_id = ?`, userID); err != nil {
		return fmt.Errorf("remove recovery codes: %w", err)
	}
	return nil
}

// Recovery codes: 16 base32 characters (80 bits), shown as ABCD-EFGH-IJKL-MNOP,
// stored as SHA-256 of the normalised form, single use.

func newRecoverySet() (codes, hashes []string) {
	for i := 0; i < RecoveryCodeCount; i++ {
		raw := base32NoPad.EncodeToString(randomBytes(10)) // 10 bytes = 16 characters
		hashes = append(hashes, recoveryHash(raw))
		codes = append(codes, raw[0:4]+"-"+raw[4:8]+"-"+raw[8:12]+"-"+raw[12:16])
	}
	return codes, hashes
}

// NormaliseRecoveryCode ignores case, spaces and dashes; ok is false when
// what remains is not 16 base32 characters.
func NormaliseRecoveryCode(in string) (string, bool) {
	var b strings.Builder
	for _, r := range strings.ToUpper(in) {
		switch {
		case r == ' ' || r == '-' || r == '\t':
		case (r >= 'A' && r <= 'Z') || (r >= '2' && r <= '7'):
			b.WriteRune(r)
		default:
			return "", false
		}
	}
	return b.String(), b.Len() == 16
}

func recoveryHash(norm string) string {
	sum := sha256.Sum256([]byte("qinqin recovery code v1|" + norm))
	return hex.EncodeToString(sum[:])
}

func replaceRecoveryCodes(ctx context.Context, ex execer, userID int64, hashes []string) error {
	if _, err := ex.ExecContext(ctx, `DELETE FROM mfa_recovery_codes WHERE user_id = ?`, userID); err != nil {
		return fmt.Errorf("drop recovery codes: %w", err)
	}
	for _, h := range hashes {
		if _, err := ex.ExecContext(ctx, `INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES (?, ?)`, userID, h); err != nil {
			return fmt.Errorf("store recovery code: %w", err)
		}
	}
	return nil
}

// NewRecoveryCodes replaces the user's recovery codes with a fresh set and
// returns it (shown once).
func NewRecoveryCodes(ctx context.Context, sqlDB *sql.DB, userID int64) ([]string, error) {
	codes, hashes := newRecoverySet()
	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin recovery codes: %w", err)
	}
	defer tx.Rollback()
	if err := replaceRecoveryCodes(ctx, tx, userID, hashes); err != nil {
		return nil, err
	}
	return codes, tx.Commit()
}

// UseRecoveryCode spends one recovery code. The lookup is by the SHA-256 of
// the normalised input (a value the caller cannot steer toward another row),
// and the guarded UPDATE lets only one of two parallel uses win.
func UseRecoveryCode(ctx context.Context, sqlDB *sql.DB, userID int64, input string) error {
	norm, ok := NormaliseRecoveryCode(input)
	if !ok {
		return ErrRecoveryInvalid
	}
	res, err := sqlDB.ExecContext(ctx, `UPDATE mfa_recovery_codes SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL`,
		now(), userID, recoveryHash(norm))
	if err != nil {
		return fmt.Errorf("use recovery code: %w", err)
	}
	if n, _ := res.RowsAffected(); n != 1 {
		return ErrRecoveryInvalid
	}
	return nil
}

// RecoveryCodesLeft counts the user's unused recovery codes.
func RecoveryCodesLeft(ctx context.Context, ex querier, userID int64) (int, error) {
	var n int
	err := ex.QueryRowContext(ctx, `SELECT COUNT(*) FROM mfa_recovery_codes WHERE user_id = ? AND used_at IS NULL`, userID).Scan(&n)
	return n, err
}

// MFAState is what the user's two-factor setup looks like.
type MFAState struct {
	TOTP              bool `json:"totp"`
	Email             bool `json:"email"`
	RecoveryCodesLeft int  `json:"recoveryCodesLeft"`
}

// LoadMFAState reads the user's methods. Email counts only as the flag; the
// caller decides whether the address is verified and mail is configured.
func LoadMFAState(ctx context.Context, ex querier, userID int64) (MFAState, error) {
	var st MFAState
	var email int
	if err := ex.QueryRowContext(ctx, `SELECT mfa_email FROM users WHERE id = ?`, userID).Scan(&email); err != nil {
		return st, fmt.Errorf("load mfa flag: %w", err)
	}
	st.Email = email != 0
	var err error
	if st.TOTP, err = HasTOTP(ctx, ex, userID); err != nil {
		return st, fmt.Errorf("load totp: %w", err)
	}
	if st.TOTP {
		if st.RecoveryCodesLeft, err = RecoveryCodesLeft(ctx, ex, userID); err != nil {
			return st, fmt.Errorf("count recovery codes: %w", err)
		}
	}
	return st, nil
}

// SetMFAEmail turns the email method on or off for the user.
func SetMFAEmail(ctx context.Context, ex execer, userID int64, on bool) error {
	v := 0
	if on {
		v = 1
	}
	if _, err := ex.ExecContext(ctx, `UPDATE users SET mfa_email = ? WHERE id = ?`, v, userID); err != nil {
		return fmt.Errorf("set mfa email: %w", err)
	}
	return nil
}

// ResetMFA removes every second factor of the user (authenticator, recovery
// codes, the email method flag), deletes their sessions and access tokens
// and their pending reset links, in the caller's transaction.
func ResetMFA(ctx context.Context, ex execer, userID int64) error {
	if err := RemoveTOTP(ctx, ex, userID); err != nil {
		return err
	}
	if err := SetMFAEmail(ctx, ex, userID, false); err != nil {
		return err
	}
	if _, err := ex.ExecContext(ctx, `DELETE FROM auth_challenges WHERE user_id = ? AND kind = 'mfa'`, userID); err != nil {
		return fmt.Errorf("drop mfa challenges: %w", err)
	}
	if _, _, err := revokeCredentials(ctx, ex, userID, 0); err != nil {
		return err
	}
	// A pending reset link is a second way in: it dies with the reset.
	return dropPendingResets(ctx, ex, userID)
}

// Rotate re-seals authenticator secrets (confirmed and pending) that were
// sealed with Previous. It returns how many values moved.
func (m *MFA) Rotate(ctx context.Context) (int, error) {
	rot := secretbox.Rotator{Current: m.Current, Previous: m.Previous}
	if !rot.Active() {
		return 0, nil
	}
	tx, err := m.DB.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	aad := func(keys []any) (string, error) {
		id, ok := keys[0].(int64)
		if !ok {
			return "", ErrMFAUnavailable
		}
		return TOTPAAD(id), nil
	}
	total := 0
	for _, c := range []secretbox.Column{
		{Table: "mfa_totp", Keys: []string{"user_id"}, Ct: "secret_ct", Nonce: "secret_nonce", FP: "secret_fp", AAD: aad},
		{Table: "mfa_totp", Keys: []string{"user_id"}, Ct: "pending_ct", Nonce: "pending_nonce", FP: "pending_fp", AAD: aad},
	} {
		n, err := rot.Rotate(ctx, tx, c)
		if err != nil {
			return 0, err
		}
		total += n
	}
	return total, tx.Commit()
}

// CountMailDependents counts the users whose only second step is email (the
// email method is on, or enforcement applies to a verified address) and who
// have no authenticator: they cannot sign in while mail is down.
func CountMailDependents(ctx context.Context, ex querier, enforced bool) (int, error) {
	var n int
	err := ex.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM users u
		WHERE u.disabled_at IS NULL
		  AND NOT EXISTS (SELECT 1 FROM mfa_totp t WHERE t.user_id = u.id AND t.confirmed_at IS NOT NULL)
		  AND (u.mfa_email = 1 OR (?1 AND u.email_verified_at IS NOT NULL))`, enforced).Scan(&n)
	return n, err
}
