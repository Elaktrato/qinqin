package update

import (
	"context"
	"testing"

	"qinqin/internal/dbtest"
)

func boolp(b bool) *bool { return &b }

func TestSaveSettingsWritesBothFieldsAndTheirAuditTogether(t *testing.T) {
	ctx := context.Background()
	db := dbtest.Open(t)
	got, err := SaveSettings(ctx, db, 0, SettingsPatch{Enabled: boolp(false), Prereleases: boolp(true)})
	if err != nil {
		t.Fatal(err)
	}
	if got.Enabled || !got.Prereleases {
		t.Fatalf("settings = %+v", got)
	}
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM auth_audit WHERE action = 'settings_changed'`).Scan(&n); err != nil || n != 2 {
		t.Fatalf("audit rows = %d, err %v; want 2", n, err)
	}
	// Setting the value it already has audits nothing.
	if _, err := SaveSettings(ctx, db, 0, SettingsPatch{Enabled: boolp(false)}); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM auth_audit WHERE action = 'settings_changed'`).Scan(&n); err != nil || n != 2 {
		t.Fatalf("audit rows after a no-op = %d, err %v; want 2", n, err)
	}
}

// A failing audit write must not leave the setting changed behind a 500.
func TestSaveSettingsRollsBackWhenTheAuditFails(t *testing.T) {
	ctx := context.Background()
	db := dbtest.Open(t)
	before, err := LoadSettings(ctx, db)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TRIGGER audit_fails BEFORE INSERT ON auth_audit BEGIN SELECT RAISE(ABORT, 'audit down'); END`); err != nil {
		t.Fatal(err)
	}
	if _, err := SaveSettings(ctx, db, 0, SettingsPatch{Enabled: boolp(!before.Enabled), Prereleases: boolp(!before.Prereleases)}); err == nil {
		t.Fatal("want the audit error")
	}
	after, err := LoadSettings(ctx, db)
	if err != nil {
		t.Fatal(err)
	}
	if after != before {
		t.Fatalf("settings changed to %+v although the save failed (was %+v)", after, before)
	}
}
