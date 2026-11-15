package ai

import (
	"context"
	"errors"
)

// Service ties the provider, the key store and the limiter together.
type Service struct {
	Provider     Provider
	ProviderName string // "anthropic" | "fake"
	Secret       SecretState
	Keys         *KeyStore
	Limiter      *Limiter
}

// StatusUsage is the user's recent use.
type StatusUsage struct {
	CallsLastHour int   `json:"callsLastHour"`
	LimitPerHour  int   `json:"limitPerHour"`
	InputTokens   int64 `json:"inputTokens"`
	OutputTokens  int64 `json:"outputTokens"`
}

// Status is what GET /api/ai/status returns.
type Status struct {
	Secret    SecretState `json:"secret"`
	Provider  string      `json:"provider"`
	Key       *StoredKey  `json:"key"`
	Models    []ModelInfo `json:"models"`
	Usage     StatusUsage `json:"usage"`
	Available bool        `json:"available"`
	Reason    string      `json:"reason"` // "", "no_secret", "invalid_secret", "no_key", "key_undecryptable", "no_provider"
}

// Status reports whether the user can use the AI and why not. A nil Service
// is valid and reads as "no_secret".
func (s *Service) Status(ctx context.Context, userID int64) (Status, error) {
	st := Status{Models: Models, Secret: SecretMissing, Reason: "no_secret"}
	if s == nil {
		return st, nil
	}
	st.Secret = s.Secret
	st.Provider = s.ProviderName
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
	if s.Provider == nil {
		st.Reason = "no_provider"
		return st, nil
	}
	info, err := s.Keys.Info(ctx, userID)
	switch {
	case errors.Is(err, ErrNoKey):
		st.Reason = "no_key"
	case err != nil:
		return st, err
	default:
		st.Key = info
		if info.State != KeyOK {
			st.Reason = "key_undecryptable"
		} else {
			st.Reason = ""
		}
	}
	st.Available = st.Reason == ""
	return st, nil
}
