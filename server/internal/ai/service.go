package ai

import (
	"context"
	"errors"
)

// Service ties the adapters, the registry, the key store, the selection and
// the limiter together.
type Service struct {
	// Adapters maps a provider family to its adapter.
	Adapters map[Kind]Provider
	// Fake replaces every adapter with ai.Fake (QINQIN_AI_PROVIDER=fake).
	Fake      bool
	Registry  *Registry
	Secret    SecretState
	Keys      *KeyStore
	Selection *Selection
	Limiter   *Limiter
}

// StatusUsage is the user's recent use.
type StatusUsage struct {
	CallsLastHour int   `json:"callsLastHour"`
	LimitPerHour  int   `json:"limitPerHour"`
	InputTokens   int64 `json:"inputTokens"`
	OutputTokens  int64 `json:"outputTokens"`
}

// ActiveInfo describes the provider the user's calls go to.
type ActiveInfo struct {
	Provider   string     `json:"provider"`
	Name       string     `json:"name"`
	Model      string     `json:"model"`
	Vision     bool       `json:"vision"`
	Structured Structured `json:"structured"`
}

// Status is what GET /api/ai/status returns.
type Status struct {
	Secret    SecretState `json:"secret"`
	Provider  string      `json:"provider"` // "fake" under the fake switch, else the active id
	Fake      bool        `json:"fake"`
	Key       *StoredKey  `json:"key"` // the active provider's key
	Keys      []StoredKey `json:"keys"`
	Active    *ActiveInfo `json:"active"`
	Models    []ModelInfo `json:"models"`
	Usage     StatusUsage `json:"usage"`
	Available bool        `json:"available"`
	// Reason: "", "no_secret", "invalid_secret", "no_provider", "no_selection",
	// "no_key", "key_undecryptable", "provider_disabled".
	Reason string `json:"reason"`
	// Disabled lists the stored keys' providers the server turned off.
	Disabled []string `json:"disabledProviders,omitempty"`
}

func (s *Service) registry() *Registry {
	if s.Registry == nil {
		s.Registry = &Registry{}
	}
	return s.Registry
}

func (s *Service) hasAnyKey(ctx context.Context, userID int64) bool {
	keys, err := s.Keys.List(ctx, userID)
	return err != nil || len(keys) > 0
}

// Lookup resolves a provider id through the registry.
func (s *Service) Lookup(ctx context.Context, id string) (ProviderSpec, error) {
	return s.registry().Lookup(ctx, id)
}

// AllProviders lists the providers the operator allows (nil service: none).
func (s *Service) AllProviders(ctx context.Context) ([]ProviderSpec, error) {
	return s.registry().All(ctx)
}

// CustomEnabled reports whether admins may register custom endpoints.
func (s *Service) CustomEnabled() bool { return s.registry().IsEnabled(customIDPrefix) }

// PrivateAllowed reports QINQIN_AI_ALLOW_PRIVATE for custom endpoints.
func (s *Service) PrivateAllowed() bool {
	r := s.registry()
	return r.Custom != nil && r.Custom.Policy.AllowPrivate
}

// HasProviders reports whether any adapter is configured.
func (s *Service) HasProviders() bool { return s != nil && (s.Fake || len(s.Adapters) > 0) }

// Adapter returns the adapter for a provider family (Fake under the switch).
// It does not check the operator's Enabled list; callers look the spec up
// through the Registry first.
func (s *Service) Adapter(spec ProviderSpec) (Provider, error) {
	if s.Fake {
		return Fake{}, nil
	}
	if p, ok := s.Adapters[spec.Kind]; ok && p != nil {
		return p, nil
	}
	return nil, ErrProviderDisabled
}

// For resolves the user's active provider: adapter, spec and decrypted
// credentials (BaseURL and Provider filled in). ErrNoSelection when the user
// chose none; a selection that points at a deleted custom endpoint is
// cleared and reads as ErrNoKey; ErrProviderDisabled when the operator turned
// the provider off.
func (s *Service) For(ctx context.Context, userID int64) (Provider, ProviderSpec, Credentials, error) {
	if s == nil || s.Selection == nil || s.Keys == nil {
		return nil, ProviderSpec{}, Credentials{}, ErrNoKey
	}
	id, err := s.Selection.Active(ctx, userID)
	if errors.Is(err, ErrNoSelection) && !s.hasAnyKey(ctx, userID) {
		return nil, ProviderSpec{}, Credentials{}, ErrNoKey // nothing to choose from yet
	}
	if err != nil {
		return nil, ProviderSpec{}, Credentials{}, err
	}
	spec, err := s.registry().Lookup(ctx, id)
	if errors.Is(err, ErrUnknownProvider) {
		_ = s.Selection.Clear(ctx, userID)
		return nil, ProviderSpec{}, Credentials{}, ErrNoKey
	}
	if err != nil {
		return nil, ProviderSpec{}, Credentials{}, err
	}
	adapter, err := s.Adapter(spec)
	if err != nil {
		return nil, ProviderSpec{}, Credentials{}, err
	}
	creds, err := s.Keys.Credentials(ctx, userID, id)
	if err != nil {
		return nil, ProviderSpec{}, Credentials{}, err
	}
	creds.BaseURL, creds.Provider = spec.BaseURL, spec.ID
	return adapter, spec, creds, nil
}

