package auth

import (
	"errors"
	"net/mail"
	"strings"
	"unicode"
)

// Email policy errors, mapped to 422/409 by the API.
var (
	ErrEmailRequired = errors.New("email required")
	ErrEmailDisabled = errors.New("email disabled")
	ErrInvalidEmail  = errors.New("invalid email")
	ErrEmailTaken    = errors.New("email taken")
)

const maxEmailBytes = 254

// NormalizeEmail validates an address and returns its display form (the
// bare address) and its lookup form (lower-cased). Rules: parses as one
// RFC 5322 address, no display name, at most 254 bytes, no control
// characters, exactly one "@" and a dotted domain.
func NormalizeEmail(raw string) (display, norm string, err error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || len(raw) > maxEmailBytes {
		return "", "", ErrInvalidEmail
	}
	for _, r := range raw {
		if unicode.IsControl(r) || unicode.IsSpace(r) {
			return "", "", ErrInvalidEmail
		}
	}
	addr, perr := mail.ParseAddress(raw)
	if perr != nil || addr.Address != raw || strings.Count(raw, "@") != 1 {
		return "", "", ErrInvalidEmail
	}
	_, domain, _ := strings.Cut(raw, "@")
	if !strings.Contains(domain, ".") || strings.HasPrefix(domain, ".") || strings.HasSuffix(domain, ".") || strings.Contains(domain, "..") {
		return "", "", ErrInvalidEmail
	}
	return raw, strings.ToLower(raw), nil
}

// ApplyEmailPolicy checks an optional email against the instance policy
// and returns it normalized (nil, nil when none is stored). off: an email
// is refused; required: one must be given; optional: either.
func ApplyEmailPolicy(policy string, email *string) (display, norm *string, err error) {
	given := email != nil && strings.TrimSpace(*email) != ""
	switch {
	case !given && policy == "required":
		return nil, nil, ErrEmailRequired
	case !given:
		return nil, nil, nil
	case policy == "off":
		return nil, nil, ErrEmailDisabled
	}
	d, n, err := NormalizeEmail(*email)
	if err != nil {
		return nil, nil, err
	}
	return &d, &n, nil
}
