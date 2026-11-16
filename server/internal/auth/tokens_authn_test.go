package auth_test

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"qinqin/internal/auth"
)

func bearer(tok string) *http.Request {
	r, _ := http.NewRequest("GET", "/", nil)
	r.Header.Set("Authorization", "Bearer "+tok)
	return r
}

func TestAuthenticateTokenValid(t *testing.T) {
	sqlDB, _, u1, _, ws1, _ := tokenDB(t)
	ctx := context.Background()
	tok, info, err := auth.CreateToken(ctx, sqlDB, u1, req("cron", "write", 30, &ws1))
	if err != nil {
		t.Fatal(err)
	}
	p, err := auth.AuthenticateToken(ctx, sqlDB, tok)
	if err != nil || p == nil {
		t.Fatalf("AuthenticateToken = %v, %v", p, err)
	}
	if p.User.ID != u1 || p.User.Username != "tok-one" || p.Level != auth.LevelFull || p.SessionID != 0 ||
		p.TokenID != info.ID || p.TokenScope != "write" || p.TokenWorkspace == nil || *p.TokenWorkspace != ws1 ||
		!p.ViaToken() || p.Restriction() != "" || p.TemporarySession {
		t.Errorf("principal %+v", p)
	}
	raw, ok := auth.TokenFromRequest(bearer(tok))
	if !ok || raw != tok {
		t.Errorf("TokenFromRequest = %q %v", raw, ok)
	}
	if _, ok := auth.TokenFromRequest(bearer(strings.Repeat("a", 64))); ok {
		t.Error("a session token was taken for an access token")
	}
	var session auth.Principal
	if session.ViaToken() {
		t.Error("a session principal reads as a token")
	}
}

// Matrix 3: malformed, unknown, expired, revoked and disabled-owner tokens
// all resolve to nil, nil (one 401 upstream).
func TestAuthenticateTokenRefusals(t *testing.T) {
	sqlDB, _, u1, u2, _, _ := tokenDB(t)
	ctx := context.Background()
	expired, _, _ := auth.CreateToken(ctx, sqlDB, u1, req("e", "read", 1, nil))
	revoked, rinfo, _ := auth.CreateToken(ctx, sqlDB, u1, req("r", "read", 30, nil))
	if err := auth.RevokeToken(ctx, sqlDB, u1, rinfo.ID); err != nil {
		t.Fatal(err)
	}
	disabled, _, _ := auth.CreateToken(ctx, sqlDB, u2, req("d", "read", 30, nil))
	if _, err := sqlDB.Exec(`UPDATE users SET disabled_at = 't' WHERE id = ?`, u2); err != nil {
		t.Fatal(err)
	}
	restore := auth.SetClockForTest(func() time.Time { return time.Now().Add(25 * time.Hour) })
	defer restore()
	for name, raw := range map[string]string{
		"malformed": "qq_pat_x",
		"upper":     strings.ToUpper(expired),
		"unknown":   "qq_pat_" + strings.Repeat("0", 64),
		"expired":   expired,
		"revoked":   revoked,
		"disabled":  disabled,
		"empty":     "",
	} {
		p, err := auth.AuthenticateToken(ctx, sqlDB, raw)
		if p != nil || err != nil {
			t.Errorf("%s: %+v, %v; want nil, nil", name, p, err)
		}
	}
}

