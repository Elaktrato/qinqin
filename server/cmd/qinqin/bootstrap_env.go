package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"

	"qinqin/internal/auth"
)

// bootstrapAdminFromEnv creates the first admin of a fresh instance from
// the environment, so a container needs no `adduser` and no open first
// registration. QINQIN_BOOTSTRAP_ADMIN names the admin (unset: the feature
// is off); QINQIN_BOOTSTRAP_PASSWORD is the initial password, and when it
// is empty a random one is generated and logged once. The admin must
// change the password at the first sign-in. It acts only while there are
// no users; afterwards the variables are ignored and nothing is logged.
// An invalid name or password is an error, so serve does not start and
// fall back to open first registration.
func bootstrapAdminFromEnv(ctx context.Context, sqlDB *sql.DB, getenv func(string) string, logf func(string, ...any)) error {
	raw := getenv("QINQIN_BOOTSTRAP_ADMIN")
	if raw == "" {
		return nil
	}
	var users int
	if err := sqlDB.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&users); err != nil {
		return fmt.Errorf("QINQIN_BOOTSTRAP_ADMIN: count users: %w", err)
	}
	if users > 0 {
		return nil
	}
	name := auth.NormalizeUsername(raw)
	if err := auth.CheckNewUsername(ctx, sqlDB, name); err != nil {
		return fmt.Errorf("QINQIN_BOOTSTRAP_ADMIN: %s", reasonOr(err))
	}
	password := getenv("QINQIN_BOOTSTRAP_PASSWORD")
	generated := password == ""
	if generated {
		password = generatePassword()
	}
	if err := auth.CheckPassword(name, password); err != nil {
		return fmt.Errorf("QINQIN_BOOTSTRAP_PASSWORD: %s", reasonOr(err))
	}
	if _, err := auth.BootstrapAdmin(ctx, sqlDB, name, password); err != nil {
		if errors.Is(err, auth.ErrNotFirst) {
			return nil // another process won the race: nothing to do
		}
		return fmt.Errorf("QINQIN_BOOTSTRAP_ADMIN: %w", err)
	}
	logf("bootstrap: created admin %q; the password must be changed at the first sign-in", name)
	if generated {
		logf("bootstrap: initial password (shown once, never again): %s", password)
	}
	return nil
}

// generatePassword returns 20 random URL-safe characters (120 bits).
func generatePassword() string {
	b := make([]byte, 15)
	if _, err := rand.Read(b); err != nil {
		panic("bootstrap: crypto/rand read: " + err.Error())
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

func reasonOr(err error) string {
	if r := auth.PolicyReason(err); r != "" {
		return r
	}
	return err.Error()
}
