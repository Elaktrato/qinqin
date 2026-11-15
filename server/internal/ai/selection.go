package ai

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// ErrNoSelection means the user has not chosen an active provider.
var ErrNoSelection = errors.New("ai: no provider selected")

// Selection stores which provider each user sends text to.
type Selection struct {
	DB  *sql.DB
	Now func() time.Time
}

func (s *Selection) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}

// Active returns the user's active provider id, or ErrNoSelection.
func (s *Selection) Active(ctx context.Context, userID int64) (string, error) {
	var p string
	err := s.DB.QueryRowContext(ctx, `SELECT provider FROM ai_selection WHERE user_id = ?`, userID).Scan(&p)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNoSelection
	}
	return p, err
}

// SetActive makes provider the user's active one; the user must hold a key
// for it (any state), else ErrNoKey.
func (s *Selection) SetActive(ctx context.Context, userID int64, provider string) error {
	res, err := s.DB.ExecContext(ctx, `INSERT INTO ai_selection (user_id, provider, updated_at)
		SELECT user_id, provider, ? FROM ai_keys WHERE user_id = ? AND provider = ?
		ON CONFLICT(user_id) DO UPDATE SET provider = excluded.provider, updated_at = excluded.updated_at`,
		stamp(s.now()), userID, provider)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNoKey
	}
	return nil
}

// Clear removes the user's selection; clearing nothing is fine.
func (s *Selection) Clear(ctx context.Context, userID int64) error {
	_, err := s.DB.ExecContext(ctx, `DELETE FROM ai_selection WHERE user_id = ?`, userID)
	return err
}

// ClearProvider removes every selection that points at provider.
func (s *Selection) ClearProvider(ctx context.Context, provider string) error {
	_, err := s.DB.ExecContext(ctx, `DELETE FROM ai_selection WHERE provider = ?`, provider)
	return err
}
