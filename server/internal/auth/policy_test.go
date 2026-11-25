package auth_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"qinqin/internal/auth"
	"qinqin/internal/dbtest"
)

func TestCheckPassword(t *testing.T) {
	cases := []struct {
		name, user, pw string
		weak           bool
	}{
		{"9 runes", "alice", "123456789", true},
		{"10 runes", "alice", "1234567890", false},
		{"10 multibyte runes", "alice", "ääääääääää", false},
		{"256 runes", "alice", strings.Repeat("a", 256), false},
		{"257 runes", "alice", strings.Repeat("a", 257), true},
		{"empty", "alice", "", true},
		{"equals username other case", "Alice-Wonder", "alice-wonder", true},
		{"equals username exactly", "alicealice", "alicealice", true},
		{"contains username is fine", "alice", "alice-is-here-1", false},
		{"no composition rules", "alice", "aaaaaaaaaaaa", false},
	}
	for _, c := range cases {
		err := auth.CheckPassword(c.user, c.pw)
		if got := errors.Is(err, auth.ErrWeakPassword); got != c.weak {
			t.Errorf("%s: err = %v, weak = %v, want %v", c.name, err, got, c.weak)
		}
		if c.weak && auth.PolicyReason(err) == "" {
			t.Errorf("%s: no reason", c.name)
		}
	}
}

func TestCheckNewUsername(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	if _, err := auth.CreateUser(ctx, sqlDB, "alice", "secret-pass-1", false); err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name string
		want error
	}{
		{"ab", auth.ErrInvalidUsername},
		{"abc", nil},
		{strings.Repeat("x", 32), nil},
		{strings.Repeat("x", 33), auth.ErrInvalidUsername},
		{"a@b", auth.ErrInvalidUsername},
		{"with space", auth.ErrInvalidUsername},
		{"tab\tname", auth.ErrInvalidUsername},
		{"Zoë-李", nil},
		{"dot.under_dash-1", nil},
		{"Alice", auth.ErrUsernameTaken},
		{"ALICE", auth.ErrUsernameTaken},
		{"", auth.ErrInvalidUsername},
		{"b\u043eb", auth.ErrInvalidUsername},        // Latin b + Cyrillic o
		{"\u03b1lice", auth.ErrInvalidUsername},      // Greek alpha + Latin
		{"\u0431\u043e\u0431", nil},                  // pure Cyrillic is fine
		{"\u03b1\u03b2\u03b3", nil},                  // pure Greek is fine
		{"zero\u200bwidth", auth.ErrInvalidUsername}, // Cf format character
		{"rtl\u202eover", auth.ErrInvalidUsername},
		{"\uff21lice", auth.ErrUsernameTaken}, // fullwidth A: same NFKC key as alice
	}
	for _, c := range cases {
		err := auth.CheckNewUsername(ctx, sqlDB, c.name)
		if !errors.Is(err, c.want) || (c.want == nil && err != nil) {
			t.Errorf("CheckNewUsername(%q) = %v, want %v", c.name, err, c.want)
		}
	}
}

func TestNormalizeUsernameIsNFC(t *testing.T) {
	if got := auth.NormalizeUsername("  Zoe\u0308 "); got != "Zo\u00eb" {
		t.Errorf("NormalizeUsername = %q, want trimmed NFC", got)
	}
}

// 'bob' and 'Bob' racing for the name: the unique index lets exactly one in.
func TestConcurrentCreateUserCaseVariants(t *testing.T) {
	sqlDB := dbtest.Open(t)
	for round := 0; round < 10; round++ {
		names := []string{fmt.Sprintf("bob%d", round), fmt.Sprintf("Bob%d", round)}
		res := make(chan error, 2)
		for _, n := range names {
			go func() {
				_, err := auth.CreateUser(context.Background(), sqlDB, n, "secret-pass-1", false)
				res <- err
			}()
		}
		ok, taken := 0, 0
		for i := 0; i < 2; i++ {
			switch err := <-res; {
			case err == nil:
				ok++
			case errors.Is(err, auth.ErrUsernameTaken):
				taken++
			default:
				t.Fatal(err)
			}
		}
		if ok != 1 || taken != 1 {
			t.Fatalf("round %d: %d created, %d taken, want 1 and 1", round, ok, taken)
		}
	}
}
