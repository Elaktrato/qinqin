package main

import (
	"context"
	"database/sql"
	"time"

	"qinqin/internal/ai"
)

// aiFromEnv builds the AI service from QINQIN_SECRET, QINQIN_SECRET_PREVIOUS
// and QINQIN_AI_PROVIDER. It never fails: a missing or malformed secret turns
// AI off with a reason (the key store stays nil, so nothing can be stored in
// plain text) and the server still starts. It logs state words only, never a
// secret or its fingerprint.
func aiFromEnv(sqlDB *sql.DB, getenv func(string) string, logf func(string, ...any)) *ai.Service {
	svc := &ai.Service{Limiter: &ai.Limiter{DB: sqlDB, PerHour: ai.HourlyLimit}}

	secret, state := ai.ParseSecret(getenv("QINQIN_SECRET"))
	svc.Secret = state
	logf("AI: QINQIN_SECRET %s", state)
	switch state {
	case ai.SecretInvalid:
		logf("AI disabled: QINQIN_SECRET is not 32 bytes of base64")
	case ai.SecretMissing:
		logf("AI keys cannot be stored: QINQIN_SECRET is not set")
	}

	switch p := getenv("QINQIN_AI_PROVIDER"); p {
	case "", "anthropic":
		svc.Provider, svc.ProviderName = ai.NewClaude(), "anthropic"
	case "fake":
		svc.Provider, svc.ProviderName = ai.Fake{}, "fake"
		logf("AI provider: fake (test only, no real AI)")
	default:
		logf("AI disabled: unknown QINQIN_AI_PROVIDER %q", p)
	}

	if state != ai.SecretOK {
		return svc
	}
	svc.Keys = &ai.KeyStore{DB: sqlDB, Current: ai.NewSealer(secret)}
	if raw := getenv("QINQIN_SECRET_PREVIOUS"); raw != "" {
		prev, pstate := ai.ParseSecret(raw)
		if pstate != ai.SecretOK {
			logf("AI: QINQIN_SECRET_PREVIOUS is not 32 bytes of base64; ignored")
			return svc
		}
		svc.Keys.Previous = ai.NewSealer(prev)
		n, err := svc.Keys.Rotate(context.Background())
		if err != nil {
			logf("AI: rotating keys to the new QINQIN_SECRET failed: %v", err)
		} else {
			logf("rotated %d AI keys to the new QINQIN_SECRET", n)
		}
	}
	return svc
}

// aiJanitor prunes AI call rows older than 7 days at start and then every
// interval, until ctx ends.
func aiJanitor(ctx context.Context, svc *ai.Service, every time.Duration, logf func(string, ...any)) {
	if svc == nil || svc.Limiter == nil {
		return
	}
	sweep := func() {
		if err := svc.Limiter.Prune(ctx, 7*24*time.Hour); err != nil && ctx.Err() == nil {
			logf("AI janitor: %v", err)
		}
	}
	sweep()
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			sweep()
		}
	}
}
