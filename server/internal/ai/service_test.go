package ai

import (
	"context"
	"errors"
	"testing"
	"time"

	"qinqin/internal/dbtest"
)

func newTestService(t *testing.T, mut func(*Service)) (*Service, *KeyStore) {
	t.Helper()
	sqlDB := dbtest.Open(t)
	keys := newStore(sqlDB, 1, 0)
	reg := &Registry{Custom: &CustomStore{DB: sqlDB}}
	keys.AADFor = reg.AADFor
	svc := &Service{
		Adapters: map[Kind]Provider{KindAnthropic: Fake{}, KindOpenAI: Fake{}, KindGemini: Fake{}},
		Registry: reg, Secret: SecretOK, Keys: keys,
		Selection: &Selection{DB: sqlDB, Now: time.Now},
		Limiter:   &Limiter{DB: sqlDB, PerHour: 30, Now: time.Now},
	}
	if mut != nil {
		mut(svc)
	}
	return svc, keys
}

type tagged struct {
	Fake
	tag string
}

func TestServiceStatusReasons(t *testing.T) {
	ctx := context.Background()

	var nilSvc *Service
	st, err := nilSvc.Status(ctx, 1)
	if err != nil || st.Reason != "no_secret" || st.Available || st.Key != nil {
		t.Errorf("nil service: %+v, %v", st, err)
	}
	if len(st.Models) != len(Models) {
		t.Errorf("models = %v", st.Models)
	}

	svc, keys := newTestService(t, func(s *Service) { s.Fake = true; s.Adapters = nil })
	check := func(name string, s *Service, reason string, available bool) Status {
		t.Helper()
		st, err := s.Status(ctx, 1)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if st.Reason != reason || st.Available != available {
			t.Errorf("%s: reason %q available %v, want %q %v", name, st.Reason, st.Available, reason, available)
		}
		return st
	}
	check("missing", &Service{Secret: SecretMissing}, "no_secret", false)
	check("invalid", &Service{Secret: SecretInvalid}, "invalid_secret", false)
	check("no provider", &Service{Secret: SecretOK, Keys: keys, Limiter: svc.Limiter, Selection: svc.Selection}, "no_provider", false)
	check("no keys at all", svc, "no_key", false)

	if err := newStore(svc.Keys.DB, 9, 0).Put(ctx, 1, "anthropic", testKey, "", PutOptions{}); err != nil {
		t.Fatal(err)
	}
	check("keys but none chosen", svc, "no_selection", false)
	if err := svc.Selection.SetActive(ctx, 1, "anthropic"); err != nil {
		t.Fatal(err)
	}
	st = check("other secret", svc, "key_undecryptable", false)
	if st.Key == nil || st.Key.State != KeyUndecryptable {
		t.Errorf("key = %+v", st.Key)
	}

	if err := keys.Put(ctx, 1, "anthropic", testKey, "", PutOptions{}); err != nil {
		t.Fatal(err)
	}
	_ = svc.Limiter.Record(ctx, Call{UserID: 1, Kind: "review", Model: DefaultModel, OK: true, Usage: Usage{InputTokens: 12, OutputTokens: 34}})
	st = check("good", svc, "", true)
	if st.Provider != "fake" || !st.Fake || st.Secret != SecretOK || st.Key == nil || st.Key.Hint != "…1234" {
		t.Errorf("status = %+v", st)
	}
	if st.Usage.CallsLastHour != 1 || st.Usage.LimitPerHour != 30 || st.Usage.InputTokens != 12 || st.Usage.OutputTokens != 34 {
		t.Errorf("usage = %+v", st.Usage)
	}
}

func TestStatusActive(t *testing.T) {
	ctx := context.Background()
	svc, keys := newTestService(t, nil)
	if err := keys.Put(ctx, 1, "deepseek", "sk-fake-deepseek-0001xx", "deepseek-v4-pro", PutOptions{}); err != nil {
		t.Fatal(err)
	}
	if err := keys.Put(ctx, 1, "anthropic", testKey, "", PutOptions{}); err != nil {
		t.Fatal(err)
	}
	if err := svc.Selection.SetActive(ctx, 1, "deepseek"); err != nil {
		t.Fatal(err)
	}
	st, err := svc.Status(ctx, 1)
	if err != nil || !st.Available || st.Provider != "deepseek" || st.Fake {
		t.Fatalf("status = %+v, %v", st, err)
	}
	a := st.Active
	if a == nil || a.Provider != "deepseek" || a.Name != "DeepSeek" || a.Model != "deepseek-v4-pro" || a.Vision || a.Structured != StructuredObject {
		t.Errorf("active = %+v", a)
	}
	if len(st.Keys) != 2 || st.Key == nil || st.Key.Provider != "deepseek" {
		t.Errorf("keys = %+v key = %+v", st.Keys, st.Key)
	}
	if len(st.Models) != 2 || st.Models[0].ID != "deepseek-flash" {
		t.Errorf("models = %+v", st.Models)
	}
}

