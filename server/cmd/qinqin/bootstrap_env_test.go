package main

import (
	"context"
	"database/sql"
	"fmt"
	"net"
	"strings"
	"sync"
	"testing"

	"qinqin/internal/auth"
	"qinqin/internal/db"
	"qinqin/internal/dbtest"
	"qinqin/internal/model"
)

// The marker of the one line that carries a generated password.
const passwordMarker = "never again): "

type bootstrapLog struct {
	mu   sync.Mutex
	logs []string
}

func (b *bootstrapLog) logf(format string, args ...any) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.logs = append(b.logs, fmt.Sprintf(format, args...))
}

func (b *bootstrapLog) all() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return strings.Join(b.logs, "\n")
}

// passwords returns every password the log printed.
func (b *bootstrapLog) passwords() []string {
	b.mu.Lock()
	defer b.mu.Unlock()
	var out []string
	for _, l := range b.logs {
		if i := strings.Index(l, passwordMarker); i >= 0 {
			out = append(out, strings.TrimSpace(l[i+len(passwordMarker):]))
		}
	}
	return out
}

type bootstrapEnv struct {
	db  *sql.DB
	log *bootstrapLog
}

func newBootstrapEnv(t *testing.T) *bootstrapEnv {
	t.Helper()
	return &bootstrapEnv{db: dbtest.Open(t), log: &bootstrapLog{}}
}

func (e *bootstrapEnv) run(env map[string]string) error {
	return bootstrapAdminFromEnv(context.Background(), e.db, func(k string) string { return env[k] }, e.log.logf)
}

