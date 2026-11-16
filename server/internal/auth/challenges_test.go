package auth_test

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"qinqin/internal/auth"
)

func TestCodeIsSixDigitsAndUniform(t *testing.T) {
	sqlDB, _ := usersFixture(t)
	ctx := context.Background()
	uid := mkUser(t, sqlDB, "carol", false)
	counts := [10]int{}
	const n = 300
	for i := 0; i < n; i++ {
		_, ch, err := auth.NewChallenge(ctx, sqlDB, auth.ChallengeMFA, &uid, "", "")
		if err != nil {
			t.Fatal(err)
		}
		code, err := auth.SetCode(ctx, sqlDB, ch.ID)
		if err != nil {
			t.Fatal(err)
		}
		if !auth.IsSixDigits(code) {
			t.Fatalf("code %q is not six digits", code)
		}
		counts[code[0]-'0']++
	}
	for d, c := range counts { // 30 expected; a broken generator (modulo bias, a fixed digit) shows up wildly
		if c < 8 || c > 60 {
			t.Errorf("first digit %d occurs %d of %d times", d, c, n)
		}
	}
}

func TestStoredHashIsNotTheCodeAndIsBoundToTheChallenge(t *testing.T) {
	sqlDB, _ := usersFixture(t)
	ctx := context.Background()
	uid := mkUser(t, sqlDB, "carol", false)
	tokA, a, _ := auth.NewChallenge(ctx, sqlDB, auth.ChallengeMFA, &uid, "", "")
	tokB, b, _ := auth.NewChallenge(ctx, sqlDB, auth.ChallengeMFA, &uid, "", "")
	code, _ := auth.SetCode(ctx, sqlDB, a.ID)
	var stored string
	sqlDB.QueryRow(`SELECT code_hash FROM auth_challenges WHERE id = ?`, a.ID).Scan(&stored)
	if stored == "" || strings.Contains(stored, code) {
		t.Fatalf("stored hash %q", stored)
	}
	var tokenHash string
	sqlDB.QueryRow(`SELECT token_hash FROM auth_challenges WHERE id = ?`, a.ID).Scan(&tokenHash)
	if tokenHash == tokA {
		t.Error("token stored in clear text")
	}
	// the same code does not open another challenge
	sqlDB.Exec(`UPDATE auth_challenges SET code_hash = (SELECT code_hash FROM auth_challenges WHERE id = ?) WHERE id = ?`, a.ID, b.ID)
	if _, err := auth.VerifyCode(ctx, sqlDB, tokB, code); err == nil {
		t.Error("a hash copied to another challenge verified")
	}
	if _, err := auth.VerifyCode(ctx, sqlDB, tokA, code); err != nil {
		t.Errorf("right code: %v", err)
	}
}

func TestFiveWrongCodesKillTheChallengeAndResendKeepsTheCount(t *testing.T) {
	sqlDB, _ := usersFixture(t)
	ctx := context.Background()
	uid := mkUser(t, sqlDB, "carol", false)
	clock := time.Date(2026, 11, 15, 10, 0, 0, 0, time.UTC)
	defer auth.SetClockForTest(func() time.Time { return clock })()
	tok, ch, _ := auth.NewChallenge(ctx, sqlDB, auth.ChallengeMFA, &uid, "", "")
	code, _ := auth.SetCode(ctx, sqlDB, ch.ID)
	wrong := "000000"
	if code == wrong {
		wrong = "111111"
	}
	for i := 1; i <= 2; i++ {
		_, err := auth.VerifyCode(ctx, sqlDB, tok, wrong)
		var ce *auth.CodeError
		if !errors.As(err, &ce) || !errors.Is(err, auth.ErrCodeWrong) || ce.AttemptsLeft != 5-i {
			t.Fatalf("attempt %d: %v", i, err)
		}
	}
	// a resend (after 60 s) does not reset the attempts
	clock = clock.Add(61 * time.Second)
	code, err := auth.SetCode(ctx, sqlDB, ch.ID)
	if err != nil {
		t.Fatal(err)
	}
	if wrong == code {
		wrong = "222222"
	}
	for i := 3; i <= 4; i++ {
		_, err := auth.VerifyCode(ctx, sqlDB, tok, wrong)
		var ce *auth.CodeError
		if !errors.As(err, &ce) || ce.AttemptsLeft != 5-i {
			t.Fatalf("attempt %d after resend: %v", i, err)
		}
	}
	if _, err := auth.VerifyCode(ctx, sqlDB, tok, wrong); !errors.Is(err, auth.ErrChallengeInvalid) {
		t.Fatalf("fifth wrong code: %v", err)
	}
	// even the right code no longer works: the challenge is gone
	if _, err := auth.VerifyCode(ctx, sqlDB, tok, code); !errors.Is(err, auth.ErrChallengeInvalid) {
		t.Fatalf("right code after exhaustion: %v", err)
	}
	// non-numeric input is refused without comparing, and still counts
	tok2, ch2, _ := auth.NewChallenge(ctx, sqlDB, auth.ChallengeMFA, &uid, "", "")
	auth.SetCode(ctx, sqlDB, ch2.ID)
	_, err = auth.VerifyCode(ctx, sqlDB, tok2, "12345")
	var ce *auth.CodeError
	if !errors.As(err, &ce) || ce.AttemptsLeft != 4 {
		t.Fatalf("short code: %v", err)
	}
}

