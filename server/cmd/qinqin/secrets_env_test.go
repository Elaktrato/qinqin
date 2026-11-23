package main

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"qinqin/internal/auth"
	"qinqin/internal/dbtest"
	"qinqin/internal/mail"
	"qinqin/internal/netguard"
	"qinqin/internal/secretbox"
)

func b64seed(seed byte) string {
	b := make([]byte, 32)
	for i := range b {
		b[i] = seed + byte(i)
	}
	return base64.StdEncoding.EncodeToString(b)
}

func TestSecretsFromEnv(t *testing.T) {
	get := func(m map[string]string) func(string) string { return func(k string) string { return m[k] } }
	if s := secretsFromEnv(get(nil)); s.State != secretbox.SecretMissing || s.Current != nil {
		t.Errorf("unset: %+v", s)
	}
	if s := secretsFromEnv(get(map[string]string{"QINQIN_SECRET": "short"})); s.State != secretbox.SecretInvalid || s.Current != nil {
		t.Errorf("invalid: %+v", s)
	}
	s := secretsFromEnv(get(map[string]string{"QINQIN_SECRET": b64seed(1), "QINQIN_SECRET_PREVIOUS": b64seed(2)}))
	if s.State != secretbox.SecretOK || s.Current == nil || s.Previous == nil || s.PreviousInvalid {
		t.Errorf("both: %+v", s)
	}
	s = secretsFromEnv(get(map[string]string{"QINQIN_SECRET": b64seed(1), "QINQIN_SECRET_PREVIOUS": "garbage"}))
	if s.Current == nil || s.Previous != nil || !s.PreviousInvalid {
		t.Errorf("bad previous: %+v", s)
	}
}

func TestRotateSecretsReSealsMailAndTOTP(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	get := func(cur, prev string) secrets {
		m := map[string]string{"QINQIN_SECRET": cur}
		if prev != "" {
			m["QINQIN_SECRET_PREVIOUS"] = prev
		}
		return secretsFromEnv(func(k string) string { return m[k] })
	}
	old := get(b64seed(1), "")
	u, _ := auth.CreateUser(ctx, sqlDB, "alice", "secret-pass-1", false)

	// sealed under the OLD secret
	oldStore := &mail.Store{DB: sqlDB, Current: old.Current, Policy: netguard.GuardPolicy{AllowPrivate: true}}
	pw := "smtp-rotate-sentinel"
	p, err := oldStore.Prepare(ctx, mail.Input{Config: mail.Config{Host: "mail.example.org", Port: 587, TLS: mail.ModeStartTLS, Username: "u",
		FromAddress: "q@example.org", PublicURL: "https://x.example.org"}, PasswordValue: &pw})
	if err != nil {
		t.Fatal(err)
	}
	if err := oldStore.Save(ctx, p, 0); err != nil {
		t.Fatal(err)
	}
	oldMFA := &auth.MFA{DB: sqlDB, Current: old.Current}
	at := time.Now()
	secret, _, _ := oldMFA.BeginTOTP(ctx, u.ID, at)
	code, _ := auth.TOTPCode(secret, at)
	if _, err := oldMFA.ConfirmTOTP(ctx, u.ID, code, at); err != nil {
		t.Fatal(err)
	}
	oldMFA.BeginTOTP(ctx, u.ID, at) // a pending secret too

	// the new secret, the old one as PREVIOUS
	cur := get(b64seed(50), b64seed(1))
	var logs []string
	logf := func(f string, a ...any) { logs = append(logs, fmt.Sprintf(f, a...)) }
	svc := mailFromEnv(sqlDB, cur, func(string) string { return "" }, logf)
	rotateSecrets(ctx, sqlDB, cur, svc, logf)
	joined := strings.Join(logs, "\n")
	if !strings.Contains(joined, "rotated 2 two-factor secrets and 1 mail passwords") {
		t.Errorf("logs = %q", joined)
	}
	for _, leak := range []string{pw, secret, b64seed(1), b64seed(50)} {
		if strings.Contains(joined, leak) {
			t.Errorf("log leaks a secret: %q", joined)
		}
	}
	// now only the NEW secret is needed
	newOnly := get(b64seed(50), "")
	st := &mail.Store{DB: sqlDB, Current: newOnly.Current, Policy: netguard.GuardPolicy{AllowPrivate: true}}
	if c, _ := st.Load(ctx); c == nil || c.Password != mail.PasswordSet {
		t.Errorf("mail password after rotation: %+v", c)
	}
	if _, err := st.PrepareStored(ctx); err != nil {
		t.Errorf("stored password does not open: %v", err)
	}
	newMFA := &auth.MFA{DB: sqlDB, Current: newOnly.Current}
	later := at.Add(time.Minute)
	if err := newMFA.VerifyTOTP(ctx, u.ID, mustTOTP(secret, later), later); err != nil {
		t.Errorf("TOTP after rotation: %v", err)
	}
	// a second run is a no-op
	logs = nil
	rotateSecrets(ctx, sqlDB, cur, svc, logf)
	if len(logs) != 0 {
		t.Errorf("second run logged %q", logs)
	}

	// a third, unknown secret: undecryptable states, recovery codes still work
	stranger := get(b64seed(99), "")
	sst := &mail.Store{DB: sqlDB, Current: stranger.Current}
	if c, _ := sst.Load(ctx); c == nil || c.Password != mail.PasswordUndecryptable || sst.Configured(ctx) {
		t.Errorf("unknown secret: %+v configured=%v", c, sst.Configured(ctx))
	}
	smfa := &auth.MFA{DB: sqlDB, Current: stranger.Current}
	if err := smfa.VerifyTOTP(ctx, u.ID, mustTOTP(secret, later.Add(time.Minute)), later.Add(time.Minute)); !errors.Is(err, auth.ErrMFAUnavailable) {
		t.Errorf("TOTP with an unknown secret: %v", err)
	}
}

func mustTOTP(secret string, at time.Time) string {
	c, err := auth.TOTPCode(secret, at)
	if err != nil {
		panic(err)
	}
	return c
}