func (e *bootstrapEnv) count(t *testing.T) int {
	t.Helper()
	var n int
	if err := e.db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// admin returns the only user's name, admin flag, forced-change flag and hash.
func (e *bootstrapEnv) admin(t *testing.T) (name string, admin, mustChange bool, hash string) {
	t.Helper()
	if err := e.db.QueryRow(`SELECT username, admin, must_change_password, hash FROM users`).
		Scan(&name, &admin, &mustChange, &hash); err != nil {
		t.Fatal(err)
	}
	return
}

// With no variables at all, a fresh instance gets `admin` with a generated
// password printed exactly once; a later start prints nothing (#211).
func TestBootstrapAdminByDefault(t *testing.T) {
	e := newBootstrapEnv(t)
	if err := e.run(nil); err != nil {
		t.Fatal(err)
	}
	if e.count(t) != 1 {
		t.Fatalf("users = %d, want 1", e.count(t))
	}
	name, admin, mustChange, hash := e.admin(t)
	if name != "admin" || !admin || !mustChange {
		t.Errorf("user = %q admin=%t mustChange=%t; want admin, an administrator who must change the password", name, admin, mustChange)
	}
	pws := e.log.passwords()
	if len(pws) != 1 || len(pws[0]) != 20 {
		t.Fatalf("logs = %q; want exactly one initial-password line with 20 characters", e.log.logs)
	}
	pw := pws[0]
	if strings.Count(e.log.all(), pw) != 1 {
		t.Errorf("the password appears %d times in the log, want once", strings.Count(e.log.all(), pw))
	}
	if !auth.Verify(hash, pw) {
		t.Error("the logged password does not sign the admin in")
	}
	if err := auth.CheckPassword("admin", pw); err != nil {
		t.Errorf("generated password fails the policy: %v", err)
	}
	for _, r := range pw {
		if !strings.ContainsRune("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", r) {
			t.Errorf("password has non URL-safe rune %q", r)
		}
	}

	// A later start: nothing happens and nothing is logged.
	before := len(e.log.logs)
	if err := e.run(nil); err != nil {
		t.Fatal(err)
	}
	if e.count(t) != 1 || len(e.log.logs) != before {
		t.Errorf("second start: users = %d, new logs = %q; want 1 and none", e.count(t), e.log.logs[before:])
	}
}

// Two fresh instances never share a generated password.
func TestBootstrapAdminPasswordsDiffer(t *testing.T) {
	a, b := newBootstrapEnv(t), newBootstrapEnv(t)
	if err := a.run(nil); err != nil {
		t.Fatal(err)
	}
	if err := b.run(nil); err != nil {
		t.Fatal(err)
	}
	if pa, pb := a.log.passwords(), b.log.passwords(); len(pa) != 1 || len(pb) != 1 || pa[0] == pb[0] {
		t.Errorf("passwords %q and %q; want two different ones", pa, pb)
	}
}

func TestBootstrapAdminNamed(t *testing.T) {
	e := newBootstrapEnv(t)
	if err := e.run(map[string]string{"QINQIN_BOOTSTRAP_ADMIN": "  Root.Admin "}); err != nil {
		t.Fatal(err)
	}
	if name, admin, _, _ := e.admin(t); name != "Root.Admin" || !admin {
		t.Errorf("user = %q admin=%t; want the trimmed name Root.Admin as administrator", name, admin)
	}
	if !strings.Contains(e.log.all(), `"Root.Admin"`) {
		t.Errorf("logs = %q; want the trimmed admin name", e.log.logs)
	}
	if len(e.log.passwords()) != 1 {
		t.Errorf("logs = %q; want one generated password line", e.log.logs)
	}
}

func TestBootstrapAdminSuppliedPasswordNeverLogged(t *testing.T) {
	e := newBootstrapEnv(t)
	const pw = "placeholder-pass-77"
	if err := e.run(map[string]string{"QINQIN_BOOTSTRAP_PASSWORD": pw}); err != nil {
		t.Fatal(err)
	}
	name, _, mustChange, hash := e.admin(t)
	if name != "admin" || !mustChange || !auth.Verify(hash, pw) {
		t.Errorf("user = %q mustChange=%t verify=%t; want admin with the supplied password and a forced change", name, mustChange, auth.Verify(hash, pw))
	}
	if strings.Contains(e.log.all(), pw) || strings.Contains(e.log.all(), "never again") {
		t.Errorf("logs leak the supplied password: %q", e.log.logs)
	}
}

// `off` (any case) switches the bootstrap off: nothing is created, the log
// says how to create the admin, and a supplied password is ignored by name.
func TestBootstrapAdminOff(t *testing.T) {
	for _, v := range []string{"off", " OFF ", "Off"} {
		t.Run(v, func(t *testing.T) {
			e := newBootstrapEnv(t)
			const pw = "placeholder-pass-77"
			if err := e.run(map[string]string{"QINQIN_BOOTSTRAP_ADMIN": v, "QINQIN_BOOTSTRAP_PASSWORD": pw}); err != nil {
				t.Fatal(err)
			}
			if e.count(t) != 0 {
				t.Errorf("users = %d, want 0", e.count(t))
			}
			all := e.log.all()
			if !strings.Contains(all, "adduser") || !strings.Contains(all, "QINQIN_BOOTSTRAP_PASSWORD") {
				t.Errorf("logs = %q; want the adduser hint and the ignored variable named", e.log.logs)
			}
			if strings.Contains(all, pw) || len(e.log.passwords()) != 0 {
				t.Errorf("logs = %q; want no password", e.log.logs)
			}
		})
	}
}

// Off with users: silent, like every later start.
func TestBootstrapAdminOffWithUsersIsSilent(t *testing.T) {
	e := newBootstrapEnv(t)
	if _, err := auth.CreateUser(context.Background(), e.db, "owner", "owner-pass-123", true); err != nil {
		t.Fatal(err)
	}
	if err := e.run(map[string]string{"QINQIN_BOOTSTRAP_ADMIN": "off", "QINQIN_BOOTSTRAP_PASSWORD": "placeholder-pass-77"}); err != nil {
		t.Fatal(err)
	}
	if len(e.log.logs) != 0 {
		t.Errorf("logs = %q; want none", e.log.logs)
	}
}

func TestBootstrapAdminPolicyViolationsFail(t *testing.T) {
	for name, env := range map[string]map[string]string{
		"short name":         {"QINQIN_BOOTSTRAP_ADMIN": "ab", "QINQIN_BOOTSTRAP_PASSWORD": "initial-pass-1"},
		"bad characters":     {"QINQIN_BOOTSTRAP_ADMIN": "ro ot@x", "QINQIN_BOOTSTRAP_PASSWORD": "initial-pass-1"},
		"weak password":      {"QINQIN_BOOTSTRAP_ADMIN": "root", "QINQIN_BOOTSTRAP_PASSWORD": "short"},
		"default name, weak": {"QINQIN_BOOTSTRAP_PASSWORD": "short"},
		"password = name":    {"QINQIN_BOOTSTRAP_PASSWORD": "admin"},
	} {
		t.Run(name, func(t *testing.T) {
			e := newBootstrapEnv(t)
			err := e.run(env)
			if err == nil || !strings.Contains(err.Error(), "QINQIN_BOOTSTRAP") {
				t.Fatalf("err = %v, want one naming the QINQIN_BOOTSTRAP variable", err)
			}
			if e.count(t) != 0 {
				t.Errorf("users = %d, want 0", e.count(t))
			}
			if pw := env["QINQIN_BOOTSTRAP_PASSWORD"]; strings.Contains(err.Error(), pw) && pw != "admin" {
				t.Errorf("err = %v leaks the password", err)
			}
		})
	}
}

// A non-empty database: nothing happens, and invalid values are not even read.
func TestBootstrapAdminIgnoresConfigOnceUsersExist(t *testing.T) {
	e := newBootstrapEnv(t)
	if _, err := auth.CreateUser(context.Background(), e.db, "owner", "owner-pass-123", true); err != nil {
		t.Fatal(err)
	}
	for _, env := range []map[string]string{
		nil,
		{"QINQIN_BOOTSTRAP_ADMIN": "x", "QINQIN_BOOTSTRAP_PASSWORD": "y"},
	} {
		if err := e.run(env); err != nil {
			t.Errorf("start with users, env %v = %v, want nil", env, err)
		}
	}
	if e.count(t) != 1 || len(e.log.logs) != 0 {
		t.Errorf("users = %d, logs = %q; want 1 and none", e.count(t), e.log.logs)
	}
}

// Two processes starting on one fresh database: one admin, one password
// line, and neither start fails (the loser gets ErrNotFirst and is silent).
func TestBootstrapAdminRaceBetweenProcesses(t *testing.T) {
	first, path := dbtest.OpenPath(t)
	second, err := db.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	b := &bootstrapLog{}
	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i, h := range []*sql.DB{first, second} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errs[i] = bootstrapAdminFromEnv(context.Background(), h, func(string) string { return "" }, b.logf)
		}()
	}
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Errorf("process %d: %v", i, err)
		}
	}
	var n int
	if err := first.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&n); err != nil || n != 1 {
		t.Errorf("users = %d (%v), want 1", n, err)
	}
	if pws := b.passwords(); len(pws) != 1 {
		t.Errorf("logs = %q; want exactly one password line", b.logs)
	}
	if c := strings.Count(b.all(), "created admin"); c != 1 {
		t.Errorf("logs = %q; want one creation line, got %d", b.logs, c)
	}
}