func TestSendLimits(t *testing.T) {
	sqlDB, _ := usersFixture(t)
	ctx := context.Background()
	uid := mkUser(t, sqlDB, "carol", false)
	clock := time.Date(2026, 11, 15, 10, 0, 0, 0, time.UTC)
	defer auth.SetClockForTest(func() time.Time { return clock })()
	_, ch, _ := auth.NewChallenge(ctx, sqlDB, auth.ChallengeEmailLogin, &uid, "", "")
	if _, err := auth.SetCode(ctx, sqlDB, ch.ID); err != nil {
		t.Fatal(err)
	}
	_, err := auth.SetCode(ctx, sqlDB, ch.ID)
	var ce *auth.CodeError
	if !errors.As(err, &ce) || !errors.Is(err, auth.ErrResendTooSoon) || ce.Retry <= 0 || ce.Retry > 60*time.Second {
		t.Fatalf("immediate resend: %v", err)
	}
	for i := 0; i < 2; i++ {
		clock = clock.Add(61 * time.Second)
		if _, err := auth.SetCode(ctx, sqlDB, ch.ID); err != nil {
			t.Fatalf("send %d: %v", i+2, err)
		}
	}
	clock = clock.Add(61 * time.Second)
	if _, err := auth.SetCode(ctx, sqlDB, ch.ID); !errors.Is(err, auth.ErrTooManySends) {
		t.Fatalf("4th send: %v", err)
	}
	clock = clock.Add(time.Hour)
	if _, err := auth.SetCode(ctx, sqlDB, ch.ID); !errors.Is(err, auth.ErrChallengeInvalid) {
		t.Fatalf("send on an expired challenge: %v", err)
	}
}

func TestOneRightCodeInParallelSucceedsOnce(t *testing.T) {
	sqlDB, _ := usersFixture(t)
	ctx := context.Background()
	uid := mkUser(t, sqlDB, "carol", false)
	tok, ch, _ := auth.NewChallenge(ctx, sqlDB, auth.ChallengeMFA, &uid, "", "")
	code, _ := auth.SetCode(ctx, sqlDB, ch.ID)
	var wg sync.WaitGroup
	var mu sync.Mutex
	ok := 0
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := auth.VerifyCode(ctx, sqlDB, tok, code); err == nil {
				mu.Lock()
				ok++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	if ok != 1 {
		t.Fatalf("%d verifications succeeded, want 1", ok)
	}
}

func TestChallengeForAnUnknownIdentifierNeverVerifies(t *testing.T) {
	sqlDB, _ := usersFixture(t)
	ctx := context.Background()
	tok, ch, err := auth.NewChallenge(ctx, sqlDB, auth.ChallengeEmailLogin, nil, "", "")
	if err != nil {
		t.Fatal(err)
	}
	code, err := auth.SetCode(ctx, sqlDB, ch.ID) // same path as a known one
	if err != nil {
		t.Fatal(err)
	}
	c, err := auth.VerifyCode(ctx, sqlDB, tok, code)
	if err != nil || c.UserID != 0 {
		t.Fatalf("verify = %+v, %v (the caller must treat user 0 as a failure)", c, err)
	}
}

func TestExpiredChallengesArePruned(t *testing.T) {
	sqlDB, _ := usersFixture(t)
	ctx := context.Background()
	uid := mkUser(t, sqlDB, "carol", false)
	auth.NewChallenge(ctx, sqlDB, auth.ChallengeMFA, &uid, "", "")
	if _, _, err := auth.Prune(ctx, sqlDB, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	var n int
	sqlDB.QueryRow(`SELECT COUNT(*) FROM auth_challenges`).Scan(&n)
	if n != 0 {
		t.Errorf("%d challenges left", n)
	}
}
