package auth

import (
	"crypto/hmac"
	"crypto/sha1" //nolint:gosec // RFC 6238 default; every authenticator app uses HMAC-SHA1
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"strings"
	"time"
)

// TOTP parameters (RFC 6238 as every authenticator app implements them).
const (
	totpPeriod = 30 // seconds
	totpDigits = 6
)

var base32NoPad = base32.StdEncoding.WithPadding(base32.NoPadding)

// hotp is RFC 4226 with SHA-1; digits is a parameter so the RFC 6238
// appendix B vectors (8 digits) can be tested.
func hotp(secret []byte, counter uint64, digits int) string {
	var msg [8]byte
	binary.BigEndian.PutUint64(msg[:], counter)
	mac := hmac.New(sha1.New, secret)
	mac.Write(msg[:])
	sum := mac.Sum(nil)
	off := sum[len(sum)-1] & 0x0f
	bin := binary.BigEndian.Uint32(sum[off:off+4]) & 0x7fffffff
	mod := uint32(1)
	for i := 0; i < digits; i++ {
		mod *= 10
	}
	return fmt.Sprintf("%0*d", digits, bin%mod)
}

func totpStep(t time.Time) uint64 { return uint64(t.Unix() / totpPeriod) }

// TOTPCode is the current code of a base32 secret (tests and the sink
// script's Python twin compute the same value).
func TOTPCode(secretBase32 string, at time.Time) (string, error) {
	secret, err := base32NoPad.DecodeString(strings.ToUpper(strings.TrimSpace(secretBase32)))
	if err != nil {
		return "", err
	}
	return hotp(secret, totpStep(at), totpDigits), nil
}
