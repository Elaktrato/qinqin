package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"qinqin/internal/ai"
	"qinqin/internal/db"
	"qinqin/internal/plugins"
)

func b64(b byte) string { return base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{b}, 32)) }

func TestAIFromEnv(t *testing.T) {
	secretA := b64(1)
	cases := []struct {
		name, secret, provider string
		wantSecret             ai.SecretState
		wantProvider           string // "claude", "fake" or "nil"
		wantKeys               bool
	}{
		{"missing default", "", "", ai.SecretMissing, "claude", false},
		{"missing fake", "", "fake", ai.SecretMissing, "fake", false},
		{"invalid default", "not base64!", "", ai.SecretInvalid, "claude", false},
		{"invalid nope", "short", "nope", ai.SecretInvalid, "nil", false},
		{"ok default", secretA, "", ai.SecretOK, "claude", true},
		{"ok anthropic", secretA, "anthropic", ai.SecretOK, "claude", true},
		{"ok fake", secretA, "fake", ai.SecretOK, "fake", true},
		{"ok nope", secretA, "nope", ai.SecretOK, "nil", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			sqlDB, err := db.Open(filepath.Join(t.TempDir(), "t.db"))
			if err != nil {
				t.Fatal(err)
			}
			defer sqlDB.Close()
			var logs strings.Builder
			env := map[string]string{"QINQIN_SECRET": tc.secret, "QINQIN_AI_PROVIDER": tc.provider}
			svc := aiFromEnv(sqlDB, func(k string) string { return env[k] }, func(f string, a ...any) { fmt.Fprintf(&logs, f+"\n", a...) })
			if svc.Secret != tc.wantSecret || (svc.Keys != nil) != tc.wantKeys || svc.Limiter == nil || svc.Limiter.PerHour != 30 {
				t.Fatalf("service = %+v", svc)
			}
			got := "nil"
			switch svc.Provider.(type) {
			case *ai.Claude:
				got = "claude"
			case ai.Fake:
				got = "fake"
			}
			if got != tc.wantProvider {
				t.Errorf("provider = %s, want %s", got, tc.wantProvider)
			}
			wantName := tc.provider
			if wantName == "" || wantName == "anthropic" {
				wantName = "anthropic"
			}
			if got != "nil" && svc.ProviderName != wantName {
				t.Errorf("ProviderName = %q", svc.ProviderName)
			}
			if tc.secret != "" && strings.Contains(logs.String(), tc.secret) {
				t.Errorf("log leaks the secret:\n%s", logs.String())
			}
			if tc.wantProvider == "fake" && !strings.Contains(logs.String(), "AI provider: fake (test only, no real AI)") {
				t.Errorf("fake provider must warn:\n%s", logs.String())
			}
			if tc.wantProvider == "nil" && !strings.Contains(logs.String(), "unknown QINQIN_AI_PROVIDER") {
				t.Errorf("unknown provider must log an error:\n%s", logs.String())
			}
			if !strings.Contains(logs.String(), "QINQIN_SECRET "+string(tc.wantSecret)) {
				t.Errorf("state word missing:\n%s", logs.String())
			}
		})
	}
}

func TestAIFromEnvRotates(t *testing.T) {
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	ctx := context.Background()
	a, _ := ai.ParseSecret(b64(1))
	old := &ai.KeyStore{DB: sqlDB, Current: ai.NewSealer(a)}
	if err := old.Put(ctx, 1, "anthropic", "sk-ant-rotate-1234", ""); err != nil {
		t.Fatal(err)
	}
	var logs strings.Builder
	env := map[string]string{"QINQIN_SECRET": b64(2), "QINQIN_SECRET_PREVIOUS": b64(1)}
	svc := aiFromEnv(sqlDB, func(k string) string { return env[k] }, func(f string, a ...any) { fmt.Fprintf(&logs, f+"\n", a...) })
	c, err := svc.Keys.Credentials(ctx, 1)
	if err != nil || c.APIKey != "sk-ant-rotate-1234" {
		t.Fatalf("credentials after rotation: %v", err)
	}
	if !strings.Contains(logs.String(), "rotated 1 AI keys to the new QINQIN_SECRET") {
		t.Errorf("log = %s", logs.String())
	}
	if strings.Contains(logs.String(), b64(1)) || strings.Contains(logs.String(), b64(2)) {
		t.Errorf("log leaks a secret")
	}

	// A malformed previous secret is ignored with a log line; the server still starts.
	env = map[string]string{"QINQIN_SECRET": b64(2), "QINQIN_SECRET_PREVIOUS": "garbage"}
	logs.Reset()
	svc = aiFromEnv(sqlDB, func(k string) string { return env[k] }, func(f string, a ...any) { fmt.Fprintf(&logs, f+"\n", a...) })
	if svc.Secret != ai.SecretOK || !strings.Contains(logs.String(), "QINQIN_SECRET_PREVIOUS") {
		t.Errorf("secret=%s log=%s", svc.Secret, logs.String())
	}
}

func TestAIJanitorPrunesOldCalls(t *testing.T) {
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	old := time.Now().UTC().Add(-8 * 24 * time.Hour).Format(time.RFC3339)
	fresh := time.Now().UTC().Format(time.RFC3339)
	for _, at := range []string{old, fresh} {
		if _, err := sqlDB.Exec(`INSERT INTO ai_calls (user_id, kind, model, ok, at) VALUES (1, 'review', 'm', 1, ?)`, at); err != nil {
			t.Fatal(err)
		}
	}
	svc := &ai.Service{Limiter: &ai.Limiter{DB: sqlDB, PerHour: 30}}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { aiJanitor(ctx, svc, time.Hour, func(string, ...any) {}); close(done) }()
	deadline := time.Now().Add(5 * time.Second)
	for {
		var n int
		_ = sqlDB.QueryRow(`SELECT COUNT(*) FROM ai_calls`).Scan(&n)
		if n == 1 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("old call row was not pruned (rows: %d)", n)
		}
		time.Sleep(10 * time.Millisecond)
	}
	cancel()
	<-done
}

func TestBuiltinJournalManifest(t *testing.T) {
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	if err := registerBuiltinPlugins(context.Background(), sqlDB); err != nil {
		t.Fatal(err)
	}
	var m string
	if err := sqlDB.QueryRow(`SELECT manifest_json FROM plugin_registry WHERE pack_id = 'qinqin-journal'`).Scan(&m); err != nil {
		t.Fatalf("journal not registered: %v", err)
	}
	parsed, err := plugins.ParseManifest([]byte(m))
	if err != nil || parsed.Name != "Journal" || len(parsed.Surfaces) != 1 || parsed.Surfaces[0] != "page" {
		t.Errorf("manifest = %s (err %v)", m, err)
	}
}
