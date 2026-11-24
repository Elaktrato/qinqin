package auth_test

import (
	"context"
	"errors"
	"testing"

	"qinqin/internal/auth"
	"qinqin/internal/dbtest"
)

func TestUserLookups(t *testing.T) {
	ctx, sqlDB := context.Background(), dbtest.Open(t)
	if n, err := auth.CountUsers(ctx, sqlDB); err != nil || n != 0 {
		t.Fatalf("CountUsers = %d, %v", n, err)
	}
	ann, bob := dbtest.User(t, sqlDB, "ann"), dbtest.User(t, sqlDB, "bob")
	if _, err := sqlDB.Exec(`UPDATE users SET admin = 1 WHERE id = ?`, ann); err != nil {
		t.Fatal(err)
	}
	if _, err := sqlDB.Exec(`UPDATE users SET disabled_at = 't' WHERE id = ?`, bob); err != nil {
		t.Fatal(err)
	}
	if n, err := auth.CountUsers(ctx, sqlDB); err != nil || n != 2 {
		t.Errorf("CountUsers = %d, %v; disabled users count", n, err)
	}
	if u, err := auth.ActiveUser(ctx, sqlDB, ann); err != nil || u != (auth.ActiveUserInfo{Username: "ann", Admin: true}) {
		t.Errorf("ActiveUser(ann) = %+v, %v", u, err)
	}
	for _, id := range []int64{bob, 999} {
		if _, err := auth.ActiveUser(ctx, sqlDB, id); !errors.Is(err, auth.ErrUserNotFound) {
			t.Errorf("ActiveUser(%d) = %v, want ErrUserNotFound", id, err)
		}
	}
	if name, err := auth.Username(ctx, sqlDB, bob); err != nil || name != "bob" {
		t.Errorf("Username(bob) = %q, %v; a disabled user keeps a name", name, err)
	}
	if _, err := auth.Username(ctx, sqlDB, 999); !errors.Is(err, auth.ErrUserNotFound) {
		t.Errorf("Username(999) = %v", err)
	}
	for id, want := range map[int64]bool{ann: false, bob: true} {
		if got, err := auth.Disabled(ctx, sqlDB, id); err != nil || got != want {
			t.Errorf("Disabled(%d) = %v, %v; want %v", id, got, err, want)
		}
	}
	if _, err := auth.Disabled(ctx, sqlDB, 999); !errors.Is(err, auth.ErrUserNotFound) {
		t.Errorf("Disabled(999) = %v", err)
	}
}

func TestAuditPage(t *testing.T) {
	ctx, sqlDB := context.Background(), dbtest.Open(t)
	if p, err := auth.AuditPage(ctx, sqlDB, 0, 10); err != nil || p.Records == nil || len(p.Records) != 0 || p.Next != nil {
		t.Fatalf("empty = %#v, %v", p, err)
	}
	ann := dbtest.User(t, sqlDB, "ann")
	for _, e := range []auth.AuditEvent{
		{Action: "a1", ActorID: ann, TargetID: &ann, Detail: map[string]any{"scope": "x"}},
		{Action: "a2", ActorName: "cli"},
		{Action: "a3", ActorID: ann},
	} {
		if err := auth.Audit(ctx, sqlDB, e); err != nil {
			t.Fatal(err)
		}
	}
	p, err := auth.AuditPage(ctx, sqlDB, 0, 2)
	if err != nil || len(p.Records) != 2 || p.Records[0].Action != "a3" || p.Records[1].Action != "a2" || p.Next == nil || *p.Next != p.Records[1].ID {
		t.Fatalf("first page = %+v, %v", p, err)
	}
	if r := p.Records[1]; r.ActorID != nil || r.ActorName != "cli" || r.TargetID != nil || string(r.Detail) != "{}" || r.At == "" {
		t.Errorf("system event = %+v", r)
	}
	p, err = auth.AuditPage(ctx, sqlDB, *p.Next, 2)
	if err != nil || len(p.Records) != 1 || p.Next != nil {
		t.Fatalf("last page = %+v, %v", p, err)
	}
	r := p.Records[0]
	if r.Action != "a1" || r.ActorID == nil || *r.ActorID != ann || r.ActorName != "ann" || r.TargetID == nil || r.TargetName != "ann" || string(r.Detail) != `{"scope":"x"}` {
		t.Errorf("event = %+v (detail %s)", r, r.Detail)
	}
}

func TestDisableTOTPIsAudited(t *testing.T) {
	ctx, sqlDB := context.Background(), dbtest.Open(t)
	ann := dbtest.User(t, sqlDB, "ann")
	for _, q := range []string{
		`INSERT INTO mfa_totp (user_id, secret_ct, secret_nonce, secret_fp, confirmed_at, created_at) VALUES (?1, x'00', x'00', 'fp', 't', 't')`,
		`INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES (?1, 'rc')`,
	} {
		if _, err := sqlDB.Exec(q, ann); err != nil {
			t.Fatal(err)
		}
	}
	if err := auth.DisableTOTP(ctx, sqlDB, ann); err != nil {
		t.Fatal(err)
	}
	var totp, codes, audits int
	sqlDB.QueryRow(`SELECT COUNT(*) FROM mfa_totp`).Scan(&totp)
	sqlDB.QueryRow(`SELECT COUNT(*) FROM mfa_recovery_codes`).Scan(&codes)
	sqlDB.QueryRow(`SELECT COUNT(*) FROM auth_audit WHERE action = 'mfa_disabled' AND actor_id = ?1 AND target_id = ?1 AND detail = '{"scope":"totp"}'`, ann).Scan(&audits)
	if totp != 0 || codes != 0 || audits != 1 {
		t.Errorf("totp %d, codes %d, audit rows %d; want 0, 0, 1", totp, codes, audits)
	}
}
