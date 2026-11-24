// Package features holds the core features and each user's feature switches
// (#199, record 0006): flashcards, the reader, the journal and grammar are the
// app, not plugins; a user can switch each off for themselves. Switching off
// only hides the feature in the client: the server keeps accepting and
// counting its data and events. Contract: docs/contracts/features/.
package features

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"time"
)

// IDs are the core features, in the order of the navigation.
var IDs = []string{"flashcards", "reader", "journal", "grammar"}

// ErrUnknown reports an id that names no feature.
var ErrUnknown = errors.New("features: unknown feature")

// Switch is one user's switch of one feature; UpdatedAt is nil while the
// user never set it (the default: on).
type Switch struct {
	ID        string     `json:"id"`
	Enabled   bool       `json:"enabled"`
	UpdatedAt *time.Time `json:"updatedAt"`
}

// Querier is what the reads need of a database or a transaction.
type Querier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// List returns the user's switch of every feature, in IDs order.
func List(ctx context.Context, q Querier, userID int64) ([]Switch, error) {
	rows, err := q.QueryContext(ctx, `SELECT feature, enabled, updated_at FROM feature_switches WHERE user_id = ?`, userID)
	if err != nil {
		return nil, fmt.Errorf("features: list: %w", err)
	}
	defer rows.Close()
	stored := map[string]Switch{}
	for rows.Next() {
		var (
			s       Switch
			enabled int
			at      string
		)
		if err := rows.Scan(&s.ID, &enabled, &at); err != nil {
			return nil, fmt.Errorf("features: scan: %w", err)
		}
		s.Enabled = enabled != 0
		if t, err := time.Parse(time.RFC3339, at); err == nil {
			s.UpdatedAt = &t
		}
		stored[s.ID] = s
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]Switch, 0, len(IDs))
	for _, id := range IDs {
		if s, ok := stored[id]; ok {
			out = append(out, s)
		} else {
			out = append(out, Switch{ID: id, Enabled: true})
		}
	}
	return out, nil
}

// Set stores the user's switch of one feature and answers it as stored.
func Set(ctx context.Context, q Querier, userID int64, id string, enabled bool) (Switch, error) {
	if !slices.Contains(IDs, id) {
		return Switch{}, ErrUnknown
	}
	on := 0
	if enabled {
		on = 1
	}
	var at string
	if err := q.QueryRowContext(ctx, `
		INSERT INTO feature_switches (user_id, feature, enabled, updated_at) VALUES (?, ?, ?, ?)
		ON CONFLICT (user_id, feature) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at
		RETURNING updated_at`, userID, id, on, time.Now().UTC().Format(time.RFC3339)).Scan(&at); err != nil {
		return Switch{}, fmt.Errorf("features: set %s: %w", id, err)
	}
	t, err := time.Parse(time.RFC3339, at)
	if err != nil {
		return Switch{}, err
	}
	return Switch{ID: id, Enabled: enabled, UpdatedAt: &t}, nil
}
