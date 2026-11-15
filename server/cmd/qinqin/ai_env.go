package main

import (
	"context"
	"database/sql"
	"strings"
	"time"

	"github.com/anthropics/anthropic-sdk-go/v2/option"

	"qinqin/internal/ai"
)

func truthy(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true":
		return true
	}
	return false
}

// parseProviders reads QINQIN_AI_PROVIDERS: built-in ids plus "custom".
// Unknown ids are logged and ignored.
func parseProviders(list string, logf func(string, ...any)) map[string]bool {
	known := map[string]bool{"custom": true}
	for _, b := range ai.Builtins() {
		known[b.ID] = true
	}
	out := map[string]bool{}
	for _, id := range strings.Split(list, ",") {
		id = strings.TrimSpace(id)
		switch {
		case id == "":
		case known[id]:
			out[id] = true
		default:
			logf("AI: QINQIN_AI_PROVIDERS: unknown provider %q ignored", id)
		}
	}
	return out
}

// aiFromEnv builds the AI service from QINQIN_SECRET, QINQIN_SECRET_PREVIOUS
// and QINQIN_AI_PROVIDER. It never fails: a missing or malformed secret turns
// AI off with a reason (the key store stays nil, so nothing can be stored in
// plain text) and the server still starts. It logs state words only, never a
// secret or its fingerprint.
func aiFromEnv(sqlDB *sql.DB, getenv func(string) string, logf func(string, ...any)) *ai.Service {
	allowPrivate := truthy(getenv("QINQIN_AI_ALLOW_PRIVATE"))
	policy := ai.GuardPolicy{AllowPrivate: allowPrivate}
	reg := &ai.Registry{Custom: &ai.CustomStore{DB: sqlDB, Policy: policy}}
	svc := &ai.Service{
		Registry:  reg,
		Selection: &ai.Selection{DB: sqlDB},
		Limiter:   &ai.Limiter{DB: sqlDB, PerHour: ai.HourlyLimit},
	}

	secret, state := ai.ParseSecret(getenv("QINQIN_SECRET"))
	svc.Secret = state
	logf("AI: QINQIN_SECRET %s", state)
	switch state {
	case ai.SecretInvalid:
		logf("AI disabled: QINQIN_SECRET is not 32 bytes of base64")
	case ai.SecretMissing:
		logf("AI keys cannot be stored: QINQIN_SECRET is not set")
	}
	if allowPrivate {
		logf("AI: custom endpoints may reach private addresses")
	}

	realAdapters := func() {
		builtin := ai.NewBuiltinClient(nil)
		svc.Adapters = map[ai.Kind]ai.Provider{
			ai.KindAnthropic: ai.NewClaude(option.WithHTTPClient(builtin)),
			ai.KindOpenAI:    &ai.OpenAICompat{HTTP: builtin, CustomHTTP: ai.NewGuardedClient(policy, nil), Spec: reg.Lookup},
			ai.KindGemini:    &ai.Gemini{HTTP: builtin},
		}
	}
	switch p := getenv("QINQIN_AI_PROVIDER"); p {
	case "":
		realAdapters()
	case "anthropic":
		realAdapters()
		reg.Enabled = map[string]bool{"anthropic": true}
		logf("AI: QINQIN_AI_PROVIDER=anthropic limits AI to Anthropic; use QINQIN_AI_PROVIDERS to choose providers")
	case "fake":
		svc.Fake = true
		logf("AI provider: fake (test only, no real AI)")
	default:
		logf("AI disabled: unknown QINQIN_AI_PROVIDER %q", p)
	}
	if list := getenv("QINQIN_AI_PROVIDERS"); strings.TrimSpace(list) != "" {
		reg.Enabled = parseProviders(list, logf)
	}

	if state != ai.SecretOK {
		return svc
	}
	svc.Keys = &ai.KeyStore{DB: sqlDB, Current: ai.NewSealer(secret), AADFor: reg.AADFor}
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
