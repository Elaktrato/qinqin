package auth_test

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/auth"
	"qinqin/internal/db"
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
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
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
	}
	for _, c := range cases {
		err := auth.CheckNewUsername(ctx, sqlDB, c.name)
		if !errors.Is(err, c.want) || (c.want == nil && err != nil) {
			t.Errorf("CheckNewUsername(%q) = %v, want %v", c.name, err, c.want)
		}
	}
}
