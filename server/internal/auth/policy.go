package auth

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Password length bounds, in runes. There are no composition rules.
const (
	MinPasswordRunes = 10
	MaxPasswordRunes = 256
)

// ErrWeakPassword marks a password the policy rejects; PolicyReason has
// the sentence for the person.
var ErrWeakPassword = errors.New("weak password")

// ErrInvalidUsername marks a username the policy rejects.
var ErrInvalidUsername = errors.New("invalid username")

type policyError struct {
	kind   error
	reason string
}

func (e *policyError) Error() string { return e.kind.Error() + ": " + e.reason }
func (e *policyError) Unwrap() error { return e.kind }

// PolicyReason is the English sentence behind an ErrWeakPassword or
// ErrInvalidUsername, "" for any other error.
func PolicyReason(err error) string {
	var pe *policyError
	if errors.As(err, &pe) {
		return pe.reason
	}
	return ""
}

// CheckPassword applies the policy for new passwords (register, admin
// create, change, reset, CLI): 10-256 characters, not the username in any
// letter case. Existing passwords are grandfathered.
func CheckPassword(username, password string) error {
	n := utf8.RuneCountInString(password)
	switch {
	case n < MinPasswordRunes:
		return &policyError{ErrWeakPassword, fmt.Sprintf("Use at least %d characters.", MinPasswordRunes)}
	case n > MaxPasswordRunes:
		return &policyError{ErrWeakPassword, fmt.Sprintf("Use at most %d characters.", MaxPasswordRunes)}
	case strings.EqualFold(password, username):
		return &policyError{ErrWeakPassword, "The password must differ from the username."}
	}
	return nil
}

// Username length bounds, in runes.
const (
	minUsernameRunes = 3
	maxUsernameRunes = 32
)

// CheckNewUsername applies the policy for new usernames: 3-32 runes of
// letters, digits, ".", "_" and "-" (no "@", so "username or email" fields
// stay unambiguous), free case-insensitively. Existing usernames are
// grandfathered at login.
func CheckNewUsername(ctx context.Context, sqlDB *sql.DB, name string) error {
	n := utf8.RuneCountInString(name)
	if n < minUsernameRunes || n > maxUsernameRunes {
		return &policyError{ErrInvalidUsername, fmt.Sprintf("Use %d to %d characters.", minUsernameRunes, maxUsernameRunes)}
	}
	for _, r := range name {
		if !(unicode.IsLetter(r) || unicode.IsDigit(r) || unicode.IsMark(r) || r == '.' || r == '_' || r == '-') {
			return &policyError{ErrInvalidUsername, "Use letters, digits, dots, underscores and hyphens only."}
		}
	}
	var one int
	err := sqlDB.QueryRowContext(ctx, `SELECT 1 FROM users WHERE username = ? COLLATE NOCASE`, name).Scan(&one)
	if err == nil {
		return ErrUsernameTaken
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("check username: %w", err)
	}
	return nil
}
