package entries

import (
	"context"
	"fmt"
	"time"

	"qinqin/internal/model"
)

// ChangedSince returns every entry written at or after since — soft-deleted
// ones included, with DeletedAt set — each with its readings and attrs,
// in id order. It is the entries half of the sync pull: readings and
// attrs only change through Upsert, which stamps the entry, so the
// entry's updated_at covers its children.
func (s Store) ChangedSince(ctx context.Context, since time.Time) ([]model.Entry, error) {
	list, err := s.listEntries(ctx, entrySelect+`
		WHERE e.updated_at >= ?
		ORDER BY e.id`, since.UTC().Format(time.RFC3339))
	if err != nil {
		return nil, fmt.Errorf("entries changed since %s: %w", since.UTC().Format(time.RFC3339), err)
	}
	return list, nil
}
