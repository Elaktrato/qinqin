package auth_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sync"
	"testing"

	"qinqin/internal/auth"
)

func TestBootstrapAdminCreatesFlaggedAdmin(t *testing.T) {
	_, sqlDB := newServer(t)
	ctx := context.Background()

	u, err := auth.BootstrapAdmin(ctx, sqlDB, "root", "initial-pass-1")
	if err != nil || !u.Admin || u.Username != "root" || !u.MustChangePassword {
		t.Fatalf("BootstrapAdmin = %+v, %v; want admin root with a forced change", u, err)
	}
	var must int
	var after *int64
	if err := sqlDB.QueryRow(`SELECT must_change_password, must_change_after FROM users WHERE id = ?`, u.ID).Scan(&must, &after); err != nil {
		t.Fatal(err)
	}
	if must != 1 || after == nil {
		t.Errorf("must_change_password = %d, must_change_after = %v; want 1 and a watermark", must, after)
	}
	var action, actor string
	var target int64
	if err := sqlDB.QueryRow(`SELECT action, actor_name, target_id FROM auth_audit WHERE action = 'bootstrap_admin_created'`).Scan(&action, &actor, &target); err != nil {
		t.Fatalf("audit row: %v", err)
	}
	if actor != "bootstrap" || target != u.ID {
		t.Errorf("audit actor %q target %d, want bootstrap and %d", actor, target, u.ID)
	}
}

func TestBootstrapAdminOnlyWhenEmpty(t *testing.T) {
	_, sqlDB := newServer(t)
	ctx := context.Background()

	if _, err := auth.CreateUser(ctx, sqlDB, "carol", "secret-pass-1", false); err != nil {
		t.Fatal(err)
	}
	if _, err := auth.BootstrapAdmin(ctx, sqlDB, "root", "initial-pass-1"); !errors.Is(err, auth.ErrNotFirst) {
		t.Fatalf("BootstrapAdmin with a user present = %v, want ErrNotFirst", err)
	}
	var users, audits int
	sqlDB.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&users)
	sqlDB.QueryRow(`SELECT COUNT(*) FROM auth_audit WHERE action = 'bootstrap_admin_created'`).Scan(&audits)
	if users != 1 || audits != 0 {
		t.Errorf("users = %d, audits = %d; want 1 and 0 (nothing written)", users, audits)
	}

	_, sqlDB2 := newServer(t)
	if _, err := auth.BootstrapAdmin(ctx, sqlDB2, "root", "initial-pass-1"); err != nil {
		t.Fatal(err)
	}
	if _, err := auth.BootstrapAdmin(ctx, sqlDB2, "root2", "initial-pass-1"); !errors.Is(err, auth.ErrNotFirst) {
		t.Errorf("second BootstrapAdmin = %v, want ErrNotFirst", err)
	}
}

func TestBootstrapAdminConcurrentCreatesOne(t *testing.T) {
	_, sqlDB := newServer(t)
	ctx := context.Background()
	const racers = 6
	errs := make([]error, racers)
	var wg sync.WaitGroup
	for i := range racers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, errs[i] = auth.BootstrapAdmin(ctx, sqlDB, "root"+string(rune('a'+i)), "initial-pass-1")
		}()
	}
	wg.Wait()
	won := 0
	for _, err := range errs {
		switch {
		case err == nil:
			won++
		case !errors.Is(err, auth.ErrNotFirst):
			t.Errorf("unexpected error: %v", err)
		}
	}
	var users, audits int
	sqlDB.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&users)
	sqlDB.QueryRow(`SELECT COUNT(*) FROM auth_audit WHERE action = 'bootstrap_admin_created'`).Scan(&audits)
	if won != 1 || users != 1 || audits != 1 {
		t.Errorf("winners = %d, users = %d, audits = %d; want 1 each", won, users, audits)
	}
}

// After a bootstrap the first sign-in yields a session that may do nothing
// but change the password; the change lifts the restriction.
func TestBootstrapAdminLoginIsRestrictedUntilPasswordChange(t *testing.T) {
	ts, sqlDB := newServer(t)
	ctx := context.Background()
	if _, err := auth.BootstrapAdmin(ctx, sqlDB, "root", "initial-pass-1"); err != nil {
		t.Fatal(err)
	}
	token := loginToken(t, ts, "root", "initial-pass-1")

	get := func(path string) (int, map[string]any) {
		req, _ := http.NewRequest(http.MethodGet, ts.URL+path, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var body map[string]any
		json.NewDecoder(resp.Body).Decode(&body)
		return resp.StatusCode, body
	}
	status, body := get("/api/auth/me")
	if status != http.StatusOK || body["restriction"] != "password_change" || body["needsCurrentPassword"] != false {
		t.Fatalf("me = %d %v; want 200, restriction password_change, no current password asked", status, body)
	}
	if status, _ := get("/api/workspaces"); status == http.StatusOK {
		t.Errorf("GET /api/workspaces = %d on a temporary session, want refusal", status)
	}

	resp := post(t, ts.URL+"/api/account/password", token, map[string]any{"newPassword": "a-new-long-password"})
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		t.Fatalf("change password = %d, want success", resp.StatusCode)
	}
	token = loginToken(t, ts, "root", "a-new-long-password")
	if status, body := get("/api/auth/me"); status != http.StatusOK || body["restriction"] != "" {
		t.Errorf("me after change = %d %v, want no restriction", status, body)
	}
}
