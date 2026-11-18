package main

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/auth"
	"qinqin/internal/db"
)

type bootstrapLog struct {
	logs []string
}

func (b *bootstrapLog) logf(format string, args ...any) {
	b.logs = append(b.logs, fmt.Sprintf(format, args...))
}

func (b *bootstrapLog) all() string { return strings.Join(b.logs, "\n") }

func bootstrapDB(t *testing.T) (*bootstrapLog, func(map[string]string) error, func() int) {
	t.Helper()
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "qinqin.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	b := &bootstrapLog{}
	run := func(env map[string]string) error {
		return bootstrapAdminFromEnv(context.Background(), sqlDB, func(k string) string { return env[k] }, b.logf)
	}
	count := func() int {
		var n int
		sqlDB.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&n)
		return n
	}
	return b, run, count
}

func TestBootstrapAdminOffWhenUnset(t *testing.T) {
	b, run, count := bootstrapDB(t)
	if err := run(map[string]string{"QINQIN_BOOTSTRAP_PASSWORD": "initial-pass-1"}); err != nil {
		t.Fatal(err)
	}
	if count() != 0 || len(b.logs) != 0 {
		t.Errorf("users = %d, logs = %q; want nothing without QINQIN_BOOTSTRAP_ADMIN", count(), b.logs)
	}
}

func TestBootstrapAdminGeneratesAndLogsPasswordOnce(t *testing.T) {
	b, run, count := bootstrapDB(t)
	if err := run(map[string]string{"QINQIN_BOOTSTRAP_ADMIN": "  Root.Admin "}); err != nil {
		t.Fatal(err)
	}
	if count() != 1 {
		t.Fatalf("users = %d, want 1", count())
	}
	const marker = "never again): "
	var pw string
	lines := 0
	for _, l := range b.logs {
		if i := strings.Index(l, marker); i >= 0 {
			pw = strings.TrimSpace(l[i+len(marker):])
			lines++
		}
	}
	if lines != 1 || len(pw) < 20 {
		t.Fatalf("logs = %q; want exactly one initial-password line with >= 20 chars", b.logs)
	}
	if err := auth.CheckPassword("Root.Admin", pw); err != nil {
		t.Errorf("generated password fails the policy: %v", err)
	}
	for _, r := range pw {
		if !strings.ContainsRune("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", r) {
			t.Errorf("password has non URL-safe rune %q", r)
		}
	}
	// The name was normalized (trimmed).
	if !strings.Contains(b.all(), "Root.Admin") || strings.Contains(b.all(), " Root.Admin ") {
		t.Errorf("logs = %q; want the trimmed admin name", b.logs)
	}

	// Second start: nothing happens, nothing sensitive is logged.
	before := len(b.logs)
	if err := run(map[string]string{"QINQIN_BOOTSTRAP_ADMIN": "Root.Admin"}); err != nil {
		t.Fatal(err)
	}
	if count() != 1 {
		t.Errorf("users = %d after second start, want 1", count())
	}
	for _, l := range b.logs[before:] {
		if strings.Contains(l, pw) || strings.Contains(l, marker) {
			t.Errorf("second start logged %q", l)
		}
	}
}

func TestBootstrapAdminSuppliedPasswordNeverLogged(t *testing.T) {
	b, run, count := bootstrapDB(t)
	const pw = "supplied-secret-77"
	if err := run(map[string]string{"QINQIN_BOOTSTRAP_ADMIN": "root", "QINQIN_BOOTSTRAP_PASSWORD": pw}); err != nil {
		t.Fatal(err)
	}
	if count() != 1 {
		t.Fatalf("users = %d, want 1", count())
	}
	if strings.Contains(b.all(), pw) || strings.Contains(b.all(), "never again") {
		t.Errorf("logs leak the supplied password: %q", b.logs)
	}
}

func TestBootstrapAdminPolicyViolationsFail(t *testing.T) {
	for name, env := range map[string]map[string]string{
		"short name":     {"QINQIN_BOOTSTRAP_ADMIN": "ab", "QINQIN_BOOTSTRAP_PASSWORD": "initial-pass-1"},
		"bad characters": {"QINQIN_BOOTSTRAP_ADMIN": "ro ot@x", "QINQIN_BOOTSTRAP_PASSWORD": "initial-pass-1"},
		"weak password":  {"QINQIN_BOOTSTRAP_ADMIN": "root", "QINQIN_BOOTSTRAP_PASSWORD": "short"},
	} {
		t.Run(name, func(t *testing.T) {
			_, run, count := bootstrapDB(t)
			err := run(env)
			if err == nil || !strings.Contains(err.Error(), "QINQIN_BOOTSTRAP") {
				t.Fatalf("err = %v, want one naming the QINQIN_BOOTSTRAP variable", err)
			}
			if count() != 0 {
				t.Errorf("users = %d, want 0", count())
			}
		})
	}
}

func TestBootstrapAdminIgnoresConfigOnceUsersExist(t *testing.T) {
	_, run, count := bootstrapDB(t)
	if err := run(map[string]string{"QINQIN_BOOTSTRAP_ADMIN": "root", "QINQIN_BOOTSTRAP_PASSWORD": "initial-pass-1"}); err != nil {
		t.Fatal(err)
	}
	// An invalid value is not even looked at once the instance has users.
	if err := run(map[string]string{"QINQIN_BOOTSTRAP_ADMIN": "x", "QINQIN_BOOTSTRAP_PASSWORD": "y"}); err != nil {
		t.Errorf("later start with users = %v, want nil", err)
	}
	if count() != 1 {
		t.Errorf("users = %d, want 1", count())
	}
}
