package auth_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"path/filepath"
	"testing"

	"qinqin/internal/auth"
	"qinqin/internal/db"
)

func TestSessionStoresOnlyTheHash(t *testing.T) {
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	u, err := auth.CreateUser(context.Background(), sqlDB, "alice", "secret-pass-1", false)
	if err != nil {
		t.Fatal(err)
	}
	tok, err := auth.NewSession(context.Background(), sqlDB, u.ID, auth.LoginOptions{Device: "  Pixel\x00 8  "})
	if err != nil {
		t.Fatal(err)
	}
	if len(tok) != 64 {
		t.Errorf("token length = %d, want 64 hex chars", len(tok))
	}
	var stored, device, level string
	if err := sqlDB.QueryRow(`SELECT token_hash, device, level FROM sessions`).Scan(&stored, &device, &level); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256([]byte(tok))
	if stored == tok || stored != hex.EncodeToString(sum[:]) {
		t.Errorf("stored = %q, want sha256 of the token only", stored)
	}
	if device != "Pixel 8" || level != "full" {
		t.Errorf("device %q level %q", device, level)
	}
	r, _ := http.NewRequest("GET", "/", nil)
	r.Header.Set("Authorization", "Bearer "+tok)
	p, err := auth.Authenticate(r, sqlDB)
	if err != nil || p == nil || p.User.Username != "alice" || p.Level != "full" || p.Restriction() != "" {
		t.Fatalf("Authenticate = %+v, %v", p, err)
	}
}

func TestRestriction(t *testing.T) {
	cases := []struct {
		must  bool
		level string
		want  string
	}{
		{false, "full", ""},
		{true, "full", "password_change"},
		{false, "enroll", "mfa_enrollment"},
		{true, "enroll", "password_change"}, // the temporary password goes first
	}
	for _, c := range cases {
		p := &auth.Principal{Level: c.level}
		p.User.MustChangePassword = c.must
		if got := p.Restriction(); got != c.want {
			t.Errorf("must=%v level=%s: %q, want %q", c.must, c.level, got, c.want)
		}
	}
}

func TestRevokeAndList(t *testing.T) {
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	ctx := context.Background()
	a, _ := auth.CreateUser(ctx, sqlDB, "alice", "secret-pass-1", false)
	b, _ := auth.CreateUser(ctx, sqlDB, "bobby", "secret-pass-1", false)
	for i := 0; i < 3; i++ {
		if _, err := auth.NewSession(ctx, sqlDB, a.ID, auth.LoginOptions{}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := auth.NewSession(ctx, sqlDB, b.ID, auth.LoginOptions{Device: "Firefox on Linux"}); err != nil {
		t.Fatal(err)
	}
	list, err := auth.ListSessions(ctx, sqlDB, a.ID)
	if err != nil || len(list) != 3 {
		t.Fatalf("list = %v, %v", list, err)
	}
	if list[0].Device != "Unknown device" {
		t.Errorf("empty device shown as %q, want Unknown device", list[0].Device)
	}
	bList, _ := auth.ListSessions(ctx, sqlDB, b.ID)
	// Another user's session id is not revocable.
	if ok, _ := auth.RevokeSession(ctx, sqlDB, a.ID, bList[0].ID); ok {
		t.Error("revoked another user's session")
	}
	n, err := auth.RevokeSessions(ctx, sqlDB, a.ID, list[0].ID)
	if err != nil || n != 2 {
		t.Fatalf("revoke others = %d, %v, want 2", n, err)
	}
	if ok, _ := auth.RevokeSession(ctx, sqlDB, a.ID, list[0].ID); !ok {
		t.Error("own session not revoked")
	}
	if rest, _ := auth.ListSessions(ctx, sqlDB, b.ID); len(rest) != 1 {
		t.Errorf("bob's sessions = %d, want 1", len(rest))
	}
}

// The revoke and its audit row are one transaction: when the audit write
// fails nothing is revoked.
func TestRevokeAndAuditAreAtomic(t *testing.T) {
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	ctx := context.Background()
	a, _ := auth.CreateUser(ctx, sqlDB, "alice", "secret-pass-1", false)
	for i := 0; i < 3; i++ {
		auth.NewSession(ctx, sqlDB, a.ID, auth.LoginOptions{})
	}
	list, _ := auth.ListSessions(ctx, sqlDB, a.ID)
	if n, err := auth.RevokeOthersAudited(ctx, sqlDB, a.ID, list[0].ID, "others"); err != nil || n != 2 {
		t.Fatalf("others = %d, %v", n, err)
	}
	var rows int
	sqlDB.QueryRow(`SELECT COUNT(*) FROM auth_audit WHERE action = 'sessions_revoked'`).Scan(&rows)
	if rows != 1 {
		t.Errorf("audit rows = %d, want 1", rows)
	}
	sqlDB.Exec(`DROP TABLE auth_audit`)
	if _, err := auth.RevokeOthersAudited(ctx, sqlDB, a.ID, 0, "all"); err == nil {
		t.Fatal("revoke succeeded although the audit write failed")
	}
	if ok, err := auth.RevokeSessionAudited(ctx, sqlDB, a.ID, list[0].ID); err == nil || ok {
		t.Errorf("single revoke = %v, %v; want an error", ok, err)
	}
	if left, _ := auth.ListSessions(ctx, sqlDB, a.ID); len(left) != 1 {
		t.Errorf("sessions left = %d, want the one that was never revoked", len(left))
	}
}
