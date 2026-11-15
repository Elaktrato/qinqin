package auth

import (
	"strings"
	"unicode"
)

// maxDeviceRunes caps a device label.
const maxDeviceRunes = 64

// CleanDevice normalises a client-supplied device name: control
// characters dropped, whitespace trimmed, at most 64 runes.
func CleanDevice(s string) string {
	var b strings.Builder
	n := 0
	for _, r := range s {
		if unicode.IsControl(r) {
			continue
		}
		if n == maxDeviceRunes {
			break
		}
		b.WriteRune(r)
		n++
	}
	return strings.TrimSpace(b.String())
}

// DeviceLabel derives a coarse label ("Firefox on Linux") from a
// User-Agent. The raw string is never stored; anything unrecognised is
// "Unknown device".
func DeviceLabel(userAgent string) string {
	ua := userAgent
	if len(ua) > 512 {
		ua = ua[:512]
	}
	browser := ""
	switch {
	case strings.Contains(ua, "Edg/") || strings.Contains(ua, "EdgA/") || strings.Contains(ua, "EdgiOS/"):
		browser = "Edge"
	case strings.Contains(ua, "OPR/") || strings.Contains(ua, "Opera"):
		browser = "Opera"
	case strings.Contains(ua, "Firefox/") || strings.Contains(ua, "FxiOS/"):
		browser = "Firefox"
	case strings.Contains(ua, "Chrome/") || strings.Contains(ua, "CriOS/"):
		browser = "Chrome"
	case strings.Contains(ua, "Safari/"):
		browser = "Safari"
	}
	if browser == "" {
		return "Unknown device"
	}
	os := ""
	switch {
	case strings.Contains(ua, "Android"):
		os = "Android"
	case strings.Contains(ua, "iPhone") || strings.Contains(ua, "iPad") || strings.Contains(ua, "iPod"):
		os = "iOS"
	case strings.Contains(ua, "Windows"):
		os = "Windows"
	case strings.Contains(ua, "Mac OS X") || strings.Contains(ua, "Macintosh"):
		os = "macOS"
	case strings.Contains(ua, "CrOS"):
		os = "ChromeOS"
	case strings.Contains(ua, "Linux") || strings.Contains(ua, "X11"):
		os = "Linux"
	}
	if os == "" {
		return browser
	}
	return browser + " on " + os
}
