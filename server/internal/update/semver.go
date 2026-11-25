// Package update checks GitHub Releases for a newer qinqin (#154) and
// compares versions. It does no HTTP routing: the api package asks it.
package update

import (
	"errors"
	"strconv"
	"strings"
)

// Version is a semantic version 2.0 without its build metadata.
type Version struct {
	Major, Minor, Patch uint64
	pre                 []string
	valid               bool
}

// ErrVersion is returned for a text that is not a semantic version.
var ErrVersion = errors.New("not a semantic version")

// ParseVersion reads "1.2.3", "v1.2.3", "1.2.3-rc.1" or "1.2.3+build". The
// build metadata is dropped: it takes no part in precedence.
func ParseVersion(s string) (Version, error) {
	s = strings.TrimPrefix(s, "v")
	if i := strings.IndexByte(s, '+'); i >= 0 {
		if !validIdentifiers(s[i+1:], false) {
			return Version{}, ErrVersion
		}
		s = s[:i]
	}
	core, pre, hasPre := strings.Cut(s, "-")
	parts := strings.Split(core, ".")
	if len(parts) != 3 {
		return Version{}, ErrVersion
	}
	var n [3]uint64
	for i, p := range parts {
		v, ok := parseNumber(p)
		if !ok {
			return Version{}, ErrVersion
		}
		n[i] = v
	}
	v := Version{Major: n[0], Minor: n[1], Patch: n[2], valid: true}
	if hasPre {
		if !validIdentifiers(pre, true) {
			return Version{}, ErrVersion
		}
		v.pre = strings.Split(pre, ".")
	}
	return v, nil
}

// parseNumber reads a numeric identifier without leading zeros.
func parseNumber(s string) (uint64, bool) {
	if s == "" || (len(s) > 1 && s[0] == '0') {
		return 0, false
	}
	for _, c := range s {
		if c < '0' || c > '9' {
			return 0, false
		}
	}
	v, err := strconv.ParseUint(s, 10, 64)
	return v, err == nil
}

// validIdentifiers checks a dot-separated list of [0-9A-Za-z-] identifiers;
// in a pre-release (numeric) a numeric identifier has no leading zero.
func validIdentifiers(s string, pre bool) bool {
	if s == "" {
		return false
	}
	for _, id := range strings.Split(s, ".") {
		if id == "" {
			return false
		}
		numeric := true
		for _, c := range id {
			switch {
			case c >= '0' && c <= '9':
			case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c == '-':
				numeric = false
			default:
				return false
			}
		}
		if pre && numeric && len(id) > 1 && id[0] == '0' {
			return false
		}
	}
	return true
}

// IsZero reports a Version that was never parsed.
func (v Version) IsZero() bool { return !v.valid }

// Prerelease reports a version with a pre-release part.
func (v Version) Prerelease() bool { return len(v.pre) > 0 }

// String is the version without a leading v and without build metadata.
func (v Version) String() string {
	s := strconv.FormatUint(v.Major, 10) + "." + strconv.FormatUint(v.Minor, 10) + "." + strconv.FormatUint(v.Patch, 10)
	if len(v.pre) > 0 {
		s += "-" + strings.Join(v.pre, ".")
	}
	return s
}

// Compare returns -1, 0 or 1 by semver precedence.
func (v Version) Compare(o Version) int {
	for _, p := range [][2]uint64{{v.Major, o.Major}, {v.Minor, o.Minor}, {v.Patch, o.Patch}} {
		if p[0] != p[1] {
			if p[0] < p[1] {
				return -1
			}
			return 1
		}
	}
	switch {
	case len(v.pre) == 0 && len(o.pre) == 0:
		return 0
	case len(v.pre) == 0:
		return 1 // a release is above its pre-releases
	case len(o.pre) == 0:
		return -1
	}
	for i := 0; i < len(v.pre) && i < len(o.pre); i++ {
		if c := comparePre(v.pre[i], o.pre[i]); c != 0 {
			return c
		}
	}
	switch {
	case len(v.pre) < len(o.pre):
		return -1
	case len(v.pre) > len(o.pre):
		return 1
	}
	return 0
}

// comparePre orders two pre-release identifiers: numbers numerically and
// below text, text in ASCII order.
func comparePre(a, b string) int {
	an, aok := parseNumber(a)
	bn, bok := parseNumber(b)
	switch {
	case aok && bok:
		if an < bn {
			return -1
		} else if an > bn {
			return 1
		}
		return 0
	case aok:
		return -1
	case bok:
		return 1
	}
	return strings.Compare(a, b)
}