func TestForUsesSelection(t *testing.T) {
	ctx := context.Background()
	anth, oa := &tagged{tag: "anthropic"}, &tagged{tag: "openai"}
	svc, keys := newTestService(t, func(s *Service) {
		s.Adapters = map[Kind]Provider{KindAnthropic: anth, KindOpenAI: oa}
	})
	if err := keys.Put(ctx, 1, "anthropic", "sk-ant-key-1111", "claude-haiku-5-5", PutOptions{}); err != nil {
		t.Fatal(err)
	}
	if err := keys.Put(ctx, 1, "openai", "sk-fake-openai-2222", "gpt-6-luna", PutOptions{}); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := svc.For(ctx, 1); !errors.Is(err, ErrNoSelection) {
		t.Fatalf("For without a selection = %v, want ErrNoSelection", err)
	}
	if _, _, _, err := svc.For(ctx, 2); !errors.Is(err, ErrNoKey) {
		t.Fatalf("For for a user without any key = %v, want ErrNoKey", err)
	}
	if err := svc.Selection.SetActive(ctx, 1, "openai"); err != nil {
		t.Fatal(err)
	}
	p, spec, c, err := svc.For(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	if p != Provider(oa) || spec.ID != "openai" || c.APIKey != "sk-fake-openai-2222" || c.Model != "gpt-6-luna" || c.Provider != "openai" || c.BaseURL != "https://api.openai.com/v1" {
		t.Errorf("For = %v %s %q %q %q %q", p, spec.ID, c.APIKey, c.Model, c.Provider, c.BaseURL)
	}
	// Another user has nothing: user 1's provider and key are not theirs.
	if _, _, _, err := svc.For(ctx, 2); !errors.Is(err, ErrNoKey) {
		t.Errorf("For(user 2) = %v", err)
	}
	// A key of the user's other provider is not used for the selected one.
	if err := svc.Selection.SetActive(ctx, 1, "anthropic"); err != nil {
		t.Fatal(err)
	}
	p, _, c, _ = svc.For(ctx, 1)
	if p != Provider(anth) || c.APIKey != "sk-ant-key-1111" {
		t.Errorf("after switch: %v %q", p, c.APIKey)
	}
}

func TestForUnknownCustomGone(t *testing.T) {
	ctx := context.Background()
	svc, keys := newTestService(t, nil)
	sp, err := svc.Registry.Custom.Create(ctx, 1, CustomInput{Name: "Local", BaseURL: "https://llm.example.com/v1", DefaultModel: "m", KeyRequired: true})
	if err != nil {
		t.Fatal(err)
	}
	if err := keys.Put(ctx, 1, sp.ID, "sk-fake-custom-key-0001", "m", PutOptions{}); err != nil {
		t.Fatal(err)
	}
	if err := svc.Selection.SetActive(ctx, 1, sp.ID); err != nil {
		t.Fatal(err)
	}
	if _, got, c, err := svc.For(ctx, 1); err != nil || got.ID != sp.ID || c.BaseURL != "https://llm.example.com/v1" || c.APIKey != "sk-fake-custom-key-0001" {
		t.Fatalf("For custom = %+v %v", got, err)
	}
	// An admin deleted the endpoint without cleaning up (or a race): the
	// selection must clear, not point at nothing.
	if err := svc.Registry.Custom.Delete(ctx, sp.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := svc.For(ctx, 1); !errors.Is(err, ErrNoKey) {
		t.Errorf("For after delete = %v, want ErrNoKey", err)
	}
	if _, err := svc.Selection.Active(ctx, 1); !errors.Is(err, ErrNoSelection) {
		t.Errorf("selection after delete = %v, want cleared", err)
	}
}

func TestCustomRowMovedToOtherBaseURLFailsToDecrypt(t *testing.T) {
	ctx := context.Background()
	svc, keys := newTestService(t, nil)
	sp, err := svc.Registry.Custom.Create(ctx, 1, CustomInput{Name: "Local", BaseURL: "https://good.example.com/v1", DefaultModel: "m", KeyRequired: true})
	if err != nil {
		t.Fatal(err)
	}
	if err := keys.Put(ctx, 1, sp.ID, "sk-fake-custom-key-0001", "m", PutOptions{}); err != nil {
		t.Fatal(err)
	}
	if err := svc.Selection.SetActive(ctx, 1, sp.ID); err != nil {
		t.Fatal(err)
	}
	// Someone with database write access (but without QINQIN_SECRET) repoints the endpoint.
	if _, err := svc.Keys.DB.Exec(`UPDATE ai_custom_providers SET base_url = 'https://evil.example.com/v1' WHERE id = ?`, sp.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := svc.For(ctx, 1); !errors.Is(err, ErrKeyUndecryptable) {
		t.Errorf("For = %v, want ErrKeyUndecryptable", err)
	}
	st, _ := svc.Status(ctx, 1)
	if st.Reason != "key_undecryptable" {
		t.Errorf("reason = %q", st.Reason)
	}
}

func TestFakeReplacesAllKinds(t *testing.T) {
	ctx := context.Background()
	svc, keys := newTestService(t, func(s *Service) { s.Fake = true; s.Adapters = nil })
	for _, id := range []string{"openai", "gemini", "anthropic", "deepseek"} {
		if err := keys.Put(ctx, 1, id, "sk-fake-"+id+"-key-0001", "m", PutOptions{}); err != nil {
			t.Fatal(err)
		}
		if err := svc.Selection.SetActive(ctx, 1, id); err != nil {
			t.Fatal(err)
		}
		p, spec, _, err := svc.For(ctx, 1)
		if err != nil || p != Provider(Fake{}) || spec.ID != id {
			t.Errorf("%s: %v %v %v", id, p, spec.ID, err)
		}
	}
	if a, err := svc.Adapter(ProviderSpec{Kind: KindGemini}); err != nil || a != Provider(Fake{}) {
		t.Errorf("Adapter = %v, %v", a, err)
	}
}

func TestForDisabledProvider(t *testing.T) {
	ctx := context.Background()
	svc, keys := newTestService(t, nil)
	if err := keys.Put(ctx, 1, "openai", "sk-fake-openai-key-0001", "gpt-6-luna", PutOptions{}); err != nil {
		t.Fatal(err)
	}
	if err := svc.Selection.SetActive(ctx, 1, "openai"); err != nil {
		t.Fatal(err)
	}
	svc.Registry.Enabled = map[string]bool{"anthropic": true}
	if _, _, _, err := svc.For(ctx, 1); !errors.Is(err, ErrProviderDisabled) || Code(err) != "provider_disabled" {
		t.Errorf("For = %v (%q)", err, Code(err))
	}
	st, err := svc.Status(ctx, 1)
	if err != nil || st.Reason != "provider_disabled" || st.Available {
		t.Errorf("status = %+v, %v", st, err)
	}
	// The key stays stored and listed.
	if len(st.Keys) != 1 || st.Keys[0].Provider != "openai" {
		t.Errorf("keys = %+v", st.Keys)
	}
	if k, err := keys.Info(ctx, 1, "openai"); err != nil || k == nil {
		t.Errorf("key lost: %v", err)
	}
	if _, err := svc.Adapter(ProviderSpec{ID: "openai", Kind: KindOpenAI}); err != nil {
		t.Errorf("Adapter must not enforce Enabled (the handler does): %v", err)
	}
}

func TestAdapterMissingKind(t *testing.T) {
	svc, _ := newTestService(t, func(s *Service) { s.Adapters = map[Kind]Provider{KindAnthropic: Fake{}} })
	if _, err := svc.Adapter(ProviderSpec{Kind: KindGemini}); !errors.Is(err, ErrProviderDisabled) {
		t.Errorf("err = %v", err)
	}
	if !svc.HasProviders() || (&Service{}).HasProviders() || !(&Service{Fake: true}).HasProviders() {
		t.Error("HasProviders")
	}
}