// ActiveSpec returns the user's active provider and the model of its stored
// key without decrypting anything or touching the limiter. Errors are the
// ones For returns before the decryption step.
func (s *Service) ActiveSpec(ctx context.Context, userID int64) (ProviderSpec, string, error) {
	if s == nil || s.Selection == nil || s.Keys == nil {
		return ProviderSpec{}, "", ErrNoKey
	}
	id, err := s.Selection.Active(ctx, userID)
	if err != nil {
		return ProviderSpec{}, "", err
	}
	spec, err := s.registry().Lookup(ctx, id)
	if err != nil {
		return ProviderSpec{}, "", err
	}
	info, err := s.Keys.Info(ctx, userID, id)
	if err != nil {
		return ProviderSpec{}, "", err
	}
	return spec, info.Model, nil
}

// Status reports whether the user can use the AI and why not. A nil Service
// is valid and reads as "no_secret".
func (s *Service) Status(ctx context.Context, userID int64) (Status, error) {
	st := Status{Models: Models, Keys: []StoredKey{}, Secret: SecretMissing, Reason: "no_secret"}
	if s == nil {
		return st, nil
	}
	st.Secret = s.Secret
	st.Fake = s.Fake
	if s.Limiter != nil {
		st.Usage.LimitPerHour = s.Limiter.PerHour
		n, u, err := s.Limiter.CallsLastHour(ctx, userID)
		if err != nil {
			return st, err
		}
		st.Usage.CallsLastHour, st.Usage.InputTokens, st.Usage.OutputTokens = n, u.InputTokens, u.OutputTokens
	}
	switch {
	case s.Secret == SecretInvalid:
		st.Reason = "invalid_secret"
		return st, nil
	case s.Secret != SecretOK || s.Keys == nil:
		st.Reason = "no_secret"
		return st, nil
	}
	if keys, err := s.Keys.List(ctx, userID); err != nil {
		return st, err
	} else if keys != nil {
		st.Keys = keys
	}
	for _, k := range st.Keys {
		if !s.registry().IsEnabled(k.Provider) {
			st.Disabled = append(st.Disabled, k.Provider)
		}
	}
	if !s.HasProviders() || s.Selection == nil {
		st.Reason = "no_provider"
		return st, nil
	}
	id, err := s.Selection.Active(ctx, userID)
	if errors.Is(err, ErrNoSelection) {
		st.Reason = "no_selection"
		if len(st.Keys) == 0 {
			st.Reason = "no_key"
		}
		return st, nil
	}
	if err != nil {
		return st, err
	}
	st.Provider = id
	if s.Fake {
		st.Provider = "fake"
	}
	spec, err := s.registry().Lookup(ctx, id)
	switch {
	case errors.Is(err, ErrUnknownProvider):
		_ = s.Selection.Clear(ctx, userID)
		st.Reason, st.Provider = "no_selection", ""
		return st, nil
	case errors.Is(err, ErrProviderDisabled):
		st.Reason = "provider_disabled"
		return st, nil
	case err != nil:
		return st, err
	}
	info, err := s.Keys.Info(ctx, userID, id)
	switch {
	case errors.Is(err, ErrNoKey):
		st.Reason = "no_key"
	case err != nil:
		return st, err
	default:
		st.Key = info
		st.Active = &ActiveInfo{Provider: id, Name: spec.Name, Model: info.Model, Vision: spec.VisionFor(info.Model), Structured: spec.Structured}
		st.Models = st.Models[:0:0]
		for _, m := range spec.Models {
			st.Models = append(st.Models, ModelInfo{ID: m.ID, Label: m.Label})
		}
		if info.State != KeyOK {
			st.Reason = "key_undecryptable"
		} else {
			st.Reason = ""
		}
	}
	st.Available = st.Reason == ""
	return st, nil
}
