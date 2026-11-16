package auth

import (
	"context"
	"database/sql"
	"time"
)

// SetVerifierForTest swaps the password verifier Login uses and returns a
// restore func, so a test can observe that Login verifies at all.
func SetVerifierForTest(f func(hash, password string) bool) (restore func()) {
	orig := verifyPassword
	verifyPassword = f
	return func() { verifyPassword = orig }
}

// HashTokenForTest exposes the stored form of a token.
func HashTokenForTest(token string) string { return hashToken(token) }

// SetClockForTest replaces the session clock and returns a restore func.
func SetClockForTest(f func() time.Time) (restore func()) {
	old := nowFunc
	nowFunc = f
	return func() { nowFunc = old }
}

// HOTPForTest exposes the HOTP primitive for the RFC vectors.
func HOTPForTest(secret []byte, counter uint64, digits int) string {
	return hotp(secret, counter, digits)
}

// TokenHintForTest exposes the hint derivation of an access token.
func TokenHintForTest(token string) string { return tokenHint(token) }

// CreateTokenUnlimitedForTest is CreateToken without the live-token cap,
// for tests that mint many tokens.
func CreateTokenUnlimitedForTest(ctx context.Context, sqlDB *sql.DB, userID int64, req TokenRequest) (string, TokenInfo, error) {
	old := maxLiveTokens
	maxLiveTokens = 1 << 30
	defer func() { maxLiveTokens = old }()
	return CreateToken(ctx, sqlDB, userID, req)
}