// Matrix 24: a session token never resolves as an access token, nor the
// reverse.
func TestTokenAndSessionNeverCrossResolve(t *testing.T) {
	sqlDB, _, u1, _, _, _ := tokenDB(t)
	ctx := context.Background()
	sess, err := auth.NewSession(ctx, sqlDB, u1, auth.LoginOptions{})
	if err != nil {
		t.Fatal(err)
	}
	pat, _, _ := auth.CreateToken(ctx, sqlDB, u1, req("n", "write", 30, nil))
	if p, err := auth.AuthenticateToken(ctx, sqlDB, sess); p != nil || err != nil {
		t.Errorf("session token as PAT: %+v %v", p, err)
	}
	if p, err := auth.AuthenticateToken(ctx, sqlDB, "qq_pat_"+sess); p != nil || err != nil {
		t.Errorf("prefixed session token as PAT: %+v %v", p, err)
	}
	if p, err := auth.Authenticate(bearer(pat), sqlDB); p != nil || err != nil {
		t.Errorf("PAT as session: %+v %v", p, err)
	}
	// Even a session row whose hash equals the PAT's would not match: the
	// session lookup never runs for a qq_pat_ bearer.
	if _, err := sqlDB.Exec(`INSERT INTO sessions (token_hash, user_id, created_at, last_used_at) VALUES (?, ?, ?, ?)`,
		auth.HashTokenForTest(pat), u1, time.Now().UTC().Format(time.RFC3339), time.Now().UTC().Format(time.RFC3339)); err != nil {
		t.Fatal(err)
	}
	if p, err := auth.Authenticate(bearer(pat), sqlDB); p != nil || err != nil {
		t.Errorf("PAT as session with a colliding row: %+v %v", p, err)
	}
}

// Matrix 16: a forced change flag on the owner restricts the token.
func TestAuthenticateTokenCarriesTheRestriction(t *testing.T) {
	sqlDB, _, u1, _, _, _ := tokenDB(t)
	ctx := context.Background()
	tok, _, _ := auth.CreateToken(ctx, sqlDB, u1, req("n", "read", 30, nil))
	sqlDB.Exec(`UPDATE users SET must_change_password = 1 WHERE id = ?`, u1)
	p, err := auth.AuthenticateToken(ctx, sqlDB, tok)
	if err != nil || p == nil || p.Restriction() != "password_change" {
		t.Fatalf("principal %+v %v", p, err)
	}
}

// Matrix 21: last_used_at is written at most every 5 minutes; the first use
// is audited exactly once under parallel requests.
func TestAuthenticateTokenLastUsed(t *testing.T) {
	sqlDB, _, u1, _, _, _ := tokenDB(t)
	ctx := context.Background()
	start := time.Date(2026, 11, 16, 12, 0, 0, 0, time.UTC)
	cur := start
	var mu sync.Mutex
	restore := auth.SetClockForTest(func() time.Time { mu.Lock(); defer mu.Unlock(); return cur })
	defer restore()
	set := func(t time.Time) { mu.Lock(); cur = t; mu.Unlock() }
	tok, info, _ := auth.CreateToken(ctx, sqlDB, u1, req("n", "read", 30, nil))
	lastUsed := func() string {
		var s *string
		sqlDB.QueryRow(`SELECT last_used_at FROM access_tokens WHERE id = ?`, info.ID).Scan(&s)
		if s == nil {
			return ""
		}
		return *s
	}
	if lastUsed() != "" {
		t.Fatal("fresh token has a last use")
	}
	set(start.Add(time.Minute))
	var wg sync.WaitGroup
	errs := make(chan error, 20)
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			p, err := auth.AuthenticateToken(ctx, sqlDB, tok)
			if err != nil || p == nil {
				errs <- err
			}
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Errorf("parallel use failed: %v", err)
	}
	var n int
	sqlDB.QueryRow(`SELECT COUNT(*) FROM auth_audit WHERE action = 'token_first_used'`).Scan(&n)
	if n != 1 {
		t.Errorf("%d token_first_used rows, want 1", n)
	}
	if got := lastUsed(); got != "2026-11-16T12:01:00Z" {
		t.Errorf("last used %q", got)
	}
	set(start.Add(5 * time.Minute))
	auth.AuthenticateToken(ctx, sqlDB, tok)
	if got := lastUsed(); got != "2026-11-16T12:01:00Z" {
		t.Errorf("written within 5 minutes: %q", got)
	}
	set(start.Add(7 * time.Minute))
	auth.AuthenticateToken(ctx, sqlDB, tok)
	if got := lastUsed(); got != "2026-11-16T12:07:00Z" {
		t.Errorf("not written after 5 minutes: %q", got)
	}
	sqlDB.QueryRow(`SELECT COUNT(*) FROM auth_audit WHERE action = 'token_first_used'`).Scan(&n)
	if n != 1 {
		t.Errorf("%d token_first_used rows after later uses, want 1", n)
	}
}
