package auth_test

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"

	"qinqin/internal/auth"
	"qinqin/internal/db"
)

func TestAuditCopiesNamesAndKeepsThemAfterDeletion(t *testing.T) {
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
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

func TestAuditRefusesSecretLookingDetail(t *testing.T) {
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	for _, key := range []string{"password", "newPassword", "token", "resetToken", "code", "secret", "email", "smtpHost", "ip", "hash"} {
		err := auth.Audit(context.Background(), sqlDB, auth.AuditEvent{Action: "x", Detail: map[string]any{key: "v"}})
		if !errors.Is(err, auth.ErrAuditDetail) {
			t.Errorf("detail key %q accepted (err %v)", key, err)
		}
	}
	var n int
	sqlDB.QueryRow(`SELECT COUNT(*) FROM auth_audit`).Scan(&n)
	if n != 0 {
		t.Errorf("%d rows written for refused events", n)
	}
	if err := auth.Audit(context.Background(), sqlDB, auth.AuditEvent{Action: "settings_changed", Detail: map[string]any{"field": "registration", "to": "invite", "maxUses": 5}}); err != nil {
		t.Errorf("ordinary detail refused: %v", err)
	}
}
