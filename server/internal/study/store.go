package study

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"qinqin/internal/study/rows"
)

// now is the store clock (tests swap it).
var now = time.Now

// EditTime is when a pushed edit was made: its updatedAt, or its deletedAt
// when later (a tombstone may set only deletedAt).
func EditTime(updatedAt time.Time, deletedAt *time.Time) time.Time {
	t := updatedAt
	if deletedAt != nil && deletedAt.After(t) {
		t = *deletedAt
	}
	return t.UTC()
}

// Apply writes r for userID under last-write-wins (the plugin-data rule):
// edited, clamped to the server clock, wins unless the stored edit time
// (modified_at, second precision) is after it. A deletion tombstones a live
// row and keeps its data; deleting an absent or deleted row is skipped. A
// live write whose typed members and extra equal the stored live row is not
// written, whatever its stamp (Unchanged: a retry or the same edit twice). An applied write bumps version and stamps
// updated_at with the server clock; a live write revives a tombstone. The
// caller checks that the workspace is the user's. r is validated first
// (rows.ErrInvalid).
func Apply(ctx context.Context, q Querier, userID int64, r rows.Row, edited time.Time, deleted bool) (bool, error) {
	o, err := ApplyOutcome(ctx, q, userID, r, edited, deleted)
	return o == Applied, err
}

// Outcome is what a write did, for the push counters.
type Outcome int

const (
	// Skipped: not written (a newer stored edit, or a tombstone of an absent
	// or deleted row); counted dataSkipped.
	Skipped Outcome = iota
	// Applied: written (version bumped, updated_at = now); dataAccepted.
	Applied
	// Unchanged: a live write equal to the stored live row, whatever its
	// stamp (a retry, the same edit from another device); nothing written,
	// counted dataAccepted. Contract: docs/contracts/study/lww.json.
	Unchanged
)

func (o Outcome) String() string {
	return [...]string{"skipped", "applied", "unchanged"}[o]
}

// ApplyOutcome is Apply reporting what it did.
func ApplyOutcome(ctx context.Context, q Querier, userID int64, r rows.Row, edited time.Time, deleted bool) (Outcome, error) {
	if err := rows.Validate(r); err != nil {
		return Skipped, err
	}
	nowT := now().UTC()
	edited = edited.UTC()
	if edited.After(nowT) {
		edited = nowT
	}
	f := r.Family()
	ws := r.M().WorkspaceID
	existing, exists, err := Load(ctx, q, userID, ws, f, r.Identity())
	if err != nil {
		return Skipped, err
	}
	if !deleted && exists && existing.M().DeletedAt == nil && rows.Equal(existing, r) {
		return Unchanged, nil
	}
	if exists && existing.M().ModifiedAt.After(edited.Truncate(time.Second)) {
		return Skipped, nil
	}
	t := tables[f]
	stampNow, mod := stamp(nowT), stamp(edited)
	if deleted {
		if !exists || existing.M().DeletedAt != nil {
			return Skipped, nil
		}
		if _, err := q.ExecContext(ctx, `UPDATE `+t.name+` SET deleted_at = ?, updated_at = ?, modified_at = ?, version = version + 1
			WHERE `+identityWhere(f)+` AND deleted_at IS NULL`,
			append([]any{stampNow, stampNow, mod}, identityArgs(f, userID, ws, r.Identity())...)...); err != nil {
			return Skipped, fmt.Errorf("study: delete %s %q: %w", f, r.Identity(), err)
		}
		return Applied, nil
	}
	cols := append([]string{"user_id", "workspace_id"}, t.cols...)
	args := append([]any{userID, ws}, typedValues(r)...)
	args = append(args, extraText(rowExtra(r)), stampNow, mod)
	set := make([]string, 0, len(t.cols)+5)
	for _, c := range t.cols {
		set = append(set, c+" = excluded."+c)
	}
	set = append(set, "extra = excluded.extra", "version = "+t.name+".version + 1", "updated_at = excluded.updated_at",
		"modified_at = excluded.modified_at", "deleted_at = NULL")
	conflict := "user_id, workspace_id"
	if t.identity != "" {
		conflict += ", " + t.identity
	}
	query := `INSERT INTO ` + t.name + ` (` + strings.Join(cols, ", ") + `, extra, version, updated_at, modified_at)
		VALUES (` + strings.TrimSuffix(strings.Repeat("?, ", len(cols)+1), ", ") + `, 1, ?, ?)
		ON CONFLICT (` + conflict + `) DO UPDATE SET ` + strings.Join(set, ", ")
	if _, err := q.ExecContext(ctx, query, args...); err != nil {
		return Skipped, fmt.Errorf("study: write %s %q: %w", f, r.Identity(), err)
	}
	return Applied, nil
}

// orderBy is the stable replay order of a pull: write stamp, workspace, identity.
func orderBy(f rows.Family) string {
	o := "updated_at, workspace_id"
	if id := tables[f].identity; id != "" {
		o += ", " + id
	}
	return o
}

// ForEach streams the user's live rows of family f (every workspace) in
// pull order to fn, without holding them all (the backup export).
func ForEach(ctx context.Context, q Querier, userID int64, f rows.Family, fn func(rows.Row) error) error {
	t, ok := tables[f]
	if !ok {
		return fmt.Errorf("study: unknown family %q", f)
	}
	rs, err := q.QueryContext(ctx, `SELECT `+selectCols(f)+` FROM `+t.name+` WHERE user_id = ? AND deleted_at IS NULL ORDER BY workspace_id, `+orderBy(f), userID)
	if err != nil {
		return fmt.Errorf("study: read %s: %w", f, err)
	}
	defer rs.Close()
	for rs.Next() {
		r, err := scanRow(f, rs)
		if err != nil {
			return fmt.Errorf("study: read %s: %w", f, err)
		}
		if err := fn(r); err != nil {
			return err
		}
	}
	return rs.Err()
}

// Get returns one live row of the user; false when absent or tombstoned.
func Get(ctx context.Context, q Querier, userID, workspaceID int64, f rows.Family, identity string) (rows.Row, bool, error) {
	r, ok, err := Load(ctx, q, userID, workspaceID, f, identity)
	if err != nil || !ok || r.M().DeletedAt != nil {
		return nil, false, err
	}
	return r, true, nil
}

// ListCards returns the user's live cards of one workspace, by id.
func ListCards(ctx context.Context, q Querier, userID, workspaceID int64) ([]rows.Card, error) {
	rs, err := q.QueryContext(ctx, `SELECT `+selectCols(rows.Cards)+` FROM study_cards
		WHERE user_id = ? AND workspace_id = ? AND deleted_at IS NULL ORDER BY id`, userID, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("study: list cards: %w", err)
	}
	defer rs.Close()
	out := []rows.Card{}
	for rs.Next() {
		r, err := scanRow(rows.Cards, rs)
		if errors.Is(err, ErrUnreadableStored) {
			LogUnreadable("study: list cards", err)
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("study: list cards: %w", err)
		}
		out = append(out, *r.(*rows.Card))
	}
	return out, rs.Err()
}
