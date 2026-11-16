package auth_test

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"qinqin/internal/auth"
	"qinqin/internal/secretbox"
)

func mfaFixture(t *testing.T) (*auth.MFA, int64) {
	t.Helper()
	sqlDB, _ := usersFixture(t)
	uid := mkUser(t, sqlDB, "totpuser", false)
	return &auth.MFA{DB: sqlDB, Current: secretbox.NewSealer(secretSeq(1))}, uid
}

func secretSeq(start byte) []byte {
	b := make([]byte, 32)
	for i := range b {
		b[i] = start + byte(i)
	}
	return b
}

func enrol(t *testing.T, m *auth.MFA, uid int64, at time.Time) (secret string, codes []string) {
	t.Helper()
	secret, _, err := m.BeginTOTP(context.Background(), uid, at)
	if err != nil {
		t.Fatal(err)
	}
	code, _ := auth.TOTPCode(secret, at)
	codes, err = m.ConfirmTOTP(context.Background(), uid, code, at)
	if err != nil {
		t.Fatal(err)
	}
	return secret, codes
}

// RFC 6238 appendix B, SHA-1, secret "12345678901234567890", 8 digits.
func TestRFC6238Vectors(t *testing.T) {
	for _, v := range []struct {
		unix int64
		want string
	}{{59, "94287082"}, {1111111109, "07081804"}, {1111111111, "14050471"}, {1234567890, "89005924"}, {2000000000, "69279037"}, {20000000000, "65353130"}} {
		if got := auth.HOTPForTest([]byte("12345678901234567890"), uint64(v.unix/30), 8); got != v.want {
			t.Errorf("t=%d: %s, want %s", v.unix, got, v.want)
		}
	}
	// our six-digit truncation is the last six digits of the 8-digit value
	if got := auth.HOTPForTest([]byte("12345678901234567890"), 1, 6); got != "287082" {
		t.Errorf("6 digits = %s", got)
	}
}

func TestTOTPWindowAndReplay(t *testing.T) {
	m, uid := mfaFixture(t)
	ctx := context.Background()
	t0 := time.Date(2026, 11, 15, 10, 0, 10, 0, time.UTC)
	secret, _ := enrol(t, m, uid, t0)
	at := func(d time.Duration) string { c, _ := auth.TOTPCode(secret, t0.Add(d)); return c }
	// the code of the confirmation step is spent
	if err := m.VerifyTOTP(ctx, uid, at(0), t0); !errors.Is(err, auth.ErrTOTPCodeInvalid) {
		t.Errorf("the confirming code again: %v", err)
	}
	// +1 step ok, then the same code twice is refused (replay)
	now := t0.Add(30 * time.Second)
	if err := m.VerifyTOTP(ctx, uid, at(30*time.Second), now); err != nil {
		t.Fatalf("next step: %v", err)
	}
	if err := m.VerifyTOTP(ctx, uid, at(30*time.Second), now); !errors.Is(err, auth.ErrTOTPCodeInvalid) {
		t.Errorf("replay: %v", err)
	}
	// an older step than the last accepted one is refused even inside the window
	if err := m.VerifyTOTP(ctx, uid, at(0), now); !errors.Is(err, auth.ErrTOTPCodeInvalid) {
		t.Errorf("older step: %v", err)
	}
	// skew: +1 step ahead of the server clock is accepted, +2 refused
	now2 := t0.Add(5 * time.Minute)
	if err := m.VerifyTOTP(ctx, uid, mustCode(secret, now2.Add(30*time.Second)), now2); err != nil {
		t.Errorf("+1 step: %v", err)
	}
	now3 := t0.Add(10 * time.Minute)
	if err := m.VerifyTOTP(ctx, uid, mustCode(secret, now3.Add(60*time.Second)), now3); !errors.Is(err, auth.ErrTOTPCodeInvalid) {
		t.Errorf("+2 steps: %v", err)
	}
	if err := m.VerifyTOTP(ctx, uid, mustCode(secret, now3.Add(-60*time.Second)), now3); !errors.Is(err, auth.ErrTOTPCodeInvalid) {
		t.Errorf("-2 steps: %v", err)
	}
	if err := m.VerifyTOTP(ctx, uid, mustCode(secret, now3.Add(-30*time.Second)), now3); err != nil {
		t.Errorf("-1 step: %v", err)
	}
	for _, bad := range []string{"", "12345", "1234567", "abcdef", "12 456"} {
		if err := m.VerifyTOTP(ctx, uid, bad, now3); !errors.Is(err, auth.ErrTOTPCodeInvalid) {
			t.Errorf("%q: %v", bad, err)
		}
	}
}

