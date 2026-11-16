package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
)

// ErrAuditDetail marks an audit event whose detail could hold a secret.
var ErrAuditDetail = errors.New("audit detail may hold a secret")

// AuditEvent is one row of auth_audit. ActorID 0 means no actor (a system
// action); TargetID nil means no target. The names are copied from users
// when the row is written, so they survive the user's deletion.
type AuditEvent struct {
	Action    string
	ActorName string // label for a system action (ActorID 0), such as "cli"
	ActorID   int64
	TargetID  *int64
	Detail    map[string]any // small, non-secret facts: scope, field, count
}

// auditKeys is the whole vocabulary of audit detail. A key outside it is
// refused, so a secret (password, token, code, address, host) cannot reach
// the log by naming; add a key here on purpose when a new action needs one.
var auditKeys = map[string]bool{
	"scope": true, "revoked": true, "forced": true, "signedOutOthers": true,
	"field": true, "to": true, "maxUses": true, "uses": true, "count": true, "enabled": true,
	"admin": true,
	// Personal access tokens: the row id, the expiry in days, whether the
	// token is limited to a workspace, and how many tokens a containment
	// action revoked. Never the name (user text) or the hint.
	"tokenId": true, "days": true, "limited": true, "tokens": true,
}

// maxAuditValue caps a string detail value (in bytes).
const maxAuditValue = 64

func checkAuditDetail(d map[string]any) error {
	for k, v := range d {
		if !auditKeys[k] {
			return fmt.Errorf("%w: key %q is not allowed", ErrAuditDetail, k)
		}
		switch x := v.(type) {
		case bool, int, int32, int64, uint, uint32, uint64, float64:
		case string:
			if len(x) > maxAuditValue {
				return fmt.Errorf("%w: value of %q is too long", ErrAuditDetail, k)
			}
		default:
			return fmt.Errorf("%w: value of %q must be a short string, number or boolean", ErrAuditDetail, k)
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
		VALUES (?, ?, ?, COALESCE((SELECT username FROM users WHERE id = ?), ?),
		        ?, COALESCE((SELECT username FROM users WHERE id = ?), ''), ?)`,
		now(), e.Action, actor, actor, e.ActorName, target, target, detail)
	if err != nil {
		return fmt.Errorf("write audit %s: %w", e.Action, err)
	}
	return nil
}
