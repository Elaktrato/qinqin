package ai

import (
	"context"
	"database/sql"
	"errors"
	"sync"
	"time"
)

// RateLimitedError is returned when the user used up the hourly calls.
type RateLimitedError struct{ RetryAfter time.Duration }

func (e *RateLimitedError) Error() string { return "ai: hourly call limit reached" }

// ErrInFlight means the user already has a provider call running.
var ErrInFlight = errors.New("ai: a call is already running")

// Call is one provider call to record.
type Call struct {
	UserID      int64
	Kind, Model string
	OK          bool
	Usage       Usage
}

// Limiter allows PerHour calls per user in a rolling hour (counted from the
// ai_calls table, so the count survives restarts) and one call in flight.
type Limiter struct {
	DB      *sql.DB
	PerHour int
	Now     func() time.Time

	mu       sync.Mutex
	inflight map[int64]bool
}

func (l *Limiter) now() time.Time {
	if l.Now != nil {
		return l.Now().UTC()
	}
	return time.Now().UTC()
}

// Acquire reserves the user's single slot after checking the hourly count.
// Call release when the provider call is over (it is idempotent) and Record
// the call. The mutex covers count, check and set, so they cannot interleave.
func (l *Limiter) Acquire(ctx context.Context, userID int64) (release func(), err error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.inflight[userID] {
		return nil, ErrInFlight
	}
	now := l.now()
	cutoff := stamp(now.Add(-time.Hour))
	var n int
	var oldest sql.NullString
	if err := l.DB.QueryRowContext(ctx, `SELECT COUNT(*), MIN(at) FROM ai_calls WHERE user_id = ? AND at > ?`, userID, cutoff).Scan(&n, &oldest); err != nil {
		return nil, err
	}
	if n >= l.PerHour {
		wait := time.Minute
		if t, err := time.Parse(time.RFC3339, oldest.String); err == nil {
			wait = t.Add(time.Hour).Sub(now)
		}
		return nil, &RateLimitedError{RetryAfter: wait}
	}
	if l.inflight == nil {
		l.inflight = map[int64]bool{}
	}
	l.inflight[userID] = true
	var once sync.Once
	return func() {
		once.Do(func() {
			l.mu.Lock()
			delete(l.inflight, userID)
			l.mu.Unlock()
		})
	}, nil
}

// Record logs a finished call; it counts toward the limit, failures too.
func (l *Limiter) Record(ctx context.Context, c Call) error {
	ok := 0
	if c.OK {
		ok = 1
	}
	_, err := l.DB.ExecContext(ctx, `INSERT INTO ai_calls (user_id, kind, model, ok, input_tokens, output_tokens, at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`, c.UserID, c.Kind, c.Model, ok, c.Usage.InputTokens, c.Usage.OutputTokens, stamp(l.now()))
	return err
}

// CallsLastHour counts the user's calls in the rolling hour and their tokens.
func (l *Limiter) CallsLastHour(ctx context.Context, userID int64) (int, Usage, error) {
	var n int
	var u Usage
	err := l.DB.QueryRowContext(ctx, `SELECT COUNT(*), COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0)
		FROM ai_calls WHERE user_id = ? AND at > ?`, userID, stamp(l.now().Add(-time.Hour))).Scan(&n, &u.InputTokens, &u.OutputTokens)
	return n, u, err
}

// Prune deletes call rows older than the given age.
func (l *Limiter) Prune(ctx context.Context, olderThan time.Duration) error {
	_, err := l.DB.ExecContext(ctx, `DELETE FROM ai_calls WHERE at < ?`, stamp(l.now().Add(-olderThan)))
	return err
}
