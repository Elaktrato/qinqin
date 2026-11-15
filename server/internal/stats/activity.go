// Package stats aggregates the study-event log into the numbers the
// home heatmap shows, in SQL, driven by the activity rules plugins
// declare in their manifests.
package stats

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"time"

	"qinqin/internal/plugins"
)

// Cell is the activity of one rule in one UTC day and workspace.
type Cell struct {
	Day       string  `json:"day"`
	Workspace int64   `json:"workspace"`
	Type      string  `json:"type"`
	Points    int64   `json:"points"`
	Raw       float64 `json:"raw"`
}

// Activity returns the non-zero cells of the user's events for the
// given rules. from and to are UTC dates; the window is [from, to+1
// day). A non-nil workspace restricts the cells to that workspace. The
// result is sorted by day, workspace, type and is never nil.
func Activity(ctx context.Context, sqlDB *sql.DB, userID int64, from, to time.Time, workspace *int64, rules []plugins.RuleOf) ([]Cell, error) {
	fromS := from.UTC().Format(time.RFC3339)
	toS := to.UTC().AddDate(0, 0, 1).Format(time.RFC3339)
	cells := []Cell{}
	for _, r := range rules {
		query := ruleQuery(r.Rule, workspace != nil)
		args := ruleArgs(r.Rule, userID, r.Type, fromS, toS, workspace)
		rows, err := sqlDB.QueryContext(ctx, query, args...)
		if err != nil {
			return nil, fmt.Errorf("stats: activity of %s: %w", r.Type, err)
		}
		for rows.Next() {
			c := Cell{Type: r.Type}
			if err := rows.Scan(&c.Day, &c.Workspace, &c.Points, &c.Raw); err != nil {
				rows.Close()
				return nil, fmt.Errorf("stats: scan activity of %s: %w", r.Type, err)
			}
			if c.Points > 0 {
				cells = append(cells, c)
			}
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, fmt.Errorf("stats: activity of %s: %w", r.Type, err)
		}
	}
	sort.Slice(cells, func(i, j int) bool {
		a, b := cells[i], cells[j]
		if a.Day != b.Day {
			return a.Day < b.Day
		}
		if a.Workspace != b.Workspace {
			return a.Workspace < b.Workspace
		}
		return a.Type < b.Type
	})
	return cells, nil
}

// Parameters are numbered so one statement shape serves every kind:
// ?1 user, ?2 type, ?3 from, ?4 to (exclusive), ?5 workspace, ?6 payload
// field, ?7 min, ?8 max, ?9 pointsPer. Field names come from validated
// rules and are bound, never concatenated into SQL.
//
// INDEXED BY pins the type index: with a workspace filter the planner
// otherwise prefers idx_study_events_workspace_ts (which ignores the
// type) on a table it has no statistics for.
const window = `FROM study_events INDEXED BY idx_study_events_user_type_ts WHERE user_id = ?1 AND type = ?2 AND ts >= ?3 AND ts < ?4`

// ruleQuery returns the SQL that scores one rule, grouped by UTC day
// and workspace, selecting day, workspace, points, raw.
func ruleQuery(rule plugins.ActivityRule, withWorkspace bool) string {
	where := window
	if withWorkspace {
		where += ` AND workspace_id = ?5`
	}
	switch rule.Kind() {
	case plugins.KindMeasure:
		// Real division: integer r / p would truncate (301 s must give 2).
		return `SELECT d, ws, SUM(CAST(q AS INTEGER) + (q > CAST(q AS INTEGER))), SUM(r) FROM (
			SELECT d, ws, r, r * 1.0 / ?9 AS q FROM (
				SELECT d, ws, MIN(v, ?8) AS r FROM (
					SELECT substr(ts, 1, 10) AS d, workspace_id AS ws,
						CASE WHEN json_valid(payload) THEN
							CASE WHEN json_type(payload, '$.' || ?6) IN ('integer', 'real')
							THEN json_extract(payload, '$.' || ?6) END
						END AS v ` + where + `
				) WHERE v >= ?7
			)
		) GROUP BY d, ws`
	case plugins.KindDistinct:
		return `SELECT d, ws, COUNT(DISTINCT v), COUNT(DISTINCT v) FROM (
			SELECT substr(ts, 1, 10) AS d, workspace_id AS ws,
				CASE WHEN json_valid(payload) THEN
					CASE WHEN json_type(payload, '$.' || ?6) = 'text'
					THEN json_extract(payload, '$.' || ?6) END
				END AS v ` + where + `
		) GROUP BY d, ws`
	default:
		return `SELECT substr(ts, 1, 10), workspace_id, COUNT(*), COUNT(*) ` + where +
			` GROUP BY substr(ts, 1, 10), workspace_id`
	}
}

// ruleArgs returns exactly the positional arguments ruleQuery's
// statement refers to (SQLite counts up to the highest ?N used).
func ruleArgs(rule plugins.ActivityRule, userID int64, typ, from, to string, workspace *int64) []any {
	var ws any
	if workspace != nil {
		ws = *workspace
	}
	args := []any{userID, typ, from, to}
	switch rule.Kind() {
	case plugins.KindMeasure:
		return append(args, ws, rule.Measure.Field, rule.Measure.Min, rule.Measure.Max, rule.PointsPer)
	case plugins.KindDistinct:
		return append(args, ws, rule.DistinctBy)
	default:
		if workspace != nil {
			args = append(args, ws)
		}
		return args
	}
}
