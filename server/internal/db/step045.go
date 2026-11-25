package db

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
)

// grammarProgressStep is the Go half of migration 045 (#199): the
// qinqin-grammar rows lesson:<packId>:<lessonId> become grammar_progress
// rows. The rules are a frozen copy of internal/grammar's as of #199 (the
// pack and lesson id patterns, 0 <= best <= total <= 1000), so a personal
// backup of the result restores without loss.
func grammarProgressStep(tx *sql.Tx) error {
	type row struct {
		user, ws         int64
		key, data, stamp string
	}
	rows, err := tx.Query(`SELECT user_id, workspace_id, key, data, updated_at FROM plugin_data
		WHERE pack_id = 'qinqin-grammar' AND deleted_at IS NULL AND workspace_id IS NOT NULL
			AND substr(key, 1, 7) = 'lesson:' ORDER BY rowid`)
	if err != nil {
		return fmt.Errorf("read grammar rows: %w", err)
	}
	var all []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.user, &r.ws, &r.key, &r.data, &r.stamp); err != nil {
			rows.Close()
			return fmt.Errorf("scan grammar row: %w", err)
		}
		all = append(all, r)
	}
	if err := errors.Join(rows.Close(), rows.Err()); err != nil {
		return fmt.Errorf("read grammar rows: %w", err)
	}
	for _, r := range all {
		pack, lesson, ok := strings.Cut(strings.TrimPrefix(r.key, "lesson:"), ":")
		if !ok || !g045Pack.MatchString(pack) || len(lesson) > 128 || !g045Lesson.MatchString(lesson) {
			continue
		}
		var v struct {
			CompletedAt any
			Best, Total *int
		}
		if json.Unmarshal([]byte(r.data), &v) != nil || v.Best == nil || v.Total == nil ||
			*v.Total < 0 || *v.Total > 1000 || *v.Best < 0 || *v.Best > *v.Total {
			continue
		}
		if _, err := tx.Exec(`INSERT OR IGNORE INTO grammar_progress (user_id, workspace_id, pack_id, lesson_id, completed_at, best, total, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, r.user, r.ws, pack, lesson, j044Stamp(v.CompletedAt, r.stamp), *v.Best, *v.Total, r.stamp); err != nil {
			return fmt.Errorf("copy grammar progress: %w", err)
		}
	}
	if _, err := tx.Exec(`DELETE FROM plugin_data WHERE pack_id = 'qinqin-grammar'`); err != nil {
		return fmt.Errorf("delete grammar rows: %w", err)
	}
	return nil
}

var (
	g045Pack   = regexp.MustCompile(`^[A-Za-z0-9._-]{1,128}$`)
	g045Lesson = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)
)
