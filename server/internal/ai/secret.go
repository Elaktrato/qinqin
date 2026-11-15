// Package ai holds the AI services of the server: the encrypted key store,
// the provider interface with its implementations, and the rate limiter.
package ai

import (
	"fmt"

	"qinqin/internal/secretbox"
)

// The sealer lives in internal/secretbox (shared with SMTP and TOTP); these
// aliases keep the ai package's own vocabulary.
type (
	SecretState = secretbox.SecretState
	Sealer      = secretbox.Sealer
)

const (
	SecretOK      = secretbox.SecretOK
	SecretMissing = secretbox.SecretMissing
	SecretInvalid = secretbox.SecretInvalid
)

var (
	ErrOpen     = secretbox.ErrOpen
	ParseSecret = secretbox.ParseSecret
	NewSealer   = secretbox.NewSealer
)

// KeyAAD binds a ciphertext to its user and provider.
func KeyAAD(userID int64, provider string) string {
	return fmt.Sprintf("qinqin/ai_keys/v1|user=%d|provider=%s", userID, provider)
}

// KeyAADCustom binds a custom provider's key to its user, id and normalised
// base URL, so repointing base_url in the database cannot deliver the key to
// another host.
func KeyAADCustom(userID int64, provider, baseURL string) string {
	return fmt.Sprintf("qinqin/ai_keys/v2|user=%d|provider=%s|base=%s", userID, provider, baseURL)
}
