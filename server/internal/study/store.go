package study

import (
	"context"
	"fmt"
	"strings"
	"time"

	"qinqin/internal/study/rows"
)

// now is the store clock (tests swap it).
var now = time.Now

// Now is the store clock in UTC: the edit time of a write made on this
// server (the legacy plugin-data routes).
func Now() time.Time { return now().UTC() }

// Delta is the typed study rows of one pull; every slice is non-nil.
type Delta struct {
	Cards        []rows.Card
	Decks        []rows.Deck
	DeckSettings []rows.DeckSettingsRow
	Limits       []rows.LimitsRow
	FsrsSets     []rows.FsrsSet
	FsrsActive   []rows.FsrsActiveRow
}

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

// PullRows returns the user's rows of family f written at or after since
// (inclusive second), tombstones included — except from the zero time,
// where only live rows ship.
func PullRows(ctx context.Context, q Querier, userID int64, f rows.Family, since time.Time) ([]rows.Row, error) {
	t, ok := tables[f]
	if !ok {
		return nil, fmt.Errorf("study: unknown family %q", f)
	}
	query := `SELECT ` + selectCols(f) + ` FROM ` + t.name + ` WHERE user_id = ? AND updated_at >= ?`
	if since.IsZero() {
		query += ` AND deleted_at IS NULL`
	}
	rs, err := q.QueryContext(ctx, query+` ORDER BY `+orderBy(f), userID, since.UTC().Format(time.RFC3339))
	if err != nil {
		return nil, fmt.Errorf("study: pull %s: %w", f, err)
	}
	defer rs.Close()
	out := []rows.Row{}
	for rs.Next() {
		r, err := scanRow(f, rs)
		if err != nil {
			return nil, fmt.Errorf("study: pull %s: %w", f, err)
		}
		out = append(out, r)
	}
	if err := rs.Err(); err != nil {
		return nil, fmt.Errorf("study: pull %s: %w", f, err)
	}
	return out, nil
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

// Pull returns the families in only (nil: all) changed since since, as
// PullRows. Every slice of the result is non-nil.
func Pull(ctx context.Context, q Querier, userID int64, since time.Time, only map[rows.Family]bool) (Delta, error) {
	d := Delta{Cards: []rows.Card{}, Decks: []rows.Deck{}, DeckSettings: []rows.DeckSettingsRow{},
		Limits: []rows.LimitsRow{}, FsrsSets: []rows.FsrsSet{}, FsrsActive: []rows.FsrsActiveRow{}}
	for _, f := range rows.Families {
		if only != nil && !only[f] {
			continue
		}
		list, err := PullRows(ctx, q, userID, f, since)
		if err != nil {
			return Delta{}, err
		}
		for _, r := range list {
			switch x := r.(type) {
			case *rows.Card:
				d.Cards = append(d.Cards, *x)
			case *rows.Deck:
				d.Decks = append(d.Decks, *x)
			case *rows.DeckSettingsRow:
				d.DeckSettings = append(d.DeckSettings, *x)
			case *rows.LimitsRow:
				d.Limits = append(d.Limits, *x)
			case *rows.FsrsSet:
				d.FsrsSets = append(d.FsrsSets, *x)
			case *rows.FsrsActiveRow:
				d.FsrsActive = append(d.FsrsActive, *x)
			}
		}
	}
	return d, nil
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
		if err != nil {
			return nil, fmt.Errorf("study: list cards: %w", err)
		}
		out = append(out, *r.(*rows.Card))
	}
	return out, rs.Err()
}
