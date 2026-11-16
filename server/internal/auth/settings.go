package auth

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// Settings is the instance-wide sign-in policy (the one auth_settings row).
type Settings struct {
	Registration   string // closed | invite | open
	EmailPolicy    string // off | optional | required
	MFAEnforced    bool
	EmailCodeLogin bool
}

// SettingsPatch is a partial update; nil fields are left alone.
type SettingsPatch struct {
	Registration   *string
	EmailPolicy    *string
	MFAEnforced    *bool
	EmailCodeLogin *bool
}

// ErrInvalidSetting marks a value outside a setting's vocabulary.
var ErrInvalidSetting = errors.New("invalid setting")

var (
	registrationModes = map[string]bool{"closed": true, "invite": true, "open": true}
	emailPolicies     = map[string]bool{"off": true, "optional": true, "required": true}
)

// LoadSettings reads the settings row. It is read per request on purpose
// (one indexed row): an admin's change applies instantly, with no cache to
// invalidate.
func LoadSettings(ctx context.Context, ex querier) (Settings, error) {
	var s Settings
	var mfa, code int
	err := ex.QueryRowContext(ctx,
		`SELECT registration, email_policy, mfa_enforced, email_code_login FROM auth_settings WHERE id = 1`).
		Scan(&s.Registration, &s.EmailPolicy, &mfa, &code)
	if err != nil {
		return Settings{}, fmt.Errorf("load auth settings: %w", err)
	}
	s.MFAEnforced, s.EmailCodeLogin = mfa != 0, code != 0
	return s, nil
}

type querier interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// UpdateSettings applies patch and writes one audit row per field that
// actually changed (field name and new value only), all in one transaction.
// The caller decides whether mail-dependent switches may be turned on.
func UpdateSettings(ctx context.Context, sqlDB *sql.DB, actorID int64, patch SettingsPatch) (Settings, error) {
	if patch.Registration != nil && !registrationModes[*patch.Registration] {
		return Settings{}, fmt.Errorf("%w: registration must be closed, invite or open", ErrInvalidSetting)
	}
	if patch.EmailPolicy != nil && !emailPolicies[*patch.EmailPolicy] {
		return Settings{}, fmt.Errorf("%w: email policy must be off, optional or required", ErrInvalidSetting)
	}
	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return Settings{}, fmt.Errorf("begin settings: %w", err)
	}
	defer tx.Rollback()
	// A write first, so concurrent updates serialize before they read.
	at := now()
	if _, err := tx.ExecContext(ctx, `UPDATE auth_settings SET updated_at = ?1, updated_by = ?2 WHERE id = 1`, at, nullID(actorID)); err != nil {
		return Settings{}, fmt.Errorf("touch settings: %w", err)
	}
	cur, err := LoadSettings(ctx, tx)
	if err != nil {
		return Settings{}, err
	}
	change := func(column, field string, to any, differs bool) error {
		if !differs {
			return nil
		}
		if _, err := tx.ExecContext(ctx, `UPDATE auth_settings SET `+column+` = ? WHERE id = 1`, to); err != nil {
			return fmt.Errorf("set %s: %w", column, err)
		}
		shown := to
		if b, ok := to.(int); ok {
			shown = b != 0
		}
		return Audit(ctx, tx, AuditEvent{Action: "settings_changed", ActorID: actorID,
			Detail: map[string]any{"field": field, "to": shown}})
	}
	b2i := func(b bool) int {
		if b {
			return 1
		}
		return 0
	}
	if patch.Registration != nil {
		if err := change("registration", "registration", *patch.Registration, *patch.Registration != cur.Registration); err != nil {
			return Settings{}, err
		}
		cur.Registration = *patch.Registration
	}
	if patch.EmailPolicy != nil {
		if err := change("email_policy", "emailPolicy", *patch.EmailPolicy, *patch.EmailPolicy != cur.EmailPolicy); err != nil {
			return Settings{}, err
		}
		cur.EmailPolicy = *patch.EmailPolicy
	}
	if patch.MFAEnforced != nil {
		if err := change("mfa_enforced", "mfaEnforced", b2i(*patch.MFAEnforced), *patch.MFAEnforced != cur.MFAEnforced); err != nil {
			return Settings{}, err
		}
		cur.MFAEnforced = *patch.MFAEnforced
	}
	if patch.EmailCodeLogin != nil {
		if err := change("email_code_login", "emailCodeLogin", b2i(*patch.EmailCodeLogin), *patch.EmailCodeLogin != cur.EmailCodeLogin); err != nil {
			return Settings{}, err
		}
		cur.EmailCodeLogin = *patch.EmailCodeLogin
	}
	if err := tx.Commit(); err != nil {
		return Settings{}, fmt.Errorf("commit settings: %w", err)
	}
	return cur, nil
}

// nullID maps the "no actor" id 0 to NULL.
func nullID(id int64) any {
	if id == 0 {
		return nil
	}
	return id
}