func mustCode(secret string, at time.Time) string {
	c, err := auth.TOTPCode(secret, at)
	if err != nil {
		panic(err)
	}
	return c
}

func TestTOTPParallelUseOfOneCodeWinsOnce(t *testing.T) {
	m, uid := mfaFixture(t)
	t0 := time.Date(2026, 11, 15, 10, 0, 10, 0, time.UTC)
	secret, _ := enrol(t, m, uid, t0)
	now := t0.Add(60 * time.Second)
	code := mustCode(secret, now)
	var wg sync.WaitGroup
	var mu sync.Mutex
	won := 0
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if m.VerifyTOTP(context.Background(), uid, code, now) == nil {
				mu.Lock()
				won++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	if won != 1 {
		t.Fatalf("%d parallel verifications succeeded, want exactly 1", won)
	}
}

func TestTOTPSecretIsSealedAndBoundToTheUser(t *testing.T) {
	m, uid := mfaFixture(t)
	t0 := time.Date(2026, 11, 15, 10, 0, 10, 0, time.UTC)
	secret, _ := enrol(t, m, uid, t0)
	var ct []byte
	m.DB.QueryRow(`SELECT secret_ct FROM mfa_totp WHERE user_id = ?`, uid).Scan(&ct)
	if len(ct) == 0 || strings.Contains(string(ct), secret) {
		t.Fatal("secret stored in clear or missing")
	}
	// another user's row (copied ciphertext) fails closed
	other := mkUser(t, m.DB, "other", false)
	m.DB.Exec(`INSERT INTO mfa_totp (user_id, secret_ct, secret_nonce, secret_fp, confirmed_at, created_at)
		SELECT ?, secret_ct, secret_nonce, secret_fp, confirmed_at, created_at FROM mfa_totp WHERE user_id = ?`, other, uid)
	if err := m.VerifyTOTP(context.Background(), other, mustCode(secret, t0.Add(time.Minute)), t0.Add(time.Minute)); !errors.Is(err, auth.ErrMFAUnavailable) {
		t.Errorf("copied row: %v", err)
	}
}

func TestTOTPUndecryptableIsUnavailable(t *testing.T) {
	m, uid := mfaFixture(t)
	t0 := time.Date(2026, 11, 15, 10, 0, 10, 0, time.UTC)
	secret, codes := enrol(t, m, uid, t0)
	stranger := &auth.MFA{DB: m.DB, Current: secretbox.NewSealer(secretSeq(99))}
	if err := stranger.VerifyTOTP(context.Background(), uid, mustCode(secret, t0.Add(time.Minute)), t0.Add(time.Minute)); !errors.Is(err, auth.ErrMFAUnavailable) {
		t.Errorf("unknown secret: %v", err)
	}
	// a recovery code still works
	if err := auth.UseRecoveryCode(context.Background(), m.DB, uid, codes[0]); err != nil {
		t.Errorf("recovery code: %v", err)
	}
	none := &auth.MFA{DB: m.DB}
	if _, _, err := none.BeginTOTP(context.Background(), uid, t0); !errors.Is(err, auth.ErrMFAUnavailable) {
		t.Errorf("begin without a secret: %v", err)
	}
}

func TestTOTPSetupKeepsAWorkingSecretUntilConfirmed(t *testing.T) {
	m, uid := mfaFixture(t)
	ctx := context.Background()
	t0 := time.Date(2026, 11, 15, 10, 0, 10, 0, time.UTC)
	old, _ := enrol(t, m, uid, t0)
	later := t0.Add(2 * time.Minute)
	fresh, _, err := m.BeginTOTP(ctx, uid, later)
	if err != nil {
		t.Fatal(err)
	}
	if err := m.VerifyTOTP(ctx, uid, mustCode(old, later), later); err != nil {
		t.Fatalf("the old authenticator stopped working during setup: %v", err)
	}
	// a wrong confirm leaves the old one in place; the pending expires
	if _, err := m.ConfirmTOTP(ctx, uid, "000000", later.Add(time.Minute)); !errors.Is(err, auth.ErrTOTPCodeInvalid) {
		t.Fatal(err)
	}
	if _, err := m.ConfirmTOTP(ctx, uid, mustCode(fresh, later.Add(11*time.Minute)), later.Add(11*time.Minute)); !errors.Is(err, auth.ErrNoPending) {
		t.Errorf("expired pending: %v", err)
	}
	// confirming in time swaps the secret and the recovery codes
	second, _, _ := m.BeginTOTP(ctx, uid, later)
	at2 := later.Add(5 * time.Minute)
	if _, err := m.ConfirmTOTP(ctx, uid, mustCode(second, at2), at2); err != nil {
		t.Fatal(err)
	}
	at3 := at2.Add(time.Minute)
	if err := m.VerifyTOTP(ctx, uid, mustCode(old, at3), at3); !errors.Is(err, auth.ErrTOTPCodeInvalid) {
		t.Errorf("the replaced secret still works: %v", err)
	}
	if err := m.VerifyTOTP(ctx, uid, mustCode(second, at3), at3); err != nil {
		t.Errorf("the new secret: %v", err)
	}
}

func TestRecoveryCodes(t *testing.T) {
	m, uid := mfaFixture(t)
	ctx := context.Background()
	_, codes := enrol(t, m, uid, time.Date(2026, 11, 15, 10, 0, 10, 0, time.UTC))
	if len(codes) != 10 {
		t.Fatalf("%d codes", len(codes))
	}
	seen := map[string]bool{}
	for _, c := range codes {
		if len(c) != 19 || c[4] != '-' || c[9] != '-' || c[14] != '-' || seen[c] {
			t.Fatalf("bad code %q", c)
		}
		seen[c] = true
	}
	var stored string
	m.DB.QueryRow(`SELECT group_concat(code_hash) FROM mfa_recovery_codes WHERE user_id = ?`, uid).Scan(&stored)
	for _, c := range codes {
		if strings.Contains(stored, strings.ReplaceAll(c, "-", "")) {
			t.Fatal("a recovery code is stored in clear text")
		}
	}
	first := codes[0]
	// case, spaces and dashes are ignored
	messy := " " + strings.ToLower(strings.ReplaceAll(first, "-", " ")) + " "
	if err := auth.UseRecoveryCode(ctx, m.DB, uid, messy); err != nil {
		t.Fatalf("messy form: %v", err)
	}
	if err := auth.UseRecoveryCode(ctx, m.DB, uid, first); !errors.Is(err, auth.ErrRecoveryInvalid) {
		t.Errorf("second use: %v", err)
	}
	if left, _ := auth.RecoveryCodesLeft(ctx, m.DB, uid); left != 9 {
		t.Errorf("left = %d", left)
	}
	for _, bad := range []string{"", "ABCD-EFGH", "0000-0000-0000-0000", "ABCD-EFGH-IJKL-MNO!", strings.Repeat("A", 17)} {
		if err := auth.UseRecoveryCode(ctx, m.DB, uid, bad); !errors.Is(err, auth.ErrRecoveryInvalid) {
			t.Errorf("%q: %v", bad, err)
		}
	}
	// another user cannot use mine
	other := mkUser(t, m.DB, "other", false)
	if err := auth.UseRecoveryCode(ctx, m.DB, other, codes[1]); !errors.Is(err, auth.ErrRecoveryInvalid) {
		t.Errorf("someone else's code: %v", err)
	}
	// regenerating deletes the old set
	fresh, err := auth.NewRecoveryCodes(ctx, m.DB, uid)
	if err != nil || len(fresh) != 10 {
		t.Fatal(err)
	}
	if err := auth.UseRecoveryCode(ctx, m.DB, uid, codes[2]); !errors.Is(err, auth.ErrRecoveryInvalid) {
		t.Errorf("old set still works: %v", err)
	}
	// parallel use of one code: one winner
	var wg sync.WaitGroup
	var mu sync.Mutex
	won := 0
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if auth.UseRecoveryCode(ctx, m.DB, uid, fresh[0]) == nil {
				mu.Lock()
				won++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	if won != 1 {
		t.Errorf("%d parallel uses won", won)
	}
}
