package auth_test

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"testing"

	"qinqin/internal/auth"
	"qinqin/internal/db"
)

func usersFixture(t *testing.T) (*sql.DB, *auth.Users) {
	t.Helper()
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	return sqlDB, auth.NewUsers(sqlDB)
}

func mkUser(t *testing.T, sqlDB *sql.DB, name string, admin bool) int64 {
	t.Helper()
	u, err := auth.CreateUser(context.Background(), sqlDB, name, "secret-pass-1", admin)
	if err != nil {
		t.Fatal(err)
	}
	return u.ID
}

func activeAdmins(t *testing.T, sqlDB *sql.DB) int {
	t.Helper()
	var n int
	sqlDB.QueryRow(`SELECT COUNT(*) FROM users WHERE admin = 1 AND disabled_at IS NULL`).Scan(&n)
	return n
}

func TestLastAdminRule(t *testing.T) {
	sqlDB, users := usersFixture(t)
	ctx := context.Background()
	a := mkUser(t, sqlDB, "alice", true)
	// demote the only active admin
	if err := users.SetAdmin(ctx, a, a, false); !errors.Is(err, auth.ErrLastAdmin) {
		t.Fatalf("demote only admin = %v", err)
	}
	if err := users.SetDisabled(ctx, a, a, true); !errors.Is(err, auth.ErrLastAdmin) {
		t.Fatalf("disable only admin = %v", err)
	}
	if activeAdmins(t, sqlDB) != 1 {
		t.Fatal("state changed on a refused call")
	}
	b := mkUser(t, sqlDB, "bobby", true)
	if err := users.SetAdmin(ctx, a, a, false); err != nil {
		t.Fatalf("demote one of two = %v", err)
	}
	if err := users.SetAdmin(ctx, a, b, false); !errors.Is(err, auth.ErrLastAdmin) {
		t.Fatalf("demote the other = %v", err)
	}
	// A disabled admin is counted out: promote a again, disable b: allowed; then a is last.
	users.SetAdmin(ctx, b, a, true)
	if err := users.SetDisabled(ctx, a, b, true); err != nil {
		t.Fatalf("disable b = %v", err)
	}
	if err := users.SetAdmin(ctx, a, a, false); !errors.Is(err, auth.ErrLastAdmin) {
		t.Fatalf("demote a while b is disabled = %v (a disabled admin must not count)", err)
	}
	if err := users.SetAdmin(ctx, a, 9999, true); !errors.Is(err, auth.ErrUserNotFound) {
		t.Fatalf("unknown user = %v", err)
	}
}

func TestDisableDeletesSessionsAndEnableNeverResurrects(t *testing.T) {
	sqlDB, users := usersFixture(t)
	ctx := context.Background()
	a := mkUser(t, sqlDB, "alice", true)
	b := mkUser(t, sqlDB, "bobby", false)
	var tokens []string
	for i := 0; i < 3; i++ {
		tok, _ := auth.NewSession(ctx, sqlDB, b, auth.LoginOptions{})
		tokens = append(tokens, tok)
	}
	if err := users.SetDisabled(ctx, a, b, true); err != nil {
		t.Fatal(err)
	}
	var n int
	sqlDB.QueryRow(`SELECT COUNT(*) FROM sessions WHERE user_id = ?`, b).Scan(&n)
	if n != 0 {
		t.Errorf("sessions left after disable: %d", n)
	}
	if err := users.SetDisabled(ctx, a, b, false); err != nil {
		t.Fatal(err)
	}
	for _, tok := range tokens {
		r := newReq(tok)
		if p, err := auth.Authenticate(r, sqlDB); err != nil || p != nil {
			t.Errorf("old token authenticates after re-enable: %v %v", p, err)
		}
	}
}

func TestForcePasswordChangeDeletesAllSessions(t *testing.T) {
	sqlDB, users := usersFixture(t)
	ctx := context.Background()
	a := mkUser(t, sqlDB, "alice", true)
	b := mkUser(t, sqlDB, "bobby", false)
	for i := 0; i < 3; i++ {
		auth.NewSession(ctx, sqlDB, b, auth.LoginOptions{})
	}
	if err := users.ForcePasswordChange(ctx, a, b); err != nil {
		t.Fatal(err)
	}
	var n int
	sqlDB.QueryRow(`SELECT COUNT(*) FROM sessions WHERE user_id = ?`, b).Scan(&n)
	if n != 0 {
		t.Errorf("sessions left: %d", n)
	}
	tok, _ := auth.NewSession(ctx, sqlDB, b, auth.LoginOptions{})
	p, err := auth.Authenticate(newReq(tok), sqlDB)
	if err != nil || p == nil || !p.TemporarySession {
		t.Errorf("session after the force is not the temporary one: %+v %v", p, err)
	}
}

// Two admins, two services (two mutexes): the guarded statement alone must
// keep one active admin standing.
func TestLastAdminRaceKeepsOneActiveAdmin(t *testing.T) {
	sqlDB, _ := usersFixture(t)
	ctx := context.Background()
	a := mkUser(t, sqlDB, "alice", true)
	b := mkUser(t, sqlDB, "bobby", true)
	u1, u2 := auth.NewUsers(sqlDB), auth.NewUsers(sqlDB)
	for round := 0; round < 50; round++ {
		sqlDB.Exec(`UPDATE users SET admin = 1, disabled_at = NULL`)
		var e1, e2 error
		var wg sync.WaitGroup
		wg.Add(2)
		if round%2 == 0 {
			go func() { defer wg.Done(); e1 = u1.SetAdmin(ctx, a, a, false) }()
			go func() { defer wg.Done(); e2 = u2.SetAdmin(ctx, b, b, false) }()
		} else {
			go func() { defer wg.Done(); e1 = u1.SetDisabled(ctx, b, a, true) }()
			go func() { defer wg.Done(); e2 = u2.SetAdmin(ctx, a, b, false) }()
		}
		wg.Wait()
		ok := 0
		for _, e := range []error{e1, e2} {
			switch {
			case e == nil:
				ok++
			case !errors.Is(e, auth.ErrLastAdmin):
				t.Fatalf("round %d: unexpected %v", round, e)
			}
		}
		if ok != 1 {
			t.Fatalf("round %d: %d calls succeeded (%v, %v), want exactly one", round, ok, e1, e2)
		}
		if activeAdmins(t, sqlDB) < 1 {
			t.Fatalf("round %d: no active admin left", round)
		}
	}
}

func newReq(token string) *http.Request {
	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("Authorization", "Bearer "+token)
	return r
}
