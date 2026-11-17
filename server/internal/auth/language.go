package auth

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// queryer is what InterfaceLanguage reads through: the pool or a transaction.
type queryer interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// InterfaceLanguage returns the user's stored interface language ('' =
// follow the browser/device, also for an unknown user).
func InterfaceLanguage(ctx context.Context, q queryer, userID int64) (string, error) {
	var lang string
	err := q.QueryRowContext(ctx, `SELECT interface_language FROM users WHERE id = ?`, userID).Scan(&lang)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("select interface language: %w", err)
	}
	return lang, nil
}

// SetInterfaceLanguage stores lang for the user. The caller validates it
// (i18n.IsLanguageSetting); it is a preference, so no audit row is written.
func SetInterfaceLanguage(ctx context.Context, sqlDB *sql.DB, userID int64, lang string) error {
	if _, err := sqlDB.ExecContext(ctx, `UPDATE users SET interface_language = ? WHERE id = ?`, lang, userID); err != nil {
		return fmt.Errorf("set interface language: %w", err)
	}
	return nil
}
