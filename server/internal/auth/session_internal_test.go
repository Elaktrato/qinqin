package auth

import (
	"context"
	"database/sql"
	"net/http"
	"path/filepath"
	"testing"
	"time"

	"qinqin/internal/db"
)

func openTest(t *testing.T) *sql.DB {
	t.Helper()
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	return sqlDB
}

// seedUser inserts a user without hashing a password (these tests are about
// sessions, not argon2).
func seedUser(t *testing.T, sqlDB *sql.DB, name string) int64 {
	t.Helper()
	res, err := sqlDB.Exec(`INSERT INTO users (username, hash, admin, updated_at, created_at) VALUES (?, 'x', 0, 't', 't')`, name)
	if err != nil {
		t.Fatal(err)
	}
	id, _ := res.LastInsertId()
	return id
}

func reqWith(token string) *http.Request {
	r, _ := http.NewRequest("GET", "/", nil)
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	return r
}

func setClock(t *testing.T, at time.Time) *time.Time {
	t.Helper()
	cur := at
	old := nowFunc
	nowFunc = func() time.Time { return cur }
	t.Cleanup(func() { nowFunc = old })
	return &cur
}

func TestSessionIdleExpiry(t *testing.T) {
	sqlDB := openTest(t)
	uid := seedUser(t, sqlDB, "a")
	clock := setClock(t, time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	tok, err := NewSession(context.Background(), sqlDB, uid, LoginOptions{})
	if err != nil {
		t.Fatal(err)
	}
	*clock = clock.Add(SessionIdle - time.Hour)
	if p, err := Authenticate(reqWith(tok), sqlDB); err != nil || p == nil {
		t.Fatalf("89-day-old session: p=%v err=%v, want valid", p, err)
	}
	// The use above refreshed last_used_at; a gap longer than SessionIdle kills it.
	*clock = clock.Add(SessionIdle + time.Hour)
	if p, err := Authenticate(reqWith(tok), sqlDB); err != nil || p != nil {
		t.Fatalf("idle session: p=%v err=%v, want nil", p, err)
	}
}

func TestSessionLastUsedWrittenOnlyEveryFiveMinutes(t *testing.T) {
	sqlDB := openTest(t)
	uid := seedUser(t, sqlDB, "a")
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	clock := setClock(t, start)
	tok, _ := NewSession(context.Background(), sqlDB, uid, LoginOptions{})
	last := func() string {
		var s string
		sqlDB.QueryRow(`SELECT last_used_at FROM sessions`).Scan(&s)
		return s
	}
	*clock = start.Add(4 * time.Minute)
	Authenticate(reqWith(tok), sqlDB)
	if got := last(); got != start.Format(time.RFC3339) {
		t.Errorf("last_used_at after 4 min = %s, want unchanged", got)
	}
	*clock = start.Add(6 * time.Minute)
	Authenticate(reqWith(tok), sqlDB)
	if got := last(); got != start.Add(6*time.Minute).Format(time.RFC3339) {
		t.Errorf("last_used_at after 6 min = %s, want updated", got)
	}
}

func TestDisabledUserDoesNotAuthenticate(t *testing.T) {
	sqlDB := openTest(t)
	uid := seedUser(t, sqlDB, "a")
	tok, _ := NewSession(context.Background(), sqlDB, uid, LoginOptions{})
	if p, _ := Authenticate(reqWith(tok), sqlDB); p == nil {
		t.Fatal("fresh session does not authenticate")
	}
	sqlDB.Exec(`UPDATE users SET disabled_at = 't' WHERE id = ?`, uid)
	if p, err := Authenticate(reqWith(tok), sqlDB); err != nil || p != nil {
		t.Errorf("disabled user: p=%v err=%v, want nil", p, err)
	}
}

func TestPlaintextTokenAsHashDoesNotAuthenticate(t *testing.T) {
	sqlDB := openTest(t)
	uid := seedUser(t, sqlDB, "a")
	sqlDB.Exec(`INSERT INTO sessions (token_hash, user_id, created_at, last_used_at) VALUES ('plain-token', ?, ?, ?)`,
		uid, now(), now())
	if p, err := Authenticate(reqWith("plain-token"), sqlDB); err != nil || p != nil {
		t.Errorf("plaintext row: p=%v err=%v, want nil", p, err)
	}
}

func TestWarmComputesDummyHash(t *testing.T) {
	resetDummyForTest()
	if dummyHashReady() {
		t.Fatal("dummy hash ready before Warm")
	}
	Warm()
	if !dummyHashReady() {
		t.Fatal("dummy hash not ready after Warm")
	}
}
