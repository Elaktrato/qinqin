package study

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"qinqin/internal/study/rows"
)

// Leftovers: qinqin-flashcards plugin_data rows of a typed family that a
// migrated server still holds (migration 038 could not read them, or an old
// binary wrote them; AdoptLeftovers takes over the readable ones at start).
// No client reads them as plugin data (#198); a backup export carries the
// readable ones as keyed rows, which a restore decodes into typed rows.

// LegacyKeySQL is a SQL condition on a plugin_data key column named key
// that holds exactly for the keys rows.FamilyOf assigns to a typed family
// (GLOB is case-sensitive, like FamilyOf). Callers add pack_id = Namespace.
const LegacyKeySQL = `(key GLOB 'card:*' OR key GLOB 'deck:*' OR key GLOB 'deckcfg:*' OR key = 'limits:workspace' ` +
	`OR key GLOB 'limits:deck:*' OR key GLOB 'fsrs:set:*' OR key = 'fsrs:active')`

// ReadableLeftover reports whether a qinqin-flashcards plugin row of a typed
// family still carries a study row a client can read: it has a workspace of
// the user, the codec reads it, and no typed row holds its key. The
// migration moved every such row, so after it only a write through the
// plugin store or a restore of an older server could leave one; a backup
// export carries those and drops every other leftover.
func ReadableLeftover(ctx context.Context, q Querier, userID int64, workspaceID *int64, key string, data json.RawMessage) (bool, error) {
	if workspaceID == nil {
		return false, nil
	}
	var owner int64
	err := q.QueryRowContext(ctx, `SELECT user_id FROM workspaces WHERE id = ?`, *workspaceID).Scan(&owner)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && owner != userID) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("study: workspace of %s: %w", key, err)
	}
	r, err := rows.FromLegacy(key, data)
	if err != nil {
		return false, nil
	}
	r.M().WorkspaceID = *workspaceID
	if rows.Validate(r) != nil {
		return false, nil
	}
	held, err := HasTypedRow(ctx, q, userID, *workspaceID, key)
	return !held, err
}

// HasTypedRow reports whether a typed row (live or tombstoned) holds the
// legacy key in the workspace; such a key shadows a leftover plugin row.
func HasTypedRow(ctx context.Context, q Querier, userID, workspaceID int64, key string) (bool, error) {
	f, id, ok := rows.KeyIdentity(key)
	if !ok {
		return false, nil
	}
	_, exists, err := Load(ctx, q, userID, workspaceID, f, id)
	return exists, err
}
