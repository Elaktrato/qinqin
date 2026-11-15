// Package ai holds the AI services of the server: the encrypted key store,
// the provider interface with its implementations, and the rate limiter.
package ai

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
)

// SecretState tells whether QINQIN_SECRET is usable.
type SecretState string

const (
	SecretOK      SecretState = "ok"
	SecretMissing SecretState = "missing"
	SecretInvalid SecretState = "invalid"
)

// ParseSecret decodes the raw QINQIN_SECRET value: standard or URL-safe
// base64, padded or not, exactly 32 bytes. Surrounding space is ignored.
func ParseSecret(raw string) ([]byte, SecretState) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, SecretMissing
	}
	for _, enc := range []*base64.Encoding{
		base64.StdEncoding, base64.RawStdEncoding,
		base64.URLEncoding, base64.RawURLEncoding,
	} {
		if b, err := enc.DecodeString(raw); err == nil {
			if len(b) == 32 {
				return b, SecretOK
			}
			return nil, SecretInvalid
		}
	}
	return nil, SecretInvalid
}

// ErrOpen is returned for every decryption failure, without detail.
var ErrOpen = errors.New("ai: cannot decrypt key")

// Sealer encrypts and decrypts API keys with keys derived from the secret.
type Sealer struct {
	aead cipher.AEAD
	fp   string
}

func derive(secret []byte, label string) []byte {
	m := hmac.New(sha256.New, secret)
	m.Write([]byte(label))
	return m.Sum(nil)
}

// NewSealer derives the encryption key and the fingerprint from the secret
// (32 bytes) under different labels.
func NewSealer(secret []byte) *Sealer {
	block, err := aes.NewCipher(derive(secret, "qinqin ai key encryption v1"))
	if err != nil {
		panic(fmt.Sprintf("ai: aes: %v", err)) // a SHA-256 sum is always a valid key size
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		panic(fmt.Sprintf("ai: gcm: %v", err))
	}
	return &Sealer{aead: aead, fp: hex.EncodeToString(derive(secret, "qinqin ai key fingerprint v1"))[:16]}
}

// Fingerprint identifies the secret without revealing it.
func (s *Sealer) Fingerprint() string { return s.fp }

// Seal encrypts plain with AES-256-GCM and a random 12-byte nonce, binding aad.
func (s *Sealer) Seal(plain []byte, aad string) (ciphertext, nonce []byte, err error) {
	nonce = make([]byte, s.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, nil, fmt.Errorf("ai: nonce: %w", err)
	}
	return s.aead.Seal(nil, nonce, plain, []byte(aad)), nonce, nil
}

// Open decrypts a Seal result; every failure is ErrOpen.
func (s *Sealer) Open(ciphertext, nonce []byte, aad string) ([]byte, error) {
	if len(nonce) != s.aead.NonceSize() {
		return nil, ErrOpen
	}
	plain, err := s.aead.Open(nil, nonce, ciphertext, []byte(aad))
	if err != nil {
		return nil, ErrOpen
	}
	return plain, nil
}

// KeyAAD binds a ciphertext to its user and provider.
func KeyAAD(userID int64, provider string) string {
	return fmt.Sprintf("qinqin/ai_keys/v1|user=%d|provider=%s", userID, provider)
}
