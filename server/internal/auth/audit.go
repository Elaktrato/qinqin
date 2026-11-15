package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// ErrAuditDetail marks an audit event whose detail could hold a secret.
var ErrAuditDetail = errors.New("audit detail may hold a secret")

// AuditEvent is one row of auth_audit. ActorID 0 means no actor (a system
// action); TargetID nil means no target. The names are copied from users
// when the row is written, so they survive the user's deletion.
type AuditEvent struct {
	Action   string
	ActorID  int64
	TargetID *int64
	Detail   map[string]any // small, non-secret facts: scope, field, count
}

// secretWords make Audit refuse a detail key: an audit row never holds a
// password, token, code, address, host or hash, whatever a caller means.
var secretWords = []string{"password", "token", "secret", "code", "email", "host", "hash"}

func checkAuditDetail(d map[string]any) error {
	for k := range d {
		lk := strings.ToLower(k)
		if lk == "ip" || lk == "clientip" || lk == "addr" || lk == "address" {
			return fmt.Errorf("%w: key %q", ErrAuditDetail, k)
		}
		for _, w := range secretWords {
			if strings.Contains(lk, w) {
				return fmt.Errorf("%w: key %q", ErrAuditDetail, k)
			}
		}
	}
	return nil
}

// Audit writes e through ex (a *sql.DB or a *sql.Tx, so a state change and
// its audit row can commit together).
func Audit(ctx context.Context, ex execer, e AuditEvent) error {
	if err := checkAuditDetail(e.Detail); err != nil {
		return err
	}
	detail := "{}"
	if len(e.Detail) > 0 {
		b, err := json.Marshal(e.Detail)
		if err != nil {
			return fmt.Errorf("audit detail: %w", err)
		}
		detail = string(b)
	}
	var actor any
	if e.ActorID != 0 {
		actor = e.ActorID
	}
	var target any
	if e.TargetID != nil {
		target = *e.TargetID
	}
	_, err := ex.ExecContext(ctx, `
		INSERT INTO auth_audit (at, action, actor_id, actor_name, target_id, target_name, detail)
		VALUES (?, ?, ?, COALESCE((SELECT username FROM users WHERE id = ?), ''),
		        ?, COALESCE((SELECT username FROM users WHERE id = ?), ''), ?)`,
		now(), e.Action, actor, actor, target, target, detail)
	if err != nil {
		return fmt.Errorf("write audit %s: %w", e.Action, err)
	}
	return nil
}
