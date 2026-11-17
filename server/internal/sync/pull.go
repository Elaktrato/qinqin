package sync

import (
	"database/sql"
	"fmt"
	"time"
)

// parseTS parses a stored RFC 3339 timestamp.
func parseTS(s string) (time.Time, error) {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return time.Time{}, fmt.Errorf("sync: parse timestamp %q: %w", s, err)
	}
	return t, nil
}

// parseDeleted parses an optional stored deleted_at.
func parseDeleted(s sql.NullString) (*time.Time, error) {
	if !s.Valid {
		return nil, nil
	}
	t, err := parseTS(s.String)
	if err != nil {
		return nil, err
	}
	return &t, nil
}
