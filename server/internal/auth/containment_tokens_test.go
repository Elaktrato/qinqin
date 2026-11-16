package auth_test

import (
	"context"
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"qinqin/internal/auth"
)

// Matrix 13: every containment action deletes all of the user's access
// tokens in its own transaction; another user's tokens stay.
func TestEveryContainmentActionRevokesTokens(t *testing.T) {
	ctx := context.Background()
	paths := []struct {
		name string
		run  func(t *testing.T, users *auth.Users, admin, target int64)
	}{
		{"own password change, sign out others", func(t *testing.T, users *auth.Users, _, u int64) {
			must(t, auth.ChangePassword(ctx, users.DB, u, auth.Hash("another-long-pass"), 0, true))
		}},
		{"own password change, others kept", func(t *testing.T, users *auth.Users, _, u int64) {
			must(t, auth.ChangePassword(ctx, users.DB, u, auth.Hash("another-long-pass"), 0, false))
		}},
		{"forced change by admin", func(t *testing.T, users *auth.Users, admin, u int64) {
			must(t, users.ForcePasswordChange(ctx, admin, u))
		}},
		{"reset link used", func(t *testing.T, users *auth.Users, admin, u int64) {
			tok, _, err := auth.IssueReset(ctx, users.DB, admin, u, time.Hour)
			must(t, err)
			_, err = auth.UseReset(ctx, users.DB, tok, auth.Hash("another-long-pass"))
			must(t, err)
		}},
		{"qinqin recover", func(t *testing.T, users *auth.Users, _, u int64) {
			_, err := auth.RecoverAccount(ctx, users.DB, auth.RecoverOptions{Username: name(t, users, u), Hash: auth.Hash("another-long-pass")})
			must(t, err)
		}},
		{"qinqin recover --reset-mfa", func(t *testing.T, users *auth.Users, _, u int64) {
			_, err := auth.RecoverAccount(ctx, users.DB, auth.RecoverOptions{Username: name(t, users, u), Hash: auth.Hash("another-long-pass"), ResetMFA: true})
			must(t, err)
		}},
		{"admin MFA reset", func(t *testing.T, users *auth.Users, admin, u int64) {
			must(t, users.ResetUserMFA(ctx, admin, u))
		}},
		{"disable", func(t *testing.T, users *auth.Users, admin, u int64) {
			must(t, users.SetDisabled(ctx, admin, u, true))
		}},
		{"admin revoke sessions", func(t *testing.T, users *auth.Users, admin, u int64) {
			_, err := users.RevokeAllSessions(ctx, admin, u)
			must(t, err)
		}},
		{"log out other devices", func(t *testing.T, users *auth.Users, _, u int64) {
			_, err := auth.RevokeOthersAudited(ctx, users.DB, u, 0, "others")
			must(t, err)
		}},
		{"log out everywhere", func(t *testing.T, users *auth.Users, _, u int64) {
			_, err := auth.RevokeOthersAudited(ctx, users.DB, u, 0, "all")
			must(t, err)
		}},
		{"account deletion", func(t *testing.T, users *auth.Users, admin, u int64) {
			must(t, users.DeleteUser(ctx, admin, u, t.TempDir()))
		}},
	}
	for _, p := range paths {
		t.Run(p.name, func(t *testing.T) {
			sqlDB, users := usersFixture(t)
			admin := mkUser(t, sqlDB, "admin", true)
			u1 := mkUser(t, sqlDB, "user-one", false)
			u2 := mkUser(t, sqlDB, "user-two", false)
			for _, u := range []int64{u1, u1, u2, admin} {
				if _, _, err := auth.CreateToken(ctx, sqlDB, u, req("n", "write", 30, nil)); err != nil {
					t.Fatal(err)
				}
			}
			p.run(t, users, admin, u1)
			if n := tokenCount(t, users, u1); n != 0 {
				t.Errorf("user 1 keeps %d tokens", n)
			}
			if n := tokenCount(t, users, u2); n != 1 {
				t.Errorf("user 2 has %d tokens, want 1", n)
			}
			if n := tokenCount(t, users, admin); n != 1 {
				t.Errorf("admin has %d tokens, want 1", n)
			}
		})
	}
}

// "Sign everyone out" revokes every user's tokens, the acting admin's too.
func TestSignEveryoneOutRevokesAllTokens(t *testing.T) {
	ctx := context.Background()
	sqlDB, users := usersFixture(t)
	admin := mkUser(t, sqlDB, "admin", true)
	u1 := mkUser(t, sqlDB, "user-one", false)
	for _, u := range []int64{admin, u1, u1} {
		auth.CreateToken(ctx, sqlDB, u, req("n", "read", 30, nil))
	}
	if _, err := auth.RevokeAllExcept(ctx, sqlDB, admin, 0); err != nil {
		t.Fatal(err)
	}
	var n int
	sqlDB.QueryRow(`SELECT COUNT(*) FROM access_tokens`).Scan(&n)
	if n != 0 {
		t.Errorf("%d tokens survive sign everyone out", n)
	}
	var detail string
	sqlDB.QueryRow(`SELECT detail FROM auth_audit WHERE action = 'sessions_revoked' ORDER BY id DESC LIMIT 1`).Scan(&detail)
	var d map[string]any
	json.Unmarshal([]byte(detail), &d)
	if d["tokens"] != float64(3) {
		t.Errorf("audit detail %s, want tokens 3", detail)
	}
	_ = users
}

