package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"qinqin/internal/auth"
)

// The bootstrap administrator's name when QINQIN_BOOTSTRAP_ADMIN is empty,
// and the value that switches the bootstrap off (#211).
const (
	defaultBootstrapAdmin = "admin"
	bootstrapOff          = "off"
)

// bootstrapAdmin is auth.BootstrapAdmin; a test replaces it to lose the
// race deterministically.
var bootstrapAdmin = auth.BootstrapAdmin

// bootstrapAdminFromEnv gives a fresh instance its administrator before the
// port opens, so no registration ever decides who is admin (#211). While
// the users table is empty it creates QINQIN_BOOTSTRAP_ADMIN (default
// "admin") with QINQIN_BOOTSTRAP_PASSWORD, or, when that is empty, a random
// password that is logged once; the admin must change it at the first
// sign-in. QINQIN_BOOTSTRAP_ADMIN=off (any case) creates nothing: the
// operator creates the admin with `qinqin adduser --admin`, and until then
// registration stays closed. Once users exist the variables are ignored and
// nothing is logged. An invalid name or password is an error, so serve does
// not start. A supplied password is never logged.
func bootstrapAdminFromEnv(ctx context.Context, sqlDB *sql.DB, getenv func(string) string, logf func(string, ...any)) error {
	users, err := auth.CountUsers(ctx, sqlDB)
	if err != nil {
		return fmt.Errorf("QINQIN_BOOTSTRAP_ADMIN: count users: %w", err)
	}
	if users > 0 {
		return nil
	}
	name := auth.NormalizeUsername(getenv("QINQIN_BOOTSTRAP_ADMIN"))
	password := getenv("QINQIN_BOOTSTRAP_PASSWORD")
	if strings.EqualFold(name, bootstrapOff) {
		logf("bootstrap: off (QINQIN_BOOTSTRAP_ADMIN=off) and no user exists: create the administrator with `qinqin adduser --admin --username <name>`; registration stays closed until then")
		if password != "" {
			logf("bootstrap: QINQIN_BOOTSTRAP_PASSWORD is set but ignored while the bootstrap is off; remove it")
		}
		return nil
	}
	if name == "" {
		name = defaultBootstrapAdmin
	}
	if err := auth.CheckNewUsername(ctx, sqlDB, name); err != nil {
		return fmt.Errorf("QINQIN_BOOTSTRAP_ADMIN: %s", reasonOr(err))
	}
	generated := password == ""
	if generated {
		password = generatePassword()
	}
	if err := auth.CheckPassword(name, password); err != nil {
		return fmt.Errorf("QINQIN_BOOTSTRAP_PASSWORD: %s", reasonOr(err))
	}
	if _, err := bootstrapAdmin(ctx, sqlDB, name, password); err != nil {
		if errors.Is(err, auth.ErrNotFirst) {
			return nil // another process won the race: it logged its own password
		}
		return fmt.Errorf("QINQIN_BOOTSTRAP_ADMIN: %w", err)
	}
	logf("bootstrap: created administrator %q; the password must be changed at the first sign-in", name)
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
