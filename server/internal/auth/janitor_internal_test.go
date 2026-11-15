package auth

import (
	"context"
	"testing"
	"time"
)

func TestPruneRemovesIdleSessionsAndOldAuditRows(t *testing.T) {
	sqlDB := openTest(t)
	uid := seedUser(t, sqlDB, "a")
	now := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	ins := func(hash string, lastUsed time.Time) {
		sqlDB.Exec(`INSERT INTO sessions (token_hash, user_id, created_at, last_used_at) VALUES (?, ?, 't', ?)`,
			hash, uid, lastUsed.Format(time.RFC3339))
	}
	ins("fresh", now.Add(-time.Hour))
	ins("edge-in", now.Add(-SessionIdle+time.Hour))
	ins("edge-out", now.Add(-SessionIdle-time.Hour))
	ins("ancient", now.Add(-400*24*time.Hour))
	aud := func(at time.Time) {
		sqlDB.Exec(`INSERT INTO auth_audit (at, action) VALUES (?, 'x')`, at.Format(time.RFC3339))
	}
	aud(now.Add(-time.Hour))
	aud(now.Add(-AuditRetention + time.Hour))
	aud(now.Add(-AuditRetention - time.Hour))

	s, a, err := Prune(context.Background(), sqlDB, now)
	if err != nil || s != 2 || a != 1 {
		t.Fatalf("Prune = %d sessions, %d audit rows, %v; want 2, 1", s, a, err)
	}
	var left []string
	rows, _ := sqlDB.Query(`SELECT token_hash FROM sessions ORDER BY token_hash`)
	for rows.Next() {
		var h string
		rows.Scan(&h)
		left = append(left, h)
	}
	rows.Close()
	if len(left) != 2 || left[0] != "edge-in" || left[1] != "fresh" {
		t.Errorf("sessions left = %v", left)
	}
}

func TestRunJanitorSweepsAtStartAndStopsWithItsContext(t *testing.T) {
	sqlDB := openTest(t)
	uid := seedUser(t, sqlDB, "a")
	sqlDB.Exec(`INSERT INTO sessions (token_hash, user_id, created_at, last_used_at) VALUES ('old', ?, 't', '2000-01-01T00:00:00Z')`, uid)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { RunJanitor(ctx, sqlDB, time.Hour, func(string, ...any) {}); close(done) }()
	deadline := time.After(5 * time.Second)
	for {
		var n int
		sqlDB.QueryRow(`SELECT COUNT(*) FROM sessions`).Scan(&n)
		if n == 0 {
			break
		}
		select {
		case <-deadline:
			t.Fatal("the first sweep never ran")
		case <-time.After(20 * time.Millisecond):
		}
	}
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("janitor ignored its context")
	}
}

func TestPruneDropsSpentAndExpiredResetLinksAfterAWeek(t *testing.T) {
	sqlDB := openTest(t)
	now := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	at := func(d time.Duration) string { return now.Add(d).Format(time.RFC3339) }
	ins := func(hash, expires string, used any) {
		sqlDB.Exec(`INSERT INTO password_resets (token_hash, user_id, created_at, expires_at, used_at) VALUES (?, 1, 't', ?, ?)`, hash, expires, used)
	}
	ins("live", at(time.Hour), nil)
	ins("expired-recently", at(-time.Hour), nil)
	ins("expired-long-ago", at(-8*24*time.Hour), nil)
	ins("used-long-ago", at(24*time.Hour), at(-8*24*time.Hour))
	ins("used-recently", at(24*time.Hour), at(-time.Hour))
	if _, _, err := Prune(context.Background(), sqlDB, now); err != nil {
		t.Fatal(err)
	}
	var left []string
	rows, _ := sqlDB.Query(`SELECT token_hash FROM password_resets ORDER BY token_hash`)
	for rows.Next() {
		var h string
		rows.Scan(&h)
		left = append(left, h)
	}
	rows.Close()
	if len(left) != 3 || left[0] != "expired-recently" || left[1] != "live" || left[2] != "used-recently" {
		t.Errorf("reset links left = %v", left)
	}
}
