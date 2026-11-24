package grammar

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"
)

// Lesson progress (migration 045, docs/contracts/grammar/): one row per lesson
// of a workspace of a user, the best score of a finished run and the run's
// number of exercises. The lesson stays in its pack; progress of a pack that
// is gone is kept (a reinstall shows it again).

// MaxExercises caps a run's number of exercises.
const MaxExercises = 1000

var packIDPattern = regexp.MustCompile(`^[A-Za-z0-9._-]{1,128}$`)

// InvalidError is a run the contract refuses; its message is safe to show.
type InvalidError struct{ Msg string }

func (e *InvalidError) Error() string { return e.Msg }

// Progress is the stored progress of one lesson.
type Progress struct {
	PackID      string `json:"packId"`
	LessonID    string `json:"lessonId"`
	CompletedAt string `json:"completedAt"`
	Best        int    `json:"best"`
	Total       int    `json:"total"`
}

// ProgressTables are the tables of this file with a workspace_id.
func ProgressTables() []string { return []string{"grammar_progress"} }

// Querier is what the progress functions need of a database or a transaction.
type Querier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// ListProgress returns the workspace's lesson progress by pack and lesson.
func ListProgress(ctx context.Context, q Querier, userID, workspaceID int64) ([]Progress, error) {
	rows, err := q.QueryContext(ctx, `SELECT pack_id, lesson_id, completed_at, best, total FROM grammar_progress
		WHERE user_id = ? AND workspace_id = ? ORDER BY pack_id, lesson_id`, userID, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("grammar: list progress: %w", err)
	}
	defer rows.Close()
	out := []Progress{}
	for rows.Next() {
		var p Progress
		if err := rows.Scan(&p.PackID, &p.LessonID, &p.CompletedAt, &p.Best, &p.Total); err != nil {
			return nil, fmt.Errorf("grammar: scan progress: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// RecordRun stores a finished run of a lesson and answers the stored
// progress, in one statement: the best score is kept unless the lesson now
// has another number of exercises (a re-import, a script conversion that
// dropped a cloze), whose scores are not comparable: then the run starts
// over. An invalid run is an InvalidError.
func RecordRun(ctx context.Context, q Querier, userID, workspaceID int64, packID, lessonID string, score, total int) (Progress, error) {
	return record(ctx, q, userID, workspaceID, packID, lessonID, score, total, time.Now().UTC().Format(time.RFC3339))
}

func record(ctx context.Context, q Querier, userID, workspaceID int64, packID, lessonID string, score, total int, completedAt string) (Progress, error) {
	switch {
	case !packIDPattern.MatchString(packID):
		return Progress{}, &InvalidError{Msg: "packId must be 1 to 128 letters, digits, '.', '-' or '_'."}
	case len(lessonID) > 128 || !idPattern.MatchString(lessonID):
		return Progress{}, &InvalidError{Msg: "lessonId must be a lesson id (lowercase letters and digits, joined by '-')."}
	case total < 0 || total > MaxExercises || score < 0 || score > total:
		return Progress{}, &InvalidError{Msg: fmt.Sprintf("score and total must be whole numbers with 0 <= score <= total <= %d.", MaxExercises)}
	}
	var p Progress
	err := q.QueryRowContext(ctx, `
		INSERT INTO grammar_progress (user_id, workspace_id, pack_id, lesson_id, completed_at, best, total, updated_at)
		VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
		ON CONFLICT (user_id, workspace_id, pack_id, lesson_id) DO UPDATE SET
			best = CASE WHEN grammar_progress.total = excluded.total THEN max(grammar_progress.best, excluded.best) ELSE excluded.best END,
			total = excluded.total, completed_at = excluded.completed_at, updated_at = excluded.updated_at
		RETURNING pack_id, lesson_id, completed_at, best, total`,
		userID, workspaceID, packID, lessonID, completedAt, score, total, time.Now().UTC().Format(time.RFC3339)).
		Scan(&p.PackID, &p.LessonID, &p.CompletedAt, &p.Best, &p.Total)
	if err != nil {
		return Progress{}, fmt.Errorf("grammar: record run: %w", err)
	}
	return p, nil
}

// The keyed form of the progress in a personal backup: grammar:progress:<packId>:<lessonId>
// with {completedAt, best, total} (docs/contracts/backup/README.md).
const KeyPrefix = "grammar:progress:"

// IsKeyed reports whether a backup row key is a lesson's progress.
func IsKeyed(key string) bool { return strings.HasPrefix(key, KeyPrefix) }

// KeyedOf is the keyed form of one lesson's progress.
func KeyedOf(p Progress) (string, json.RawMessage) {
	b, _ := json.Marshal(struct {
		CompletedAt string `json:"completedAt"`
		Best        int    `json:"best"`
		Total       int    `json:"total"`
	}{p.CompletedAt, p.Best, p.Total})
	return KeyPrefix + p.PackID + ":" + p.LessonID, b
}

// RestoreKeyed writes one lesson's progress of the keyed form into workspace
// ws; ok is false for a row that does not decode or that the contract refuses.
func RestoreKeyed(ctx context.Context, q Querier, userID, ws int64, key string, data json.RawMessage) (ok bool, err error) {
	rest := strings.TrimPrefix(key, KeyPrefix)
	i := strings.LastIndex(rest, ":")
	if !IsKeyed(key) || i < 1 {
		return false, nil
	}
	var v struct {
		CompletedAt *string `json:"completedAt"`
		Best        *int    `json:"best"`
		Total       *int    `json:"total"`
	}
	if json.Unmarshal(data, &v) != nil || v.CompletedAt == nil || v.Best == nil || v.Total == nil {
		return false, nil
	}
	if _, err := time.Parse(time.RFC3339Nano, *v.CompletedAt); err != nil {
		return false, nil
	}
	if _, err := record(ctx, q, userID, ws, rest[:i], rest[i+1:], *v.Best, *v.Total, *v.CompletedAt); err != nil {
		if _, refused := err.(*InvalidError); refused {
			return false, nil
		}
		return false, err
	}
	return true, nil
}
