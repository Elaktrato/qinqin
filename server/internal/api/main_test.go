package api_test

import (
	"os"
	"testing"

	"qinqin/internal/auth"
)

// TestMain lowers the argon2id cost for the api tests: they create a few
// hundred users, and at the production parameters (64 MiB, 3 passes)
// hashing was most of the package's CPU time. Verify reads the parameters
// from each stored hash, so nothing else changes.
// TestRegisterAndLoginAtTheProductionHashCost keeps one sign-up and login on
// the real parameters, and the auth package's own tests run on them.
func TestMain(m *testing.M) {
	auth.SetHashCostForTests(64, 1)
	os.Exit(m.Run())
}
