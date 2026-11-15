package studyday

import (
	"errors"
	"strings"
)

// ErrUnknownZone is returned for names that are not usable IANA zones.
var ErrUnknownZone = errors.New("unknown time zone")

// ValidZone reports whether name is a zone the server accepts: 1-64
// bytes of [A-Za-z0-9_+-/], not Local/Factory/posixrules, no posix/ or
// right/ prefix, and known to the zone database.
func ValidZone(name string) bool {
	_, err := loadZone(name)
	return err == nil
}

func nameOK(name string) bool {
	if name == "" || len(name) > 64 {
		return false
	}
	for i := 0; i < len(name); i++ {
		c := name[i]
		ok := c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '_' || c == '+' || c == '-' || c == '/'
		if !ok {
			return false
		}
	}
	switch name {
	case "Local", "Factory", "posixrules":
		return false
	}
	if strings.HasPrefix(name, "posix/") || strings.HasPrefix(name, "right/") {
		return false
	}
	return canonicalCase(name)
}

// allCaps are the zone names (or path segments) the database writes
// entirely in capitals.
var allCaps = map[string]bool{
	"UTC": true, "GMT": true, "UCT": true, "EST": true, "MST": true, "HST": true, "EST5EDT": true,
	"CST6CDT": true, "MST7MDT": true, "PST8PDT": true, "CET": true, "MET": true, "EET": true, "WET": true,
	"PRC": true, "ROC": true, "ROK": true, "NZ": true, "NZ-CHAT": true, "GB": true, "W-SU": true,
	"GMT0": true, "GMT+0": true, "GMT-0": true,
	"US": true, "ACT": true, "LHI": true, "NSW": true, "NT": true, "QLD": true, "SA": true, "TAS": true, "VIC": true, "WA": true,
}

// canonicalCase rejects names whose letter case differs from the
// database's, so a case-insensitive host file system cannot make the
// server store "asia/tokyo" or "ASIA/TOKYO": every path segment starts
// with a capital and is mixed case, or is a known all-capitals name
// (UTC, EST5EDT, Etc/GMT-9).
func canonicalCase(name string) bool {
	for _, seg := range strings.Split(name, "/") {
		if seg == "" || seg[0] < 'A' || seg[0] > 'Z' {
			return false
		}
		hasLower := false
		for i := 0; i < len(seg); i++ {
			if seg[i] >= 'a' && seg[i] <= 'z' {
				hasLower = true
			}
		}
		if hasLower || allCaps[seg] {
			continue
		}
		if strings.HasPrefix(seg, "GMT") && len(seg) > 4 && (seg[3] == '+' || seg[3] == '-') {
			continue
		}
		return false
	}
	return true
}
