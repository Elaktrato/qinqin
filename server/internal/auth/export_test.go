package auth

// SetVerifierForTest swaps the password verifier Login uses and returns a
// restore func, so a test can observe that Login verifies at all.
func SetVerifierForTest(f func(hash, password string) bool) (restore func()) {
	orig := verifyPassword
	verifyPassword = f
	return func() { verifyPassword = orig }
}