// serve refuses to start (never listens) on an invalid bootstrap name.
func TestServeRefusesAnInvalidBootstrapAdmin(t *testing.T) {
	quietServeEnv(t)
	t.Setenv("QINQIN_BOOTSTRAP_ADMIN", "ab")
	listened := false
	err := serve(context.Background(), t.TempDir(), func() (net.Listener, error) {
		listened = true
		return nil, fmt.Errorf("must not listen")
	})
	if err == nil || !strings.Contains(err.Error(), "QINQIN_BOOTSTRAP_ADMIN") || listened {
		t.Errorf("serve = %v, listened = %t; want a QINQIN_BOOTSTRAP_ADMIN error before listening", err, listened)
	}
}

// The loser of the race, deterministically: another process inserts its
// admin between this one's count and its insert. The start succeeds, the
// winner's admin stays, and the loser logs nothing (no password either).
func TestBootstrapAdminLosingTheRaceIsSilent(t *testing.T) {
	e := newBootstrapEnv(t)
	real := bootstrapAdmin
	t.Cleanup(func() { bootstrapAdmin = real })
	bootstrapAdmin = func(ctx context.Context, sqlDB *sql.DB, name, password string) (model.User, error) {
		if _, err := real(ctx, sqlDB, "winner", "winner-pass-123"); err != nil {
			t.Fatal(err)
		}
		return real(ctx, sqlDB, name, password)
	}
	if err := e.run(nil); err != nil {
		t.Fatalf("losing start = %v, want nil", err)
	}
	if name, _, _, _ := e.admin(t); name != "winner" || e.count(t) != 1 {
		t.Errorf("user = %q, users = %d; want only the winner", name, e.count(t))
	}
	if len(e.log.logs) != 0 {
		t.Errorf("logs = %q; want none from the loser", e.log.logs)
	}
}

