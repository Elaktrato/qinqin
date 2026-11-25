// Package webpush sends Web Push messages (RFC 8030) with encrypted payloads
// (RFC 8291, aes128gcm) and VAPID authentication (RFC 8292), using only the
// standard library: no third-party push code and no proprietary push SDK.
package webpush

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
)

// MaxPayload is the largest plaintext: a push service accepts 4096 bytes
// of body, of which the header, the padding delimiter and the tag use 103.
const MaxPayload = 3993

const recordSize = 4096

var errCrypto = errors.New("webpush: cannot encrypt")

func randReader() io.Reader { return rand.Reader }

// Encrypt encrypts plain for the subscription keys (p256dh: the 65-byte
// uncompressed public key, auth: the 16-byte secret) as one aes128gcm record.
func Encrypt(plain, p256dh, auth []byte) ([]byte, error) {
	priv, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		return nil, errCrypto
	}
	salt := make([]byte, 16)
	if _, err := io.ReadFull(rand.Reader, salt); err != nil {
		return nil, errCrypto
	}
	return encrypt(plain, p256dh, auth, priv, salt)
}

func encrypt(plain, p256dh, auth []byte, asPriv *ecdh.PrivateKey, salt []byte) ([]byte, error) {
	if len(plain) > MaxPayload {
		return nil, fmt.Errorf("%w: payload too large", errCrypto)
	}
	if len(auth) != 16 {
		return nil, fmt.Errorf("%w: bad auth secret", errCrypto)
	}
	uaPub, err := ecdh.P256().NewPublicKey(p256dh)
	if err != nil {
		return nil, fmt.Errorf("%w: bad public key", errCrypto)
	}
	shared, err := asPriv.ECDH(uaPub)
	if err != nil {
		return nil, errCrypto
	}
	asPub := asPriv.PublicKey().Bytes()
	prkKey, err := hkdf.Extract(sha256.New, shared, auth)
	if err != nil {
		return nil, errCrypto
	}
	keyInfo := append(append([]byte("WebPush: info\x00"), p256dh...), asPub...)
	ikm, err := hkdf.Expand(sha256.New, prkKey, string(keyInfo), 32)
	if err != nil {
		return nil, errCrypto
	}
	prk, err := hkdf.Extract(sha256.New, ikm, salt)
	if err != nil {
		return nil, errCrypto
	}
	cek, err := hkdf.Expand(sha256.New, prk, "Content-Encoding: aes128gcm\x00", 16)
	if err != nil {
		return nil, errCrypto
	}
	nonce, err := hkdf.Expand(sha256.New, prk, "Content-Encoding: nonce\x00", 12)
	if err != nil {
		return nil, errCrypto
	}
	block, err := aes.NewCipher(cek)
	if err != nil {
		return nil, errCrypto
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, errCrypto
	}
	header := make([]byte, 0, 86)
	header = append(header, salt...)
	header = binary.BigEndian.AppendUint32(header, recordSize)
	header = append(header, byte(len(asPub)))
	header = append(header, asPub...)
	return gcm.Seal(header, nonce, append(append([]byte(nil), plain...), 0x02), nil), nil
}

// decrypt reverses encrypt for a user agent's private key (tests).
func decrypt(body []byte, uaPriv *ecdh.PrivateKey, auth []byte) ([]byte, error) {
	if len(body) < 86+17 {
		return nil, errCrypto
	}
	salt, asPub := body[:16], body[21:86]
	pub, err := ecdh.P256().NewPublicKey(asPub)
	if err != nil {
		return nil, err
	}
	shared, err := uaPriv.ECDH(pub)
	if err != nil {
		return nil, err
	}
	prkKey, _ := hkdf.Extract(sha256.New, shared, auth)
	keyInfo := append(append([]byte("WebPush: info\x00"), uaPriv.PublicKey().Bytes()...), asPub...)
	ikm, _ := hkdf.Expand(sha256.New, prkKey, string(keyInfo), 32)
	prk, _ := hkdf.Extract(sha256.New, ikm, salt)
	cek, _ := hkdf.Expand(sha256.New, prk, "Content-Encoding: aes128gcm\x00", 16)
	nonce, _ := hkdf.Expand(sha256.New, prk, "Content-Encoding: nonce\x00", 12)
	block, _ := aes.NewCipher(cek)
	gcm, _ := cipher.NewGCM(block)
	out, err := gcm.Open(nil, nonce, body[86:], nil)
	if err != nil || len(out) == 0 || out[len(out)-1] != 0x02 {
		return nil, errCrypto
	}
	return out[:len(out)-1], nil
}
