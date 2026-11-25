package update

import (
	"context"
	"database/sql"

	"qinqin/internal/auth"
)

// Settings is the one-row update_settings table.
type Settings struct {
	Enabled     bool
	Prereleases bool
}

// SettingsPatch changes any subset of Settings.
type SettingsPatch struct {
	Enabled     *bool
	Prereleases *bool
}

// LoadSettings reads the settings row.
func LoadSettings(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}) (Settings, error) {
	var e, p int
	if err := q.QueryRowContext(ctx, `SELECT enabled, prereleases FROM update_settings WHERE id = 1`).Scan(&e, &p); err != nil {
		return Settings{}, err
	}
	return Settings{e != 0, p != 0}, nil
}

// SaveSettings applies the patch, writes one audit record per changed field and
// returns the new settings, all in one transaction: a failing audit write leaves
// the settings as they were. actorID is the admin who changed them.
func SaveSettings(ctx context.Context, db *sql.DB, actorID int64, p SettingsPatch) (Settings, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return Settings{}, err
	}
	defer tx.Rollback() //nolint:errcheck // a no-op after Commit
	cur, err := LoadSettings(ctx, tx)
	if err != nil {
		return Settings{}, err
	}
	for _, c := range []struct {
		field, column string
		to            *bool
		old           bool
	}{
		{"update_check", "enabled", p.Enabled, cur.Enabled},
		{"update_prereleases", "prereleases", p.Prereleases, cur.Prereleases},
	} {
		if c.to == nil {
			continue
		}
		v := 0
		if *c.to {
			v = 1
		}
		if _, err := tx.ExecContext(ctx, `UPDATE update_settings SET `+c.column+` = ? WHERE id = 1`, v); err != nil {
			return Settings{}, err
		}
		if *c.to == c.old {
			continue
		}
		if err := auth.Audit(ctx, tx, auth.AuditEvent{Action: "settings_changed", ActorID: actorID,
			Detail: map[string]any{"field": c.field, "to": *c.to}}); err != nil {
			return Settings{}, err
		}
	}
	next, err := LoadSettings(ctx, tx)
	if err != nil {
		return Settings{}, err
	}
	if err := tx.Commit(); err != nil {
		return Settings{}, err
	}
	return next, nil
}
