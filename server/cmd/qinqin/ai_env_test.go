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

func newEnvSvc(t *testing.T, env map[string]string) (*ai.Service, string) {
	t.Helper()
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	var logs strings.Builder
	svc := aiFromEnv(sqlDB, func(k string) string { return env[k] }, func(f string, a ...any) { fmt.Fprintf(&logs, f+"\n", a...) })
	return svc, logs.String()
}

func TestAIFromEnv(t *testing.T) {
	secretA := b64(1)
	cases := []struct {
		name, secret, provider string
		wantSecret             ai.SecretState
		wantFake, wantAdapters bool
		wantKeys               bool
	}{
		{"missing default", "", "", ai.SecretMissing, false, true, false},
		{"missing fake", "", "fake", ai.SecretMissing, true, false, false},
		{"invalid default", "not base64!", "", ai.SecretInvalid, false, true, false},
		{"invalid nope", "short", "nope", ai.SecretInvalid, false, false, false},
		{"ok default", secretA, "", ai.SecretOK, false, true, true},
		{"ok anthropic", secretA, "anthropic", ai.SecretOK, false, true, true},
		{"ok fake", secretA, "fake", ai.SecretOK, true, false, true},
		{"ok nope", secretA, "nope", ai.SecretOK, false, false, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc, logs := newEnvSvc(t, map[string]string{"QINQIN_SECRET": tc.secret, "QINQIN_AI_PROVIDER": tc.provider})
			if svc.Secret != tc.wantSecret || (svc.Keys != nil) != tc.wantKeys || svc.Limiter == nil || svc.Limiter.PerHour != 30 {
				t.Fatalf("service = %+v", svc)
			}
			if svc.Fake != tc.wantFake || (len(svc.Adapters) == 3) != tc.wantAdapters {
				t.Errorf("Fake=%v adapters=%d", svc.Fake, len(svc.Adapters))
			}
			if tc.wantAdapters {
				if _, ok := svc.Adapters[ai.KindAnthropic].(*ai.Claude); !ok {
					t.Errorf("anthropic adapter = %T", svc.Adapters[ai.KindAnthropic])
				}
				if _, ok := svc.Adapters[ai.KindOpenAI].(*ai.OpenAICompat); !ok {
					t.Errorf("openai adapter = %T", svc.Adapters[ai.KindOpenAI])
				}
				if _, ok := svc.Adapters[ai.KindGemini].(*ai.Gemini); !ok {
					t.Errorf("gemini adapter = %T", svc.Adapters[ai.KindGemini])
				}
			}
			if svc.Registry == nil || svc.Selection == nil {
				t.Errorf("registry/selection missing")
			}
			if tc.secret != "" && strings.Contains(logs, tc.secret) {
				t.Errorf("log leaks the secret:\n%s", logs)
			}
			if tc.wantFake && !strings.Contains(logs, "AI provider: fake (test only, no real AI)") {
				t.Errorf("fake provider must warn:\n%s", logs)
			}
			if tc.provider == "nope" && !strings.Contains(logs, "unknown QINQIN_AI_PROVIDER") {
				t.Errorf("unknown provider must log an error:\n%s", logs)
			}
			if !strings.Contains(logs, "QINQIN_SECRET "+string(tc.wantSecret)) {
				t.Errorf("state word missing:\n%s", logs)
			}
		})
	}
}

