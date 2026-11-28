package db

import (
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/oklog/ulid/v2"
)

// grammarEventsStep is the Go half of migration 056 (#277): every
// grammar_progress row becomes one `grammar` study event of its user and
// workspace: {point: "<packId>:<lessonId>", mode: "lesson", score: best,
// total}, at the row's completed_at (whole UTC seconds), or at its
// updated_at when completed_at is no RFC 3339 time, with a fresh ULID of that
// instant; device "migration". A row whose ids, numbers or stamps the rules
// refuse, or whose workspace is not its user's, is dropped and counted. The
// table is dropped afterwards. The rules are a frozen copy of
// docs/contracts/grammar/runs.json (legacy) as of #277.
func grammarEventsStep(tx *sql.Tx) error {
	type row struct {
		user, ws                       int64
		owner                          sql.NullInt64
		pack, lesson, completed, stamp string
		best, total                    int
	}
	rows, err := tx.Query(`SELECT g.user_id, g.workspace_id, w.user_id, g.pack_id, g.lesson_id, g.completed_at, g.best, g.total, g.updated_at
		FROM grammar_progress g LEFT JOIN workspaces w ON w.id = g.workspace_id ORDER BY g.rowid`)
	if err != nil {
		return fmt.Errorf("read grammar progress: %w", err)
	}
	var all []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.user, &r.ws, &r.owner, &r.pack, &r.lesson, &r.completed, &r.best, &r.total, &r.stamp); err != nil {
			rows.Close()
			return fmt.Errorf("scan grammar progress: %w", err)
		}
		all = append(all, r)
	}
	if err := errors.Join(rows.Close(), rows.Err()); err != nil {
		return fmt.Errorf("read grammar progress: %w", err)
	}
	now := time.Now().UTC().Format(time.RFC3339)
	moved, dropped := 0, 0
	for _, r := range all {
		if !r.owner.Valid || r.owner.Int64 != r.user {
			dropped++
			continue
		}
		ts, payload, ok := g056Event(r.pack, r.lesson, r.completed, r.stamp, r.best, r.total)
		if !ok {
			dropped++
			continue
		}
		// A time a ULID cannot carry (before 1970) is a row the rules refuse.
		id, err := ulid.New(ulid.Timestamp(ts), rand.Reader)
		if ts.Before(time.Unix(0, 0)) || err != nil {
			dropped++
			continue
		}
		if _, err := tx.Exec(`INSERT INTO study_events (id, user_id, workspace_id, device, ts, type, payload, updated_at)
			VALUES (?, ?, ?, 'migration', ?, 'grammar', ?, ?)`, id.String(), r.user, r.ws, ts.Format(time.RFC3339), payload, now); err != nil {
			return fmt.Errorf("write grammar event: %w", err)
		}
		moved++
	}
	if _, err := tx.Exec(`DROP TABLE grammar_progress`); err != nil {
		return fmt.Errorf("drop grammar_progress: %w", err)
	}
	if moved+dropped > 0 {
		log.Printf("migration 056: %d grammar lesson progress rows became grammar events, %d unreadable rows were dropped", moved, dropped)
	}
	return nil
}

// g056Event is the frozen conversion of one progress row: the event's time
// and payload text, ok false for a row the rules refuse.
func g056Event(pack, lesson, completed, stamp string, best, total int) (time.Time, string, bool) {
	if !g045Pack.MatchString(pack) || len(lesson) > 128 || !g045Lesson.MatchString(lesson) ||
		total < 0 || total > 1000 || best < 0 || best > total {
		return time.Time{}, "", false
	}
	at, err := time.Parse(time.RFC3339Nano, completed)
	if err != nil {
		if at, err = time.Parse(time.RFC3339Nano, stamp); err != nil {
			return time.Time{}, "", false
		}
	}
	b, _ := json.Marshal(struct {
		Point string `json:"point"`
		Mode  string `json:"mode"`
		Score int    `json:"score"`
		Total int    `json:"total"`
	}{pack + ":" + lesson, "lesson", best, total})
	return at.UTC().Truncate(time.Second), string(b), true
}
