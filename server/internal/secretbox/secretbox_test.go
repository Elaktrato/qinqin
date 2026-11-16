package secretbox

import (
	"bytes"
	"encoding/hex"
	"errors"
	"testing"
)

func seq(start byte, n int) []byte {
	b := make([]byte, n)
	for i := range b {
		b[i] = start + byte(i)
	}
	return b
}

// The ciphertext below was produced by the sealer as it was in package ai
// before the move (fixed nonce). If this test fails, existing rows would no
// longer open.
func TestGoldenCiphertextFromBeforeTheMove(t *testing.T) {
	s := NewSealer(seq(1, 32))
	if s.Fingerprint() != "ab18c7acb30ec402" {
		t.Fatalf("fingerprint changed: %s", s.Fingerprint())
	}
	ct, _ := hex.DecodeString("1634d86d63324ca6841e635d19a94ebc10db327547e272c4be9b301fceb41d4e")
	plain, err := s.Open(ct, seq(0xa0, 12), "qinqin/test/v1|golden")
	if err != nil || !bytes.Equal(plain, []byte("golden plaintext")) {
		t.Fatalf("open = %q, %v", plain, err)
	}
}

func TestRoundTripAndAAD(t *testing.T) {
	s := NewSealer(seq(1, 32))
	ct, n, err := s.Seal([]byte("x"), "a")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Open(ct, n, "b"); !errors.Is(err, ErrOpen) {
		t.Fatalf("other aad: %v", err)
	}
	if _, err := NewSealer(seq(9, 32)).Open(ct, n, "a"); !errors.Is(err, ErrOpen) {
		t.Fatalf("other secret: %v", err)
	}
	if got, err := s.Open(ct, n, "a"); err != nil || string(got) != "x" {
		t.Fatalf("open = %q %v", got, err)
	}
}
