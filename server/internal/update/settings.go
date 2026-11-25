package update

import (
	"context"
	"database/sql"
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

// SaveSettings applies the patch and returns the new settings.
func SaveSettings(ctx context.Context, db *sql.DB, p SettingsPatch) (Settings, error) {
	b2i := func(b bool) int {
		if b {
			return 1
		}
		return 0
	}
	if p.Enabled != nil {
		if _, err := db.ExecContext(ctx, `UPDATE update_settings SET enabled = ? WHERE id = 1`, b2i(*p.Enabled)); err != nil {
			return Settings{}, err
		}
	}
	if p.Prereleases != nil {
		if _, err := db.ExecContext(ctx, `UPDATE update_settings SET prereleases = ? WHERE id = 1`, b2i(*p.Prereleases)); err != nil {
			return Settings{}, err
		}
	}
	return LoadSettings(ctx, db)
}
