package auth

import "time"

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
