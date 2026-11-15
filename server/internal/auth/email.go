package auth

import (
	"errors"
	"fmt"
	"net/mail"
	"strings"
	"unicode"

	"golang.org/x/net/idna"
)

// Email policy errors, mapped to 422/409 by the API.
var (
	ErrEmailRequired = errors.New("email required")
	ErrEmailDisabled = errors.New("email disabled")
	ErrInvalidEmail  = errors.New("invalid email")
	ErrEmailTaken    = errors.New("email taken")

	// ErrEmailLocalNotASCII is an invalid address whose part before the @
	// has non-ASCII letters: SMTPUTF8 mailboxes are not supported until the
	// mail work of plan 3 decides on them.
	ErrEmailLocalNotASCII = fmt.Errorf("%w: the part before the @ must be ASCII (internationalised mailboxes are not supported)", ErrInvalidEmail)
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
	local, domain, ok := strings.Cut(raw, "@")
	if !ok || local == "" || strings.Contains(domain, "@") {
		return "", "", ErrInvalidEmail
	}
	for _, r := range local {
		if r > unicode.MaxASCII {
			return "", "", ErrEmailLocalNotASCII
		}
	}
	// The domain is stored in its ASCII (punycode) form, so "bücher.de" and
	// "xn--bcher-kva.de" are one address; the mail path is ASCII only.
	for _, r := range domain {
		if unicode.Is(unicode.Cf, r) { // zero-width and direction marks would be mapped away silently
			return "", "", ErrInvalidEmail
		}
	}
	ascii, ierr := idna.Lookup.ToASCII(domain)
	if ierr != nil || !strings.Contains(ascii, ".") || strings.HasPrefix(ascii, ".") || strings.HasSuffix(ascii, ".") || strings.Contains(ascii, "..") {
		return "", "", ErrInvalidEmail
	}
	joined := local + "@" + ascii
	addr, perr := mail.ParseAddress(joined)
	if perr != nil || addr.Address != joined || len(joined) > maxEmailBytes {
		return "", "", ErrInvalidEmail
	}
	return joined, strings.ToLower(joined), nil
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
