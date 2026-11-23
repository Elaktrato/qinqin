package api_test

import (
	"strings"
	"testing"

	"qinqin/internal/auth"
)

// The api tests run at a lowered hash cost (main_test.go); this one signs up
// and in at the production parameters.
func TestRegisterAndLoginAtTheProductionHashCost(t *testing.T) {
	restore := auth.SetHashCostForTests(0, 0)
	defer restore()
	ts, sqlDB := newServer(t)
	token := registerUser(t, ts.URL, "realcost", "")
	if token == "" {
		t.Fatal("no token")
	}
	var hash string
	if err := sqlDB.QueryRow(`SELECT hash FROM users WHERE username = 'realcost'`).Scan(&hash); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(hash, "$m=65536,t=3,p=4$") {
		t.Errorf("stored hash %q, want the production parameters", hash)
	}
}
