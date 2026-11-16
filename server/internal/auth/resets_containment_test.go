package auth_test

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"qinqin/internal/auth"
)

// A pending reset link is a second way into the account: every action that
// contains the account (password change, forced change, disable, sign out
// everywhere, CLI recovery, a two-step sign-in reset) must kill it in the same transaction.
func TestContainmentActionsKillPendingResetLinks(t *testing.T) {
	ctx := context.Background()
	actions := map[string]func(*sql.DB, *auth.Users, int64, int64) error{
		"ChangePassword": func(d *sql.DB, _ *auth.Users, _, id int64) error {
			return auth.ChangePassword(ctx, d, id, auth.Hash("a-new-long-password"), 0, false)
		},
		"ForcePasswordChange": func(_ *sql.DB, u *auth.Users, admin, id int64) error { return u.ForcePasswordChange(ctx, admin, id) },
		"SetDisabled":         func(_ *sql.DB, u *auth.Users, admin, id int64) error { return u.SetDisabled(ctx, admin, id, true) },
		"RevokeAllSessions": func(_ *sql.DB, u *auth.Users, admin, id int64) error {
			_, err := u.RevokeAllSessions(ctx, admin, id)
			return err
		},
		"RevokeOthersAudited": func(d *sql.DB, _ *auth.Users, _, id int64) error {
			_, err := auth.RevokeOthersAudited(ctx, d, id, 0, "all")
			return err
		},
		"RecoverAccount": func(d *sql.DB, _ *auth.Users, _, id int64) error {
			var name string
			d.QueryRow(`SELECT username FROM users WHERE id = ?`, id).Scan(&name)
			_, err := auth.RecoverAccount(ctx, d, auth.RecoverOptions{Username: name, Hash: auth.Hash("recovered-temp-pw-1")})
			return err
		},
		"RevokePendingResets": func(_ *sql.DB, u *auth.Users, admin, id int64) error { return u.RevokePendingResets(ctx, admin, id) },
		"ResetUserMFA":        func(_ *sql.DB, u *auth.Users, admin, id int64) error { return u.ResetUserMFA(ctx, admin, id) },
	}
	for name, act := range actions {
		sqlDB, users := usersFixture(t)
		admin := mkUser(t, sqlDB, "alice", true)
		victim := mkUser(t, sqlDB, "victim", false)
		tok, _, err := auth.IssueReset(ctx, sqlDB, admin, victim, time.Hour)
		if err != nil {
			t.Fatal(err)
		}
		if _, _, err := auth.CheckReset(ctx, sqlDB, tok); err != nil {
			t.Fatalf("%s: fresh link unusable: %v", name, err)
		}
		if err := act(sqlDB, users, admin, victim); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if _, _, err := auth.CheckReset(ctx, sqlDB, tok); !errors.Is(err, auth.ErrTokenInvalid) {
			t.Errorf("%s: pending link still checks out (%v)", name, err)
		}
		if _, err := auth.UseReset(ctx, sqlDB, tok, auth.Hash("attacker-chosen-pw-1")); !errors.Is(err, auth.ErrTokenInvalid) {
			t.Errorf("%s: pending link still usable (%v)", name, err)
		}
	}
}

func TestDisableThenEnableDoesNotReviveALink(t *testing.T) {
	ctx := context.Background()
	sqlDB, users := usersFixture(t)
	admin := mkUser(t, sqlDB, "alice", true)
	victim := mkUser(t, sqlDB, "victim", false)
	tok, _, _ := auth.IssueReset(ctx, sqlDB, admin, victim, time.Hour)
	users.SetDisabled(ctx, admin, victim, true)
	users.SetDisabled(ctx, admin, victim, false)
	if _, _, err := auth.CheckReset(ctx, sqlDB, tok); !errors.Is(err, auth.ErrTokenInvalid) {
		t.Errorf("link revived by disable+enable: %v", err)
	}
}

func TestUsingOneLinkLeavesNoOtherPendingLink(t *testing.T) {
	ctx := context.Background()
	sqlDB, _ := usersFixture(t)
	admin := mkUser(t, sqlDB, "alice", true)
	victim := mkUser(t, sqlDB, "victim", false)
	tok, _, _ := auth.IssueReset(ctx, sqlDB, admin, victim, time.Hour)
	// A second pending link inserted behind IssueReset's back (a race).
	sqlDB.Exec(`INSERT INTO password_resets (token_hash, user_id, created_at, expires_at) VALUES ('other', ?, 't', '2999-01-01T00:00:00Z')`, victim)
	if _, err := auth.UseReset(ctx, sqlDB, tok, auth.Hash("a-brand-new-password")); err != nil {
		t.Fatal(err)
	}
	var n int
	sqlDB.QueryRow(`SELECT COUNT(*) FROM password_resets WHERE user_id = ? AND used_at IS NULL`, victim).Scan(&n)
	if n != 0 {
		t.Errorf("%d pending links left after a reset", n)
	}
}
