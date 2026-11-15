package ai

import (
	"bytes"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strings"
	"testing"
)

func secretBytes(seed byte, n int) []byte {
	b := make([]byte, n)
	for i := range b {
		b[i] = seed + byte(i)
	}
	return b
}

func TestParseSecret(t *testing.T) {
	raw := secretBytes(1, 32)
	tests := []struct {
		name  string
		in    string
		state SecretState
		want  []byte
	}{
		{"empty", "", SecretMissing, nil},
		{"spaces", "  ", SecretMissing, nil},
		{"std", base64.StdEncoding.EncodeToString(raw), SecretOK, raw},
		{"std unpadded", base64.RawStdEncoding.EncodeToString(raw), SecretOK, raw},
		{"url", base64.URLEncoding.EncodeToString(raw), SecretOK, raw},
		{"raw url", base64.RawURLEncoding.EncodeToString(raw), SecretOK, raw},
		{"newlines", "\n" + base64.StdEncoding.EncodeToString(raw) + "\n", SecretOK, raw},
		{"31 bytes", base64.StdEncoding.EncodeToString(secretBytes(1, 31)), SecretInvalid, nil},
		{"33 bytes", base64.StdEncoding.EncodeToString(secretBytes(1, 33)), SecretInvalid, nil},
		{"not base64", "not base64!", SecretInvalid, nil},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, state := ParseSecret(tc.in)
			if state != tc.state {
				t.Fatalf("state = %q, want %q", state, tc.state)
			}
			if !bytes.Equal(got, tc.want) {
				t.Errorf("bytes = %x, want %x", got, tc.want)
			}
			if tc.want == nil && got != nil {
				t.Errorf("want nil bytes, got %x", got)
			}
		})
	}
}

func TestSealerRoundTrip(t *testing.T) {
	s := NewSealer(secretBytes(1, 32))
	aad := KeyAAD(1, "anthropic")
	ct, nonce, err := s.Seal([]byte("sk-ant-secret"), aad)
	if err != nil {
		t.Fatal(err)
	}
	if len(nonce) != 12 {
		t.Errorf("nonce length %d, want 12", len(nonce))
	}
	if bytes.Contains(ct, []byte("sk-ant")) {
		t.Error("ciphertext contains the plaintext")
	}
	got, err := s.Open(ct, nonce, aad)
	if err != nil || string(got) != "sk-ant-secret" {
		t.Fatalf("Open = %q, %v", got, err)
	}
	ct2, nonce2, _ := s.Seal([]byte("sk-ant-secret"), aad)
	if bytes.Equal(ct, ct2) || bytes.Equal(nonce, nonce2) {
		t.Error("two seals of the same plaintext are identical")
	}
}

func TestSealerRejectsOtherAAD(t *testing.T) {
	s := NewSealer(secretBytes(1, 32))
	ct, nonce, _ := s.Seal([]byte("k"), KeyAAD(1, "anthropic"))
	if _, err := s.Open(ct, nonce, KeyAAD(2, "anthropic")); !errors.Is(err, ErrOpen) {
		t.Errorf("other user: err = %v, want ErrOpen", err)
	}
	if _, err := s.Open(ct, nonce, KeyAAD(1, "other")); !errors.Is(err, ErrOpen) {
		t.Errorf("other provider: err = %v, want ErrOpen", err)
	}
	other := NewSealer(secretBytes(9, 32))
	if _, err := other.Open(ct, nonce, KeyAAD(1, "anthropic")); !errors.Is(err, ErrOpen) {
		t.Errorf("other secret: err = %v, want ErrOpen", err)
	}
	if _, err := s.Open(ct[:3], nonce[:2], KeyAAD(1, "anthropic")); !errors.Is(err, ErrOpen) {
		t.Errorf("garbage: err = %v, want ErrOpen", err)
	}
}

func TestKeyAAD(t *testing.T) {
	if got := KeyAAD(7, "anthropic"); got != "qinqin/ai_keys/v1|user=7|provider=anthropic" {
		t.Errorf("KeyAAD = %q", got)
	}
}

func TestFingerprintDoesNotRevealSecret(t *testing.T) {
	a, b := secretBytes(1, 32), secretBytes(9, 32)
	fa, fb := NewSealer(a).Fingerprint(), NewSealer(b).Fingerprint()
	if len(fa) != 16 {
		t.Fatalf("fingerprint %q is not 16 characters", fa)
	}
	if _, err := hex.DecodeString(fa); err != nil {
		t.Errorf("fingerprint %q is not hex", fa)
	}
	if fa == fb {
		t.Error("two secrets share a fingerprint")
	}
	if fa != NewSealer(a).Fingerprint() {
		t.Error("fingerprint is not stable")
	}
	for _, form := range []string{hex.EncodeToString(a), base64.StdEncoding.EncodeToString(a)} {
		if strings.Contains(form, fa) {
			t.Errorf("fingerprint %q is a substring of the secret form %q", fa, form)
		}
	}
}
