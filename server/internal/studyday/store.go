package studyday

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// ErrTooManyChanges is returned when a user's history is full.
var ErrTooManyChanges = errors.New("too many time zone changes")

// MaxChanges bounds a user's history (rows, the first zone included).
const MaxChanges = 500

// tsLayout is the stored instant format, the same as study_events.ts.
const tsLayout = "2006-01-02T15:04:05Z"

// Load returns the user's history and its changes in effect order. A
// user with no rows gets UTCHistory() and nil changes.
func Load(ctx context.Context, sqlDB *sql.DB, userID int64) (History, []Change, error) {
	rows, err := sqlDB.QueryContext(ctx,
		`SELECT zone, effective_from FROM user_time_zones WHERE user_id = ? ORDER BY seq`, userID)
	if err != nil {
		return History{}, nil, fmt.Errorf("studyday: load history: %w", err)
	}
	defer rows.Close()
	changes, err := scanChanges(rows)
	if err != nil {
		return History{}, nil, err
	}
	if len(changes) == 0 {
		return UTCHistory(), nil, nil
	}
	h, err := New(changes)
	if err != nil {
		return History{}, nil, fmt.Errorf("studyday: stored history is invalid: %w", err)
	}
	return h, changes, nil
}

func scanChanges(rows *sql.Rows) ([]Change, error) {
	var out []Change
	for rows.Next() {
		var zone string
		var from sql.NullString
		if err := rows.Scan(&zone, &from); err != nil {
			return nil, fmt.Errorf("studyday: scan history: %w", err)
		}
		c := Change{Zone: zone}
		if from.Valid {
			t, err := time.Parse(tsLayout, from.String)
			if err != nil {
				return nil, fmt.Errorf("studyday: stored instant is invalid: %w", err)
			}
			c.From = &t
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("studyday: read history: %w", err)
	}
	return out, nil
}

// Set records a zone for the user and returns the resulting changes.
//
// With no rows any valid zone (UTC too) becomes seq 0 with no From. With
// rows: ifUnset changes nothing (the first-run default of a second
// device never becomes a change), the zone the user already has adds no
// row, otherwise a row takes effect at now (whole seconds), at least one
// second after the previous change. The check and the insert run in one
// BEGIN IMMEDIATE transaction, so concurrent calls get consecutive seqs.
func Set(ctx context.Context, sqlDB *sql.DB, userID int64, zone string, ifUnset bool, now time.Time) ([]Change, error) {
	if !ValidZone(zone) {
		return nil, ErrUnknownZone
	}
	conn, err := sqlDB.Conn(ctx)
	if err != nil {
		return nil, fmt.Errorf("studyday: set zone: %w", err)
	}
	defer conn.Close()
	if _, err := conn.ExecContext(ctx, "BEGIN IMMEDIATE"); err != nil {
		return nil, fmt.Errorf("studyday: set zone: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			_, _ = conn.ExecContext(context.Background(), "ROLLBACK")
		}
	}()

	rows, err := conn.QueryContext(ctx,
		`SELECT zone, effective_from FROM user_time_zones WHERE user_id = ? ORDER BY seq`, userID)
	if err != nil {
		return nil, fmt.Errorf("studyday: set zone: %w", err)
	}
	changes, err := scanChanges(rows)
	rows.Close()
	if err != nil {
		return nil, err
	}

	nowS := now.UTC().Truncate(time.Second)
	var insert Change
	switch {
	case len(changes) == 0:
		insert = Change{Zone: zone}
	case ifUnset || changes[len(changes)-1].Zone == zone:
		return changes, nil
	case len(changes) >= MaxChanges:
		return nil, ErrTooManyChanges
	default:
		from := nowS
		if prev := changes[len(changes)-1].From; prev != nil && !from.After(*prev) {
			from = prev.Add(time.Second)
		}
		insert = Change{Zone: zone, From: &from}
	}
	var fromArg any
	if insert.From != nil {
		fromArg = insert.From.Format(tsLayout)
	}
	if _, err := conn.ExecContext(ctx,
		`INSERT INTO user_time_zones (user_id, seq, zone, effective_from, created_at) VALUES (?, ?, ?, ?, ?)`,
		userID, len(changes), insert.Zone, fromArg, nowS.Format(tsLayout)); err != nil {
		return nil, fmt.Errorf("studyday: set zone: %w", err)
	}
	if _, err := conn.ExecContext(ctx, "COMMIT"); err != nil {
		return nil, fmt.Errorf("studyday: set zone: %w", err)
	}
	committed = true
	return append(changes, insert), nil
}
