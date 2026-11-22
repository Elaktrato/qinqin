// Package stats aggregates the study-event log into the numbers the
// home heatmap shows, in SQL, driven by the activity rules plugins
// declare in their manifests.
package stats

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"qinqin/internal/events"
	"qinqin/internal/plugins"
	"qinqin/internal/studyday"
)

// tsLayout is the stored event instant format (study_events.ts); window
// bounds use exactly it so text comparison stays chronological.
const tsLayout = "2006-01-02T15:04:05Z"

// Cell is the activity of one rule in one learner day and workspace.
type Cell struct {
	Day       string  `json:"day"`
	Workspace int64   `json:"workspace"`
	Type      string  `json:"type"`
	Points    int64   `json:"points"`
	Raw       float64 `json:"raw"`
}

// Activity returns the non-zero cells of the user's events for the
// given rules, bucketed by the learner's day: windows come from
// studyday.History.Windows (ascending, contiguous; an empty window, a
// skipped date, has no events and no cell). A non-nil workspace
// restricts the cells to that workspace. The result is sorted by day,
// workspace, type and is never nil.
func Activity(ctx context.Context, sqlDB *sql.DB, userID int64, windows []studyday.Window, workspace *int64, rules []plugins.RuleOf) ([]Cell, error) {
	cells := []Cell{}
	type jsonWindow struct {
		D  string `json:"d"`
		Lo string `json:"lo"`
		Hi string `json:"hi"`
	}
	var list []jsonWindow
	var first, last time.Time
	for _, w := range windows {
		if !w.Start.Before(w.End) {
			continue
		}
		if len(list) == 0 {
			first = w.Start
		}
		last = w.End
		list = append(list, jsonWindow{w.Day.String(), w.Start.UTC().Format(tsLayout), w.End.UTC().Format(tsLayout)})
	}
	if len(list) == 0 {
		return cells, nil
	}
	encoded, err := json.Marshal(list)
	if err != nil {
		return nil, fmt.Errorf("stats: encode windows: %w", err)
	}
	fromS, toS := first.UTC().Format(tsLayout), last.UTC().Format(tsLayout)
	for _, r := range rules {
		query := ruleQuery(r.Rule, workspace != nil)
		args := ruleArgs(r.Rule, userID, r.Type, fromS, toS, workspace, string(encoded))
		if r.Type == reviewType {
			voided, err := replacedReviews(ctx, sqlDB, userID, fromS, toS)
			if err != nil {
				return nil, err
			}
			query = withoutReplaced(query)
			args = append(args, voided)
		}
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
// ?1 user, ?2 type, ?3 from, ?4 to (exclusive; the first window's start
// and the last one's end; not referenced by the statements, see below),
// ?5 workspace, ?6 payload field, ?7 min, ?8
// max, ?9 pointsPer, ?10 the day windows as JSON [{"d","lo","hi"}].
// Field names come from validated rules and are bound, never
// concatenated into SQL.
//
// CROSS JOIN fixes json_each (the windows) as the outer loop and
// study_events as the inner one, searched once per window on the type
// index with ts >= lo AND ts < hi. INDEXED BY pins that index (renaming
// or dropping idx_study_events_user_type_ts in a migration needs a
// matching change here, or every activity query fails with "no such
// index"): with a workspace filter the planner otherwise prefers
// idx_study_events_workspace_ts (which ignores the type) on a table it
// has no statistics for. The overall bounds ?3/?4 are deliberately not
// in the WHERE clause: with them the planner takes the whole range as
// the index constraint and filters every window against it (91 days
// cost 8 s on 400k events); without them each window is its own index
// range. The study_events columns are qualified where
// json_each has a column of the same name (type).
const window = `FROM json_each(?10) AS w CROSS JOIN study_events INDEXED BY idx_study_events_user_type_ts
	WHERE study_events.user_id = ?1 AND study_events.type = ?2
	AND ts >= w.value->>'lo' AND ts < w.value->>'hi'`

// ruleQuery returns the SQL that scores one rule, grouped by learner day
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
					SELECT w.value->>'d' AS d, workspace_id AS ws,
						CASE WHEN json_valid(payload) THEN
							CASE WHEN json_type(payload, '$.' || ?6) IN ('integer', 'real')
							THEN json_extract(payload, '$.' || ?6) END
						END AS v ` + where + `
				) WHERE v >= ?7
			)
		) GROUP BY d, ws`
	case plugins.KindDistinct:
		return `SELECT d, ws, COUNT(DISTINCT v), COUNT(DISTINCT v) FROM (
			SELECT w.value->>'d' AS d, workspace_id AS ws,
				CASE WHEN json_valid(payload) THEN
					CASE WHEN json_type(payload, '$.' || ?6) = 'text'
					THEN json_extract(payload, '$.' || ?6) END
				END AS v ` + where + `
		) GROUP BY d, ws`
	default:
		return `SELECT d, ws, COUNT(*), COUNT(*) FROM (
			SELECT w.value->>'d' AS d, workspace_id AS ws ` + where + `
		) GROUP BY d, ws`
	}
}

// ruleArgs returns the ten positional arguments every statement refers
// to (SQLite counts up to the highest ?N used, and ?10 is always used);
// slots a rule does not need stay nil.
func ruleArgs(rule plugins.ActivityRule, userID int64, typ, from, to string, workspace *int64, windows string) []any {
	var ws any
	if workspace != nil {
		ws = *workspace
	}
	args := []any{userID, typ, from, to, ws, nil, nil, nil, nil, windows}
	switch rule.Kind() {
	case plugins.KindMeasure:
		args[5], args[6], args[7], args[8] = rule.Measure.Field, rule.Measure.Min, rule.Measure.Max, rule.PointsPer
	case plugins.KindDistinct:
		args[5] = rule.DistinctBy
	}
	return args
}

// reviewType is the core review event: a changed grade (#131) replaces an
// earlier review, which then scores nothing (events.Replaced).
const reviewType = "review"

// withoutReplaced narrows a rule statement to events not listed in ?11
// (a JSON array of ids).
func withoutReplaced(query string) string {
	return strings.Replace(query, window, window+` AND study_events.id NOT IN (SELECT value FROM json_each(?11))`, 1)
}

// replacedReviews returns, as a JSON array, the ids of the user's reviews
// in [from, to) that a changed grade replaced (docs/contracts/events/
// review-replace.json). A link needs the same second, so a family never
// leaves the window: the replacements in it are read first, then their
// targets by id, always of this user only.
func replacedReviews(ctx context.Context, sqlDB *sql.DB, userID int64, from, to string) (string, error) {
	scan := func(rows *sql.Rows, list []events.Review) ([]events.Review, error) {
		defer rows.Close()
		for rows.Next() {
			var r events.Review
			var payload string
			if err := rows.Scan(&r.ID, &r.WorkspaceID, &r.TS, &payload); err != nil {
				return nil, err
			}
			r.Type, r.Payload = reviewType, json.RawMessage(payload)
			list = append(list, r)
		}
		return list, rows.Err()
	}
	rows, err := sqlDB.QueryContext(ctx, `SELECT id, workspace_id, ts, payload FROM study_events INDEXED BY idx_study_events_user_type_ts
		WHERE user_id = ? AND type = 'review' AND ts >= ? AND ts < ?
		AND json_valid(payload) AND json_type(payload, '$.replaces') = 'text'`, userID, from, to)
	if err != nil {
		return "", fmt.Errorf("stats: replaced reviews: %w", err)
	}
	list, err := scan(rows, nil)
	if err != nil {
		return "", fmt.Errorf("stats: replaced reviews: %w", err)
	}
	if len(list) == 0 {
		return "[]", nil
	}
	targets := []string{}
	for _, r := range list {
		var p struct {
			Replaces string `json:"replaces"`
		}
		if json.Unmarshal(r.Payload, &p) == nil && p.Replaces != "" {
			targets = append(targets, p.Replaces)
		}
	}
	ids, _ := json.Marshal(targets)
	rows, err = sqlDB.QueryContext(ctx, `SELECT id, workspace_id, ts, payload FROM study_events
		WHERE user_id = ? AND type = 'review' AND id IN (SELECT value FROM json_each(?))`, userID, string(ids))
	if err != nil {
		return "", fmt.Errorf("stats: replaced review targets: %w", err)
	}
	if list, err = scan(rows, list); err != nil {
		return "", fmt.Errorf("stats: replaced review targets: %w", err)
	}
	voided := []string{}
	for id := range events.Replaced(list) {
		voided = append(voided, id)
	}
	sort.Strings(voided)
	out, _ := json.Marshal(voided)
	return string(out), nil
}
