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
	return true
}
