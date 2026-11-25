package reminders

import (
	"crypto/hmac"
	"encoding/base64"
	"strconv"
	"strings"

	"qinqin/internal/secretbox"
)

const (
	tokenLabel   = "qinqin reminder token v1"
	tokenMessage = "qinqin reminder unsubscribe v1\n"
)

func tokenMAC(s *secretbox.Sealer, userID int64) []byte {
	return s.MAC(tokenLabel, []byte(tokenMessage+strconv.FormatInt(userID, 10)))
}

// UnsubscribeToken is the signed token of a user's unsubscribe link
// (docs/contracts/reminders/, "Email unsubscribe"). It has no expiry and can
// only switch the email channel off.
func UnsubscribeToken(s *secretbox.Sealer, userID int64) string {
	return "v1." + strconv.FormatInt(userID, 10) + "." + base64.RawURLEncoding.EncodeToString(tokenMAC(s, userID))
}

// VerifyUnsubscribeToken returns the user a token names when it was signed by
// the current or the previous secret.
func VerifyUnsubscribeToken(token string, current, previous *secretbox.Sealer) (int64, bool) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 || parts[0] != "v1" {
		return 0, false
	}
	id, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil || id <= 0 || strconv.FormatInt(id, 10) != parts[1] {
		return 0, false
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return 0, false
	}
	for _, s := range []*secretbox.Sealer{current, previous} {
		if s != nil && hmac.Equal(sig, tokenMAC(s, id)) {
			return id, true
		}
	}
	return 0, false
}
