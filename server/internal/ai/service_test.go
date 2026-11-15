package ai

import (
	"context"
	"testing"
	"time"
)

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

	sqlDB, _ := openTestDB(t)
	keys := newStore(sqlDB, 1, 0)
	lim := &Limiter{DB: sqlDB, PerHour: 30, Now: time.Now}
	svc := &Service{Provider: Fake{}, ProviderName: "fake", Secret: SecretOK, Keys: keys, Limiter: lim}

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
	check("no provider", &Service{Secret: SecretOK, Keys: keys, Limiter: lim}, "no_provider", false)
	check("no key", svc, "no_key", false)

	if err := newStore(sqlDB, 9, 0).Put(ctx, 1, "anthropic", testKey, "", PutOptions{}); err != nil {
		t.Fatal(err)
	}
	st = check("other secret", svc, "key_undecryptable", false)
	if st.Key == nil || st.Key.State != KeyUndecryptable {
		t.Errorf("key = %+v", st.Key)
	}

	if err := keys.Put(ctx, 1, "anthropic", testKey, "", PutOptions{}); err != nil {
		t.Fatal(err)
	}
	_ = lim.Record(ctx, Call{UserID: 1, Kind: "review", Model: DefaultModel, OK: true, Usage: Usage{InputTokens: 12, OutputTokens: 34}})
	st = check("good", svc, "", true)
	if st.Provider != "fake" || st.Secret != SecretOK || st.Key == nil || st.Key.Hint != "…1234" {
		t.Errorf("status = %+v", st)
	}
	if st.Usage.CallsLastHour != 1 || st.Usage.LimitPerHour != 30 || st.Usage.InputTokens != 12 || st.Usage.OutputTokens != 34 {
		t.Errorf("usage = %+v", st.Usage)
	}
}
