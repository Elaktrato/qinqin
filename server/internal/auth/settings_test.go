package auth_test

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/auth"
	"qinqin/internal/db"
)

func TestSettingsDefaultsAndUpdateAudited(t *testing.T) {
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	ctx := context.Background()
	admin, _ := auth.CreateUser(ctx, sqlDB, "alice", "secret-pass-1", true)
	got, err := auth.LoadSettings(ctx, sqlDB)
	if err != nil || got.Registration != "closed" || got.EmailPolicy != "off" || got.MFAEnforced || got.EmailCodeLogin {
		t.Fatalf("defaults = %+v (%v)", got, err)
	}
	reg, pol := "invite", "optional"
	yes := true
	got, err = auth.UpdateSettings(ctx, sqlDB, admin.ID, auth.SettingsPatch{Registration: &reg, EmailPolicy: &pol, MFAEnforced: &yes})
	if err != nil || got.Registration != "invite" || got.EmailPolicy != "optional" || !got.MFAEnforced {
		t.Fatalf("after update = %+v (%v)", got, err)
	}
	rows, err := sqlDB.Query(`SELECT action, detail FROM auth_audit ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var details []string
	for rows.Next() {
		var action, detail string
		rows.Scan(&action, &detail)
		if action != "settings_changed" {
			t.Errorf("action %q", action)
		}
		details = append(details, detail)
	}
	if len(details) != 3 {
		t.Fatalf("audit rows = %d, want one per changed field: %v", len(details), details)
	}
	// An unchanged value writes nothing.
	if _, err := auth.UpdateSettings(ctx, sqlDB, admin.ID, auth.SettingsPatch{Registration: &reg}); err != nil {
		t.Fatal(err)
	}
	var n int
	sqlDB.QueryRow(`SELECT COUNT(*) FROM auth_audit`).Scan(&n)
	if n != 3 {
		t.Errorf("no-op update wrote audit rows: %d", n)
	}
}

func TestSettingsRejectsUnknownWords(t *testing.T) {
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	bad := "everyone"
	if _, err := auth.UpdateSettings(context.Background(), sqlDB, 1, auth.SettingsPatch{Registration: &bad}); !errors.Is(err, auth.ErrInvalidSetting) {
		t.Errorf("registration %q: %v", bad, err)
	}
	if _, err := auth.UpdateSettings(context.Background(), sqlDB, 1, auth.SettingsPatch{EmailPolicy: &bad}); !errors.Is(err, auth.ErrInvalidSetting) || !strings.Contains(err.Error(), "email") {
		t.Errorf("email policy %q: %v", bad, err)
	}
}
