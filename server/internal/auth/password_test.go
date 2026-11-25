package auth_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"qinqin/internal/auth"
	"qinqin/internal/dbtest"
)

func TestChangePasswordIsOneTransaction(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	u, _ := auth.CreateUser(ctx, sqlDB, "alice", "secret-pass-1", false)
	keep, _ := auth.NewSession(ctx, sqlDB, u.ID, auth.LoginOptions{})
	for i := 0; i < 2; i++ {
		auth.NewSession(ctx, sqlDB, u.ID, auth.LoginOptions{})
	}
	sqlDB.Exec(`UPDATE users SET must_change_password = 1, must_change_after = 0 WHERE id = ?`, u.ID)
	var keepID int64
	sqlDB.QueryRow(`SELECT id FROM sessions WHERE token_hash = ?`, auth.HashTokenForTest(keep)).Scan(&keepID)

	newHash := auth.Hash("a-brand-new-password")
	if err := auth.ChangePassword(ctx, sqlDB, u.ID, newHash, keepID, true); err != nil {
		t.Fatal(err)
	}
	var must int
	var setAt, changedAt, hash *string
	sqlDB.QueryRow(`SELECT must_change_password, must_change_after, password_changed_at, hash FROM users WHERE id = ?`, u.ID).Scan(&must, &setAt, &changedAt, &hash)
	if must != 0 || setAt != nil || changedAt == nil || *hash != newHash {
		t.Errorf("user = must %d set %v changed %v", must, setAt, changedAt)
	}
	var n int
	sqlDB.QueryRow(`SELECT COUNT(*) FROM sessions WHERE user_id = ?`, u.ID).Scan(&n)
	if n != 1 {
		t.Errorf("sessions left = %d, want only the caller's", n)
	}
	var action, detail string
	if err := sqlDB.QueryRow(`SELECT action, detail FROM auth_audit`).Scan(&action, &detail); err != nil || action != "password_changed" {
		t.Errorf("audit = %q, %v", action, err)
	}
	if !auth.Verify(*hash, "a-brand-new-password") {
		t.Error("stored hash does not verify the new password")
	}
}

func TestVerifyUserPassword(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	u, _ := auth.CreateUser(ctx, sqlDB, "alice", "secret-pass-1", false)
	if ok, err := auth.VerifyUserPassword(ctx, sqlDB, u.ID, "secret-pass-1"); !ok || err != nil {
		t.Errorf("right password: %v %v", ok, err)
	}
	if ok, _ := auth.VerifyUserPassword(ctx, sqlDB, u.ID, "wrong-password"); ok {
		t.Error("wrong password verified")
	}
}

func TestForcePasswordChangeRevokesEverythingAndSetsAWatermark(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	u, _ := auth.CreateUser(ctx, sqlDB, "alice", "secret-pass-1", false)
	admin, _ := auth.CreateUser(ctx, sqlDB, "admin1", "secret-pass-1", true)
	for i := 0; i < 3; i++ {
		auth.NewSession(ctx, sqlDB, u.ID, auth.LoginOptions{})
	}
	other, _ := auth.NewSession(ctx, sqlDB, admin.ID, auth.LoginOptions{})
	if err := auth.ForcePasswordChange(ctx, sqlDB, u.ID, admin.ID); err != nil {
		t.Fatal(err)
	}
	var n int
	sqlDB.QueryRow(`SELECT COUNT(*) FROM sessions WHERE user_id = ?`, u.ID).Scan(&n)
	if n != 0 {
		t.Errorf("%d sessions of the user survive a forced change", n)
	}
	if r, _ := auth.Authenticate(reqWith(other), sqlDB); r == nil {
		t.Error("another user's session was touched")
	}
	// The login after the force is born from the temporary password, even
	// in the same second as the force and even if the clock stepped back.
	restore := auth.SetClockForTest(func() time.Time { return time.Now().Add(-48 * time.Hour) })
	tok, _ := auth.NewSession(ctx, sqlDB, u.ID, auth.LoginOptions{})
	restore()
	p, _ := auth.Authenticate(reqWith(tok), sqlDB)
	if p == nil || !p.TemporarySession || p.Restriction() != "password_change" {
		t.Fatalf("post-force session = %+v", p)
	}
	// A session with an id at or below the watermark is never temporary,
	// whatever its timestamp says (a hand-made survivor).
	var wm int64
	sqlDB.QueryRow(`SELECT must_change_after FROM users WHERE id = ?`, u.ID).Scan(&wm)
	if _, err := sqlDB.Exec(`INSERT INTO sessions (id, token_hash, user_id, created_at, last_used_at) VALUES (?, 'survivor', ?, '2999-01-01T00:00:00Z', '2999-01-01T00:00:00Z')`, wm-1, u.ID); err != nil {
		t.Fatal(err)
	}
	sqlDB.Exec(`UPDATE sessions SET token_hash = ? WHERE token_hash = 'survivor'`, auth.HashTokenForTest("survivor-token"))
	if p, _ := auth.Authenticate(reqWith("survivor-token"), sqlDB); p == nil || p.TemporarySession {
		t.Errorf("survivor = %+v, want authenticated but not temporary", p)
	}
	var action string
	if err := sqlDB.QueryRow(`SELECT action FROM auth_audit WHERE action = 'password_change_forced'`).Scan(&action); err != nil {
		t.Errorf("no audit row: %v", err)
	}
}

func reqWith(token string) *http.Request {
	r, _ := http.NewRequest("GET", "/", nil)
	r.Header.Set("Authorization", "Bearer "+token)
	return r
}
