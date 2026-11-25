package main

import (
	"context"
	"database/sql"
	"time"

	"qinqin/internal/auth"
	"qinqin/internal/mail"
	"qinqin/internal/reminders"
	"qinqin/internal/secretbox"
)

// secrets is QINQIN_SECRET and QINQIN_SECRET_PREVIOUS as read once, handed to
// the AI key store, the mail settings and the two-factor store.
type secrets struct {
	State           secretbox.SecretState
	Current         *secretbox.Sealer // nil unless State is ok
	Previous        *secretbox.Sealer // nil when unset or unusable
	PreviousInvalid bool              // QINQIN_SECRET_PREVIOUS was set but is not 32 bytes of base64
}

// secretsFromEnv parses the two variables. It never fails and logs nothing:
// each consumer words its own state.
func secretsFromEnv(getenv func(string) string) secrets {
	raw, state := secretbox.ParseSecret(getenv("QINQIN_SECRET"))
	sec := secrets{State: state}
	if state != secretbox.SecretOK {
		return sec
	}
	sec.Current = secretbox.NewSealer(raw)
	if p := getenv("QINQIN_SECRET_PREVIOUS"); p != "" {
		prev, pstate := secretbox.ParseSecret(p)
		if pstate != secretbox.SecretOK {
			sec.PreviousInvalid = true
			return sec
		}
		sec.Previous = secretbox.NewSealer(prev)
	}
	return sec
}

// rotateSecrets re-seals what QINQIN_SECRET_PREVIOUS sealed in the mail
// settings and the two-factor store (the AI keys rotate in aiFromEnv). It
// logs counts only.
func rotateSecrets(ctx context.Context, sqlDB *sql.DB, sec secrets, svc *mail.Service, logf func(string, ...any)) {
	if sec.Current == nil || sec.Previous == nil {
		return
	}
	mfa := &auth.MFA{DB: sqlDB, Current: sec.Current, Previous: sec.Previous}
	nTOTP, err := mfa.Rotate(ctx)
	if err != nil {
		logf("rotating two-factor secrets to the new QINQIN_SECRET failed: %v", err)
	}
	nMail, err := svc.Store.Rotate(ctx)
	if err != nil {
		logf("rotating the mail password to the new QINQIN_SECRET failed: %v", err)
	}
	// The web push key is otherwise re-sealed only on its first use after the
	// restart, which may be days away; do it now so PREVIOUS can go at once.
	var hasKey int
	if err := sqlDB.QueryRowContext(ctx, `SELECT COUNT(*) FROM push_vapid`).Scan(&hasKey); err == nil && hasKey > 0 {
		if _, err := reminders.LoadVAPID(ctx, sqlDB, sec.Current, sec.Previous, time.Now()); err != nil {
			logf("rotating the web push key to the new QINQIN_SECRET failed: %v", err)
		}
	}
	if nTOTP > 0 || nMail > 0 {
		logf("rotated %d two-factor secrets and %d mail passwords to the new QINQIN_SECRET", nTOTP, nMail)
	}
}
