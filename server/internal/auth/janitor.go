package auth

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// AuditRetention is how long auth_audit rows are kept.
const AuditRetention = 180 * 24 * time.Hour

// ResetRetention is how long spent or expired reset links stay in the table.
const ResetRetention = 7 * 24 * time.Hour

// Prune deletes sessions idle for longer than SessionIdle and audit rows
// older than AuditRetention, long-spent reset links, access tokens expired
// for longer than TokenExpiredKeep and expired challenges, as of now.
func Prune(ctx context.Context, sqlDB *sql.DB, now time.Time) (sessions, audit int64, err error) {
	res, err := sqlDB.ExecContext(ctx, `DELETE FROM sessions WHERE last_used_at <= ?`,
		now.UTC().Add(-SessionIdle).Format(time.RFC3339))
	if err != nil {
		return 0, 0, fmt.Errorf("prune sessions: %w", err)
	}
	sessions, _ = res.RowsAffected()
	res, err = sqlDB.ExecContext(ctx, `DELETE FROM auth_audit WHERE at <= ?`,
		now.UTC().Add(-AuditRetention).Format(time.RFC3339))
	if err != nil {
		return sessions, 0, fmt.Errorf("prune audit: %w", err)
	}
	audit, _ = res.RowsAffected()
	// Spent or expired reset links are kept a week (for the audit trail of a
	// support question), then dropped.
	cutoff := now.UTC().Add(-ResetRetention).Format(time.RFC3339)
	if _, err := sqlDB.ExecContext(ctx, `DELETE FROM password_resets WHERE expires_at <= ?1 OR used_at <= ?1`, cutoff); err != nil {
		return sessions, audit, fmt.Errorf("prune resets: %w", err)
	}
	// Expired access tokens stay listed (as expired) for TokenExpiredKeep.
	if _, err := sqlDB.ExecContext(ctx, `DELETE FROM access_tokens WHERE expires_at <= ?`,
		now.UTC().Add(-TokenExpiredKeep).Format(time.RFC3339)); err != nil {
		return sessions, audit, fmt.Errorf("prune access tokens: %w", err)
	}
	if err := PruneChallenges(ctx, sqlDB, now); err != nil {
		return sessions, audit, err
	}
	return sessions, audit, nil
}

// RunJanitor prunes once at start and then every `every` until ctx ends.
func RunJanitor(ctx context.Context, sqlDB *sql.DB, every time.Duration, logf func(string, ...any)) {
	sweep := func() {
		s, a, err := Prune(ctx, sqlDB, nowFunc())
		switch {
		case err != nil && ctx.Err() == nil:
			logf("auth janitor: %v", err)
		case s > 0 || a > 0:
			logf("auth janitor: removed %d idle sessions, %d old audit rows", s, a)
		}
	}
	sweep()
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			sweep()
		}
	}
}
