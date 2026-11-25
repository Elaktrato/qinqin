package webpush

import (
	"bytes"
	"crypto/ecdh"
	"encoding/base64"
	"testing"
)

func b64(t *testing.T, s string) []byte {
	t.Helper()
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// RFC 8291, Appendix A: the worked example.
func TestEncryptRFC8291Example(t *testing.T) {
	asPriv, err := ecdh.P256().NewPrivateKey(b64(t, "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"))
	if err != nil {
		t.Fatal(err)
	}
	uaPub := b64(t, "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4")
	auth := b64(t, "BTBZMqHH6r4Tts7J_aSIgg")
	salt := b64(t, "DGv6ra1nlYgDCS1FRnbzlw")
	want := b64(t, "DGv6ra1nlYgDCS1FRnbzlwAAEAAEBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN")
	want[20] = 65 // the key id length (RFC 8291 section 4: idlen = 65); every other byte is the RFC's
	got, err := encrypt([]byte("When I grow up, I want to be a watermelon"), uaPub, auth, asPriv, salt)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("body mismatch:\n got %x\nwant %x", got, want)
	}
}

func TestEncryptRoundTrip(t *testing.T) {
	ua, _ := ecdh.P256().GenerateKey(randReader())
	auth := bytes.Repeat([]byte{7}, 16)
	body, err := Encrypt([]byte(`{"v":1}`), ua.PublicKey().Bytes(), auth)
	if err != nil {
		t.Fatal(err)
	}
	plain, err := decrypt(body, ua, auth)
	if err != nil || string(plain) != `{"v":1}` {
		t.Fatalf("round trip: %q %v", plain, err)
	}
	if _, err := Encrypt(bytes.Repeat([]byte{'x'}, MaxPayload+1), ua.PublicKey().Bytes(), auth); err == nil {
		t.Fatal("an oversized payload must be refused")
	}
	if _, err := Encrypt([]byte("x"), []byte{1, 2, 3}, auth); err == nil {
		t.Fatal("a bad key must be refused")
	}
	if _, err := Encrypt([]byte("x"), ua.PublicKey().Bytes(), []byte{1}); err == nil {
		t.Fatal("a bad auth secret must be refused")
	}
}
