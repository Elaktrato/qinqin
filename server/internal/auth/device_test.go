package auth_test

import (
	"strings"
	"testing"

	"qinqin/internal/auth"
)

func TestDeviceLabel(t *testing.T) {
	cases := []struct{ ua, want string }{
		{"Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0", "Firefox on Linux"},
		{"Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36", "Chrome on Android"},
		{"Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1", "Safari on iOS"},
		{"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0", "Edge on Windows"},
		{"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15", "Safari on macOS"},
		{"curl/8.5.0", "Unknown device"},
		{"", "Unknown device"},
	}
	for _, c := range cases {
		if got := auth.DeviceLabel(c.ua); got != c.want {
			t.Errorf("DeviceLabel(%q) = %q, want %q", c.ua, got, c.want)
		}
	}
	long := auth.DeviceLabel(strings.Repeat("Firefox Linux \x00\n", 200))
	if n := len([]rune(long)); n > 64 {
		t.Errorf("label has %d runes, want <= 64", n)
	}
	if got := auth.DeviceLabel(strings.Repeat("é", 2048)); len([]rune(got)) > 64 {
		t.Errorf("garbage label too long: %d", len([]rune(got)))
	}
}