func TestAIEnvLegacyAnthropicLimits(t *testing.T) {
	enabled := func(env map[string]string) (map[string]bool, string) {
		svc, logs := newEnvSvc(t, env)
		return svc.Registry.Enabled, logs
	}
	if e, _ := enabled(map[string]string{}); e != nil {
		t.Errorf("unset: Enabled = %v, want nil (all)", e)
	}
	e, logs := enabled(map[string]string{"QINQIN_AI_PROVIDER": "anthropic"})
	if len(e) != 1 || !e["anthropic"] {
		t.Errorf("explicit anthropic: Enabled = %v", e)
	}
	if !strings.Contains(logs, "AI: QINQIN_AI_PROVIDER=anthropic limits AI to Anthropic; use QINQIN_AI_PROVIDERS to choose providers") {
		t.Errorf("hint missing:\n%s", logs)
	}
	e, _ = enabled(map[string]string{"QINQIN_AI_PROVIDERS": "openai,custom"})
	if len(e) != 2 || !e["openai"] || !e["custom"] {
		t.Errorf("providers list: Enabled = %v", e)
	}
	// The list overrides the legacy limit; spaces and unknown ids are tolerated.
	e, logs = enabled(map[string]string{"QINQIN_AI_PROVIDER": "anthropic", "QINQIN_AI_PROVIDERS": " gemini , nope ,deepseek"})
	if len(e) != 2 || !e["gemini"] || !e["deepseek"] || e["anthropic"] {
		t.Errorf("override: Enabled = %v", e)
	}
	if !strings.Contains(logs, `unknown provider "nope"`) {
		t.Errorf("unknown id not logged:\n%s", logs)
	}
	// The fake switch keeps every provider listed.
	if e, _ := enabled(map[string]string{"QINQIN_AI_PROVIDER": "fake"}); e != nil {
		t.Errorf("fake: Enabled = %v", e)
	}
}

func TestAIEnvAllowPrivate(t *testing.T) {
	for val, want := range map[string]bool{"": false, "0": false, "no": false, "1": true, "true": true, "TRUE": true} {
		svc, logs := newEnvSvc(t, map[string]string{"QINQIN_SECRET": b64(1), "QINQIN_AI_ALLOW_PRIVATE": val})
		if got := svc.Registry.Custom.Policy.AllowPrivate; got != want {
			t.Errorf("%q: AllowPrivate = %v, want %v", val, got, want)
		}
		if has := strings.Contains(logs, "AI: custom endpoints may reach private addresses"); has != want {
			t.Errorf("%q: log has hint = %v", val, has)
		}
		// The switch decides what an admin may register.
		_, err := svc.Registry.Custom.Create(context.Background(), 1, ai.CustomInput{Name: "Ollama", BaseURL: "http://127.0.0.1:11434/v1", DefaultModel: "m"})
		if (err == nil) != want {
			t.Errorf("%q: create loopback endpoint err = %v", val, err)
		}
	}
}

func TestAIEnvAdaptersUseGuardedClients(t *testing.T) {
	svc, _ := newEnvSvc(t, map[string]string{"QINQIN_SECRET": b64(1)})
	oa := svc.Adapters[ai.KindOpenAI].(*ai.OpenAICompat)
	if oa.HTTP == nil || oa.CustomHTTP == nil || oa.HTTP == oa.CustomHTTP {
		t.Errorf("OpenAICompat clients: %v %v", oa.HTTP, oa.CustomHTTP)
	}
	if svc.Keys.AADFor == nil {
		t.Error("key store has no AADFor: custom keys would not bind the base URL")
	}
}

func TestAIEnvLogsNoSecret(t *testing.T) {
	env := map[string]string{"QINQIN_SECRET": b64(7), "QINQIN_SECRET_PREVIOUS": b64(8), "QINQIN_AI_ALLOW_PRIVATE": "1", "QINQIN_AI_PROVIDERS": "openai,custom"}
	_, logs := newEnvSvc(t, env)
	for _, bad := range []string{b64(7), b64(8)} {
		if strings.Contains(logs, bad) {
			t.Errorf("log leaks a secret:\n%s", logs)
		}
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
	if err := old.Put(ctx, 1, "anthropic", "sk-ant-rotate-1234", "", ai.PutOptions{}); err != nil {
		t.Fatal(err)
	}
	var logs strings.Builder
	env := map[string]string{"QINQIN_SECRET": b64(2), "QINQIN_SECRET_PREVIOUS": b64(1)}
	svc := aiFromEnv(sqlDB, func(k string) string { return env[k] }, func(f string, a ...any) { fmt.Fprintf(&logs, f+"\n", a...) })
	c, err := svc.Keys.Credentials(ctx, 1, "anthropic")
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
