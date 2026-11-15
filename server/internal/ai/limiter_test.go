package ai

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type clock struct{ t time.Time }

func (c *clock) now() time.Time { return c.t }

func newLimiter(t *testing.T) (*Limiter, *clock) {
	t.Helper()
	sqlDB, _ := openTestDB(t)
	c := &clock{t: time.Date(2026, 11, 15, 10, 0, 0, 0, time.UTC)}
	return &Limiter{DB: sqlDB, PerHour: 30, Now: c.now}, c
}

func TestLimiterWindow(t *testing.T) {
	l, c := newLimiter(t)
	ctx := context.Background()
	start := c.t
	for i := 0; i < 30; i++ {
		c.t = start.Add(time.Duration(i) * 2 * time.Minute) // 0..58 min
		if err := l.Record(ctx, Call{UserID: 1, Kind: "review", Model: DefaultModel, OK: true}); err != nil {
			t.Fatal(err)
		}
	}
	c.t = start.Add(59 * time.Minute)
	_, err := l.Acquire(ctx, 1)
	var rl *RateLimitedError
	if !errors.As(err, &rl) {
		t.Fatalf("Acquire err = %v, want *RateLimitedError", err)
	}
	if rl.RetryAfter != time.Minute {
		t.Errorf("RetryAfter = %v, want 1m (until the oldest row is 1h old)", rl.RetryAfter)
	}
	if Code(err) != "rate_limited" {
		t.Errorf("code = %q", Code(err))
	}
	// Another user is unaffected.
	if rel, err := l.Acquire(ctx, 2); err != nil {
		t.Errorf("other user: %v", err)
	} else {
		rel()
	}
	c.t = start.Add(time.Hour)
	rel, err := l.Acquire(ctx, 1)
	if err != nil {
		t.Fatalf("after an hour: %v", err)
	}
	rel()
}

func TestLimiterInFlight(t *testing.T) {
	l, _ := newLimiter(t)
	ctx := context.Background()
	rel, err := l.Acquire(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := l.Acquire(ctx, 1); !errors.Is(err, ErrInFlight) {
		t.Errorf("second Acquire = %v, want ErrInFlight", err)
	}
	if Code(ErrInFlight) != "in_flight" {
		t.Error("in_flight code")
	}
	rel()
	rel() // idempotent
	rel2, err := l.Acquire(ctx, 1)
	if err != nil {
		t.Fatalf("after release: %v", err)
	}
	rel2()
}

func TestLimiterConcurrentAcquire(t *testing.T) {
	l, _ := newLimiter(t)
	var wg sync.WaitGroup
	var won, inflight atomic.Int32
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := l.Acquire(context.Background(), 1)
			switch {
			case err == nil:
				won.Add(1)
			case errors.Is(err, ErrInFlight):
				inflight.Add(1)
			default:
				t.Errorf("unexpected: %v", err)
			}
		}()
	}
	wg.Wait()
	if won.Load() != 1 || inflight.Load() != 49 {
		t.Errorf("won %d, in flight %d, want 1 and 49", won.Load(), inflight.Load())
	}
}

func TestLimiterConcurrentRespectsLimit(t *testing.T) {
	l, _ := newLimiter(t)
	l.PerHour = 3
	ctx := context.Background()
	for i := 0; i < 3; i++ {
		if err := l.Record(ctx, Call{UserID: 1, Kind: "review", Model: DefaultModel, OK: true}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := l.Acquire(ctx, 1); Code(err) != "rate_limited" {
		t.Errorf("err = %v, want rate_limited", err)
	}
}

func TestLimiterCallsLastHourAndPrune(t *testing.T) {
	l, c := newLimiter(t)
	ctx := context.Background()
	base := c.t
	c.t = base.Add(-8 * 24 * time.Hour)
	_ = l.Record(ctx, Call{UserID: 1, Kind: "review", Model: DefaultModel, OK: true, Usage: Usage{InputTokens: 100, OutputTokens: 10}})
	c.t = base.Add(-2 * time.Hour)
	_ = l.Record(ctx, Call{UserID: 1, Kind: "review", Model: DefaultModel, OK: true, Usage: Usage{InputTokens: 7}})
	c.t = base
	_ = l.Record(ctx, Call{UserID: 1, Kind: "suggest", Model: DefaultModel, OK: false, Usage: Usage{InputTokens: 5, OutputTokens: 3}})
	_ = l.Record(ctx, Call{UserID: 2, Kind: "suggest", Model: DefaultModel, OK: true})

	n, u, err := l.CallsLastHour(ctx, 1)
	if err != nil || n != 1 || u.InputTokens != 5 || u.OutputTokens != 3 {
		t.Errorf("CallsLastHour = %d %+v %v", n, u, err)
	}
	if err := l.Prune(ctx, 7*24*time.Hour); err != nil {
		t.Fatal(err)
	}
	var rows int
	if err := l.DB.QueryRow(`SELECT COUNT(*) FROM ai_calls`).Scan(&rows); err != nil || rows != 3 {
		t.Errorf("rows after prune = %d (%v), want 3", rows, err)
	}
}
