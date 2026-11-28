package images

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"

	"qinqin/internal/pack"
)

// ReportReasons are the reasons a learner gives for a wrong picture (#274).
var ReportReasons = []string{"wrong", "unclear", "offensive", "other"}

// MaxReportsPerUser bounds the stored reports of one user: the oldest goes
// first. A variable so a test can lower it.
var MaxReportsPerUser = 500

// Errors of the report store.
var (
	ErrBadReason      = errors.New("images: unknown report reason")
	ErrNoSuchPicture  = errors.New("images: no such picture")
	errReportArgument = errors.New("images: report needs a pack and a concept")
)

// Key names one picture of one pack.
type Key struct{ PackID, Concept string }

// ReportedPicture is one picture a user reported for an entry.
type ReportedPicture struct {
	EntryID int64
	PackID  string
	Concept string
}

// Report stores the user's report of the picture (packID, concept) shown for
// entryID, and drops their oldest reports beyond MaxReportsPerUser. The
// picture must be one of a live pack (ErrNoSuchPicture); the reason one of
// ReportReasons (ErrBadReason).
func Report(ctx context.Context, sqlDB *sql.DB, userID, entryID int64, packID, concept, reason string) error {
	if !slices.Contains(ReportReasons, reason) {
		return ErrBadReason
	}
	if packID == "" || concept == "" {
		return errReportArgument
	}
	tx, err := pack.BeginWrite(ctx, sqlDB)
	if err != nil {
		return fmt.Errorf("images: report: %w", err)
	}
	defer tx.Rollback()
	var one int
	err = tx.QueryRowContext(ctx, `SELECT 1 FROM image_pictures s JOIN image_packs p ON p.pack_id = s.pack_id
		WHERE s.pack_id = ? AND s.concept = ? AND p.deleted_at IS NULL`, packID, concept).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNoSuchPicture
	}
	if err != nil {
		return fmt.Errorf("images: report: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO picture_reports (user_id, entry_id, language, pack_id, concept, reason, created_at)
		VALUES (?, ?, COALESCE((SELECT language FROM entries WHERE id = ?), ''), ?, ?, ?, ?)`,
		userID, entryID, entryID, packID, concept, reason, pack.Now()); err != nil {
		return fmt.Errorf("images: store report: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM picture_reports WHERE user_id = ?1 AND id NOT IN (
			SELECT id FROM picture_reports WHERE user_id = ?1 ORDER BY id DESC LIMIT ?2)`, userID, MaxReportsPerUser); err != nil {
		return fmt.Errorf("images: prune reports: %w", err)
	}
	return tx.Commit()
}

// Reported lists the pictures the user reported, each (entry, pack,
// concept) once, by entry, pack and concept; never nil.
func Reported(ctx context.Context, q Querier, userID int64) ([]ReportedPicture, error) {
	return reported(ctx, q, `SELECT DISTINCT entry_id, pack_id, concept FROM picture_reports WHERE user_id = ? ORDER BY entry_id, pack_id, concept`, userID)
}

// ReportedOf is the pictures the user reported for one entry.
func ReportedOf(ctx context.Context, q Querier, userID, entryID int64) ([]Key, error) {
	rs, err := reported(ctx, q, `SELECT DISTINCT entry_id, pack_id, concept FROM picture_reports WHERE user_id = ? AND entry_id = ? ORDER BY pack_id, concept`, userID, entryID)
	if err != nil {
		return nil, err
	}
	keys := make([]Key, 0, len(rs))
	for _, r := range rs {
		keys = append(keys, Key{r.PackID, r.Concept})
	}
	return keys, nil
}

func reported(ctx context.Context, q Querier, query string, args ...any) ([]ReportedPicture, error) {
	rows, err := q.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("images: reported: %w", err)
	}
	defer rows.Close()
	out := []ReportedPicture{}
	for rows.Next() {
		var r ReportedPicture
		if err := rows.Scan(&r.EntryID, &r.PackID, &r.Concept); err != nil {
			return nil, fmt.Errorf("images: reported: %w", err)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