// Users but no active administrator (an adduser without --admin after
// off, a non-admin registered on a restored database, the only admin
// disabled): every start says how to make one, and creates nothing.
func TestBootstrapWarnsWhenNoActiveAdmin(t *testing.T) {
	for name, setup := range map[string]func(*testing.T, *sql.DB){
		"only a non-admin": func(t *testing.T, d *sql.DB) {
			if _, err := auth.CreateUser(context.Background(), d, "learner", "learner-pass-1", false); err != nil {
				t.Fatal(err)
			}
		},
		"admin disabled": func(t *testing.T, d *sql.DB) {
			if _, err := auth.CreateUser(context.Background(), d, "boss", "boss-pass-123", true); err != nil {
				t.Fatal(err)
			}
			if _, err := d.Exec(`UPDATE users SET disabled_at = '2026-01-01T00:00:00Z'`); err != nil {
				t.Fatal(err)
			}
		},
	} {
		t.Run(name, func(t *testing.T) {
			for _, env := range []map[string]string{nil, {"QINQIN_BOOTSTRAP_ADMIN": "off", "QINQIN_BOOTSTRAP_PASSWORD": "placeholder-pass-77"}} {
				e := newBootstrapEnv(t)
				setup(t, e.db)
				if err := e.run(env); err != nil {
					t.Fatal(err)
				}
				all := e.log.all()
				if len(e.log.logs) != 1 || !strings.Contains(all, "qinqin recover --username <name> --admin") ||
					!strings.Contains(all, "adduser --admin") {
					t.Errorf("env %v: logs = %q; want one line naming recover --admin and adduser --admin", env, e.log.logs)
				}
				if strings.Contains(all, "placeholder-pass-77") || len(e.log.passwords()) != 0 || e.count(t) != 1 {
					t.Errorf("env %v: logs = %q, users = %d; want no password and nothing created", env, e.log.logs, e.count(t))
				}
			}
		})
	}
}

// Values that look like "off" but are not it are refused, so serve does
// not start with an admin named "false" or a length error (#211).
func TestBootstrapAdminRefusesOffLookalikes(t *testing.T) {
	for _, v := range []string{"false", "none", "disabled", "disable", "no", "0", "n", "nobody", "null", "FALSE", " None ", "\tNo\n"} {
		t.Run(v, func(t *testing.T) {
			e := newBootstrapEnv(t)
			err := e.run(map[string]string{"QINQIN_BOOTSTRAP_ADMIN": v})
			if err == nil || !strings.Contains(err.Error(), `use "off" to switch the bootstrap off`) {
				t.Errorf("err = %v, want the off hint", err)
			}
			if e.count(t) != 0 || len(e.log.logs) != 0 {
				t.Errorf("users = %d, logs = %q; want none", e.count(t), e.log.logs)
			}
		})
	}
	// Blank and whitespace-wrapped off keep their meaning.
	for v, want := range map[string]int{"   ": 1, "\toff\n": 0} {
		e := newBootstrapEnv(t)
		if err := e.run(map[string]string{"QINQIN_BOOTSTRAP_ADMIN": v}); err != nil || e.count(t) != want {
			t.Errorf("%q: err = %v, users = %d; want nil and %d", v, err, e.count(t), want)
		}
	}
}

// Two processes that both counted zero users insert in lockstep (from the
// review's probe): one admin, one password line, both starts nil.
func TestBootstrapAdminLockstepRace(t *testing.T) {
	real := bootstrapAdmin
	t.Cleanup(func() { bootstrapAdmin = real })
	for i := 0; i < 10; i++ {
		first, path := dbtest.OpenPath(t)
		second, err := db.Open(path) // reopen: OpenPath wrote it
		if err != nil {
			t.Fatal(err)
		}
		var bar sync.WaitGroup
		bar.Add(2)
		bootstrapAdmin = func(ctx context.Context, h *sql.DB, n, p string) (model.User, error) {
			bar.Done()
			bar.Wait()
			return real(ctx, h, n, p)
		}
		b := &bootstrapLog{}
		var wg sync.WaitGroup
		errs := make([]error, 2)
		for j, h := range []*sql.DB{first, second} {
			wg.Add(1)
			go func() {
				defer wg.Done()
				errs[j] = bootstrapAdminFromEnv(context.Background(), h, func(string) string { return "" }, b.logf)
			}()
		}
		wg.Wait()
		var n int
		first.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&n)
		if errs[0] != nil || errs[1] != nil || n != 1 || len(b.passwords()) != 1 {
			t.Errorf("iteration %d: errs = %v, users = %d, logs = %q", i, errs, n, b.all())
		}
		second.Close()
	}
}
