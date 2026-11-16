package api

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestTicketIsSingleUseExpiringAndKindBound(t *testing.T) {
	ts := newTicketStore()
	now := time.Date(2026, 11, 15, 12, 0, 0, 0, time.UTC)
	tok := ts.issue(7, "export", 60*time.Second, now)
	if len(tok) < 32 {
		t.Fatalf("token %q is too short", tok)
	}
	if _, ok := ts.consume(tok, "admin-backup", now); ok {
		t.Error("a ticket of another kind was accepted")
	}
	// the wrong-kind attempt must not burn the ticket... but it must not be
	// usable by the wrong kind either: a live right-kind consume still works
	if uid, ok := ts.consume(tok, "export", now.Add(59*time.Second)); !ok || uid != 7 {
		t.Fatalf("live ticket refused: %d %v", uid, ok)
	}
	if _, ok := ts.consume(tok, "export", now); ok {
		t.Error("a ticket was used twice")
	}
	old := ts.issue(7, "export", 60*time.Second, now)
	if _, ok := ts.consume(old, "export", now.Add(61*time.Second)); ok {
		t.Error("an expired ticket was accepted")
	}
	if _, ok := ts.consume("", "export", now); ok {
		t.Error("the empty token was accepted")
	}
	if _, ok := ts.consume("nonsense", "export", now); ok {
		t.Error("an unknown token was accepted")
	}
}

func TestTicketsAreStoredHashedAndPurged(t *testing.T) {
	ts := newTicketStore()
	now := time.Now()
	tok := ts.issue(1, "export", time.Minute, now)
	ts.mu.Lock()
	for k := range ts.m {
		if k == tok {
			t.Error("the plain token is a map key")
		}
	}
	ts.mu.Unlock()
	for i := 0; i < 5; i++ {
		ts.issue(1, "export", time.Second, now)
	}
	ts.issue(1, "export", time.Minute, now.Add(time.Hour)) // purges the expired ones
	ts.mu.Lock()
	n := len(ts.m)
	ts.mu.Unlock()
	if n != 1 {
		t.Errorf("%d tickets left, want 1 (expired ones purged)", n)
	}
}

func TestTicketConcurrentConsumeHasOneWinner(t *testing.T) {
	ts := newTicketStore()
	now := time.Now()
	for round := 0; round < 50; round++ {
		tok := ts.issue(3, "export", time.Minute, now)
		var wins atomic.Int32
		var wg sync.WaitGroup
		for i := 0; i < 8; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				if _, ok := ts.consume(tok, "export", now); ok {
					wins.Add(1)
				}
			}()
		}
		wg.Wait()
		if wins.Load() != 1 {
			t.Fatalf("round %d: %d winners", round, wins.Load())
		}
	}
}
