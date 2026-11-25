package auth_test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"qinqin/internal/auth"
	"qinqin/internal/dbtest"
)

func TestAuditCopiesNamesAndKeepsThemAfterDeletion(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	a, _ := auth.CreateUser(ctx, sqlDB, "alice", "secret-pass-1", true)
	b, _ := auth.CreateUser(ctx, sqlDB, "bobby", "secret-pass-1", false)
	if err := auth.Audit(ctx, sqlDB, auth.AuditEvent{Action: "sessions_revoked", ActorID: a.ID, TargetID: &b.ID,
		Detail: map[string]any{"scope": "others", "revoked": 3}}); err != nil {
		t.Fatal(err)
	}
	sqlDB.Exec(`DELETE FROM users WHERE id = ?`, b.ID)
	var actor, target, detail string
	var actorID, targetID int64
	if err := sqlDB.QueryRow(`SELECT actor_id, actor_name, target_id, target_name, detail FROM auth_audit`).Scan(&actorID, &actor, &targetID, &target, &detail); err != nil {
		t.Fatal(err)
	}
	if actorID != a.ID || actor != "alice" || targetID != b.ID || target != "bobby" {
		t.Errorf("row = %d/%s/%d/%s", actorID, actor, targetID, target)
	}
	var d map[string]any
	if err := json.Unmarshal([]byte(detail), &d); err != nil || d["scope"] != "others" {
		t.Errorf("detail = %q (%v)", detail, err)
	}
}

func TestAuditAllowsOnlyListedKeysAndSmallScalars(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	bad := []map[string]any{
		{"password": "v"}, {"newPassword": "v"}, {"token": "v"}, {"code": "v"}, {"email": "a@b.example"},
		{"smtpHost": "mail.example"}, {"ip": "1.2.3.4"}, {"note": "free text"}, {"Scope": "others"},
		{"scope": strings.Repeat("x", 65)},
		{"scope": map[string]any{"a": 1}},
		{"scope": []string{"a"}},
		{"scope": nil},
	}
	for _, d := range bad {
		if err := auth.Audit(ctx, sqlDB, auth.AuditEvent{Action: "x", Detail: d}); !errors.Is(err, auth.ErrAuditDetail) {
			t.Errorf("detail %v accepted (err %v)", d, err)
		}
	}
	var n int
	sqlDB.QueryRow(`SELECT COUNT(*) FROM auth_audit`).Scan(&n)
	if n != 0 {
		t.Errorf("%d rows written for refused events", n)
	}
	for _, d := range []map[string]any{
		{"scope": "others", "revoked": 3}, {"forced": true, "signedOutOthers": int64(2)},
		{"field": "registration", "to": "invite", "maxUses": 5}, nil,
	} {
		if err := auth.Audit(ctx, sqlDB, auth.AuditEvent{Action: "settings_changed", Detail: d}); err != nil {
			t.Errorf("detail %v refused: %v", d, err)
		}
	}
}