// The containment audit rows carry how many tokens went.
func TestContainmentAuditCountsTokens(t *testing.T) {
	ctx := context.Background()
	sqlDB, users := usersFixture(t)
	admin := mkUser(t, sqlDB, "admin", true)
	u1 := mkUser(t, sqlDB, "user-one", false)
	auth.CreateToken(ctx, sqlDB, u1, req("n", "read", 30, nil))
	auth.CreateToken(ctx, sqlDB, u1, req("n", "read", 30, nil))
	if err := users.SetDisabled(ctx, admin, u1, true); err != nil {
		t.Fatal(err)
	}
	var detail string
	sqlDB.QueryRow(`SELECT detail FROM auth_audit WHERE action = 'user_disabled'`).Scan(&detail)
	if !strings.Contains(detail, `"tokens":2`) {
		t.Errorf("user_disabled detail %s", detail)
	}
	if err := auth.ChangePassword(ctx, sqlDB, admin, auth.Hash("another-long-pass"), 0, false); err != nil {
		t.Fatal(err)
	}
	sqlDB.QueryRow(`SELECT detail FROM auth_audit WHERE action = 'password_changed'`).Scan(&detail)
	if !strings.Contains(detail, `"tokens":0`) {
		t.Errorf("password_changed detail %s", detail)
	}
}

// The janitor deletes tokens expired longer than TokenExpiredKeep; recently
// expired ones stay listed.
func TestJanitorPrunesLongExpiredTokens(t *testing.T) {
	ctx := context.Background()
	sqlDB, _ := usersFixture(t)
	u1 := mkUser(t, sqlDB, "user-one", false)
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	restore := auth.SetClockForTest(func() time.Time { return start })
	_, old, _ := auth.CreateToken(ctx, sqlDB, u1, req("old", "read", 1, nil))
	_, recent, _ := auth.CreateToken(ctx, sqlDB, u1, req("recent", "read", 20, nil))
	_, live, _ := auth.CreateToken(ctx, sqlDB, u1, req("live", "read", 365, nil))
	restore()
	if _, _, err := auth.Prune(ctx, sqlDB, start.Add(40*24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	ids := map[int64]bool{}
	rows, _ := sqlDB.Query(`SELECT id FROM access_tokens`)
	for rows.Next() {
		var id int64
		rows.Scan(&id)
		ids[id] = true
	}
	rows.Close()
	if ids[old.ID] || !ids[recent.ID] || !ids[live.ID] {
		t.Errorf("after prune: %v (old %d gone, recent %d and live %d kept)", ids, old.ID, recent.ID, live.ID)
	}
}

// No session deletion per user exists outside revokeCredentials, the
// userTables row and the documented restore exception: a new containment
// path that deleted sessions by hand would forget the tokens.
func TestOnlyRevokeCredentialsDeletesAUsersSessions(t *testing.T) {
	root := "../"
	allowed := map[string]bool{
		"auth/session.go":   true, // revokeCredentials, RevokeSession(Audited) (one id), RevokeAllExcept
		"auth/delete.go":    true, // the userTables row
		"backup/restore.go": true, // personal restore: tokens are kept on purpose
		"auth/janitor.go":   true, // idle sessions of everyone
	}
	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		rel, _ := filepath.Rel(root, path)
		rel = filepath.ToSlash(rel)
		f, err := parser.ParseFile(token.NewFileSet(), path, nil, 0)
		if err != nil {
			return err
		}
		ast.Inspect(f, func(n ast.Node) bool {
			lit, ok := n.(*ast.BasicLit)
			if !ok || lit.Kind != token.STRING {
				return true
			}
			s, err := strconv.Unquote(lit.Value)
			if err != nil {
				return true
			}
			norm := strings.Join(strings.Fields(strings.ToUpper(s)), " ")
			if strings.Contains(norm, "DELETE FROM SESSIONS") && !allowed[rel] {
				t.Errorf("%s deletes sessions (%q): go through revokeCredentials so the user's access tokens go too", rel, s)
			}
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	// And inside session.go, the per-user delete exists once, in revokeCredentials.
	src, _ := os.ReadFile("session.go")
	if c := strings.Count(string(src), "DELETE FROM sessions WHERE user_id = ? AND id <> ?"); c != 1 {
		t.Errorf("session.go has %d per-user session deletes, want exactly the one in revokeCredentials", c)
	}
	if !strings.Contains(string(src), "func revokeCredentials(") || strings.Contains(string(src), "func revokeSessions(") {
		t.Error("revokeSessions must be revokeCredentials (sessions and tokens)")
	}
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func name(t *testing.T, users *auth.Users, id int64) string {
	t.Helper()
	var n string
	if err := users.DB.QueryRow(`SELECT username FROM users WHERE id = ?`, id).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func tokenCount(t *testing.T, users *auth.Users, id int64) int {
	t.Helper()
	var n int
	if err := users.DB.QueryRow(`SELECT COUNT(*) FROM access_tokens WHERE user_id = ?`, id).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}
