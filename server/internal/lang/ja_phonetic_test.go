package lang_test

import (
	"testing"

	"qinqin/internal/lang"
)

func TestPhoneticKey(t *testing.T) {
	for in, want := range map[string]string{
		// every spelling of Tōkyō reaches one key
		"tokyo":   "tokyo",
		"toukyou": "tokyo",
		"Tōkyō":   "tokyo",
		"TÔKYÔ":   "tokyo",
		"ＴＯＫＹＯ":   "tokyo",
		"ToKyO":   "tokyo",
		"to-kyo":  "tokyo",
		"to kyo":  "tokyo",
		"とうきょう":   "tokyo",
		"トウキョウ":   "tokyo",
		"ﾄｳｷｮｳ":   "tokyo",
		// readings as the Aozora catalog writes them
		"とうきょうはっけい":    "tokyohakkei",
		"なつめそうせき":      "natsumesoseki",
		"コーヒー":         "kohi",
		"ウェストミンスターじいん": "uesutominsutajin",
		// nothing phonetic: kanji only
		"東京": "",
		"":   "",
	} {
		if got := lang.PhoneticKey(in); got != want {
			t.Errorf("PhoneticKey(%q) = %q, want %q", in, got, want)
		}
	}
}
