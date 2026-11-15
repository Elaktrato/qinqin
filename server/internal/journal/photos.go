package journal

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/oklog/ulid/v2"

	"qinqin/internal/ai"
)

// MaxPendingPhotos is the number of open photo drafts a user may have.
const MaxPendingPhotos = 10

const (
	photoIdle   = time.Hour      // not seen for this long: swept
	photoMaxAge = 24 * time.Hour // created this long ago: swept
	rowGrace    = time.Minute    // a row younger than this may still be waiting for its file
)

var (
	ErrPhotoNotFound = errors.New("journal: photo not found")
	ErrTooManyPhotos = errors.New("journal: too many pending photos")
)

// Photo is a temporary photo's row.
type Photo struct {
	ID                    string
	UserID, WorkspaceID   int64
	CreatedAt, LastSeenAt time.Time
}

// Photos stores the temporary photos: a row in journal_photos and the file
// Dir/<userId>/<id>.jpg (mode 0600). Photos are never synced or put in
// plugin data.
type Photos struct {
	DB  *sql.DB
	Dir string
	Now func() time.Time
}

func (p Photos) now() time.Time {
	if p.Now != nil {
		return p.Now().UTC()
	}
	return time.Now().UTC()
}

func stamp(t time.Time) string { return t.UTC().Format(time.RFC3339) }

func (p Photos) path(userID int64, id string) string {
	return filepath.Join(p.Dir, strconv.FormatInt(userID, 10), id+".jpg")
}

// Create stores a normalised JPEG. The row is inserted first, with the cap
// enforced inside the same statement, so concurrent uploads cannot exceed it.
func (p Photos) Create(ctx context.Context, userID, workspaceID int64, jpegData []byte) (Photo, error) {
	now := p.now()
	id := ulid.MustNew(ulid.Timestamp(now), ulid.DefaultEntropy()).String()
	res, err := p.DB.ExecContext(ctx, `
		INSERT INTO journal_photos (id, user_id, workspace_id, created_at, last_seen_at)
		SELECT ?1, ?2, ?3, ?4, ?4 WHERE (SELECT COUNT(*) FROM journal_photos WHERE user_id = ?2) < ?5`,
		id, userID, workspaceID, stamp(now), MaxPendingPhotos)
	if err != nil {
		return Photo{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return Photo{}, ErrTooManyPhotos
	}
	fail := func(err error) (Photo, error) {
		p.DB.ExecContext(context.WithoutCancel(ctx), `DELETE FROM journal_photos WHERE id = ?`, id)
		return Photo{}, err
	}
	if err := os.MkdirAll(filepath.Dir(p.path(userID, id)), 0o700); err != nil {
		return fail(err)
	}
	if err := os.WriteFile(p.path(userID, id), jpegData, 0o600); err != nil {
		os.Remove(p.path(userID, id))
		return fail(err)
	}
	return Photo{ID: id, UserID: userID, WorkspaceID: workspaceID, CreatedAt: now, LastSeenAt: now}, nil
}

// Count is the number of photo drafts the user has open.
func (p Photos) Count(ctx context.Context, userID int64) (int, error) {
	var n int
	err := p.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM journal_photos WHERE user_id = ?`, userID).Scan(&n)
	return n, err
}

// Get returns the owner's photo and its bytes, and bumps last_seen_at.
func (p Photos) Get(ctx context.Context, userID int64, id string) (Photo, []byte, error) {
	ph, err := p.row(ctx, userID, id)
	if err != nil {
		return Photo{}, nil, err
	}
	data, err := os.ReadFile(p.path(userID, id))
	if errors.Is(err, os.ErrNotExist) {
		return Photo{}, nil, ErrPhotoNotFound
	}
	if err != nil {
		return Photo{}, nil, err
	}
	if err := p.Touch(ctx, userID, id); err != nil {
		return Photo{}, nil, err
	}
	ph.LastSeenAt = p.now()
	return ph, data, nil
}

func (p Photos) row(ctx context.Context, userID int64, id string) (Photo, error) {
	ph := Photo{ID: id, UserID: userID}
	var created, seen string
	err := p.DB.QueryRowContext(ctx, `SELECT workspace_id, created_at, last_seen_at FROM journal_photos WHERE id = ? AND user_id = ?`, id, userID).
		Scan(&ph.WorkspaceID, &created, &seen)
	if errors.Is(err, sql.ErrNoRows) {
		return Photo{}, ErrPhotoNotFound
	}
	if err != nil {
		return Photo{}, err
	}
	ph.CreatedAt, _ = time.Parse(time.RFC3339, created)
	ph.LastSeenAt, _ = time.Parse(time.RFC3339, seen)
	return ph, nil
}

// Touch refreshes last_seen_at of the owner's photo.
func (p Photos) Touch(ctx context.Context, userID int64, id string) error {
	res, err := p.DB.ExecContext(ctx, `UPDATE journal_photos SET last_seen_at = ? WHERE id = ? AND user_id = ?`, stamp(p.now()), id, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrPhotoNotFound
	}
	return nil
}

// Delete removes the row, then the file; a missing file is fine.
func (p Photos) Delete(ctx context.Context, userID int64, id string) error {
	res, err := p.DB.ExecContext(ctx, `DELETE FROM journal_photos WHERE id = ? AND user_id = ?`, id, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrPhotoNotFound
	}
	if err := os.Remove(p.path(userID, id)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

// DeleteWorkspacePhotosTx deletes the rows of a workspace's photos inside the
// workspace-deletion transaction and returns their ids; the caller removes
// the files with RemoveFiles after the commit.
func DeleteWorkspacePhotosTx(ctx context.Context, tx *sql.Tx, userID, workspaceID int64) ([]string, error) {
	rows, err := tx.QueryContext(ctx, `SELECT id FROM journal_photos WHERE user_id = ? AND workspace_id = ?`, userID, workspaceID)
	if err != nil {
		return nil, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM journal_photos WHERE user_id = ? AND workspace_id = ?`, userID, workspaceID); err != nil {
		return nil, err
	}
	return ids, nil
}

// RemoveFiles removes the files of the given photo ids; missing ones are fine.
func (p Photos) RemoveFiles(userID int64, ids []string) error {
	var errs []error
	for _, id := range ids {
		if err := os.Remove(p.path(userID, id)); err != nil && !errors.Is(err, os.ErrNotExist) {
			errs = append(errs, fmt.Errorf("journal: remove photo %s: %w", id, err))
		}
	}
	return errors.Join(errs...)
}

// Sweep deletes photos not seen for an hour or created over 24 h ago, files
// without a row and rows without a file. It returns how many it removed.
func (p Photos) Sweep(ctx context.Context) (int, error) {
	now := p.now()
	removed := 0
	var errs []error

	type victim struct {
		user int64
		id   string
	}
	var victims []victim
	rows, err := p.DB.QueryContext(ctx, `SELECT user_id, id, created_at FROM journal_photos
		WHERE last_seen_at < ? OR created_at < ? OR created_at < ?`,
		stamp(now.Add(-photoIdle)), stamp(now.Add(-photoMaxAge)), stamp(now.Add(-rowGrace)))
	if err != nil {
		return 0, err
	}
	for rows.Next() {
		var v victim
		var created string
		if err := rows.Scan(&v.user, &v.id, &created); err != nil {
			rows.Close()
			return 0, err
		}
		victims = append(victims, v)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	for _, v := range victims {
		// Delete the row only if it is still stale or its file is gone; a
		// photo touched since the listing stays.
		_, statErr := os.Stat(p.path(v.user, v.id))
		missing := errors.Is(statErr, os.ErrNotExist)
		res, err := p.DB.ExecContext(ctx, `DELETE FROM journal_photos WHERE id = ? AND user_id = ? AND
			(last_seen_at < ? OR created_at < ? OR ?)`, v.id, v.user, stamp(now.Add(-photoIdle)), stamp(now.Add(-photoMaxAge)), missing)
		if err != nil {
			errs = append(errs, err)
			continue
		}
		if n, _ := res.RowsAffected(); n == 0 {
			continue
		}
		if err := os.Remove(p.path(v.user, v.id)); err != nil && !errors.Is(err, os.ErrNotExist) {
			errs = append(errs, err)
		}
		removed++
	}

	users, err := os.ReadDir(p.Dir)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		errs = append(errs, err)
	}
	for _, u := range users {
		if !u.IsDir() {
			continue
		}
		uid, err := strconv.ParseInt(u.Name(), 10, 64)
		if err != nil {
			continue
		}
		files, err := os.ReadDir(filepath.Join(p.Dir, u.Name()))
		if err != nil {
			errs = append(errs, err)
			continue
		}
		for _, f := range files {
			id, ok := strings.CutSuffix(f.Name(), ".jpg")
			if !ok || f.IsDir() {
				continue
			}
			var n int
			if err := p.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM journal_photos WHERE id = ? AND user_id = ?`, id, uid).Scan(&n); err != nil {
				errs = append(errs, err)
				continue
			}
			if n > 0 {
				continue
			}
			if err := os.Remove(filepath.Join(p.Dir, u.Name(), f.Name())); err != nil && !errors.Is(err, os.ErrNotExist) {
				errs = append(errs, err)
				continue
			}
			removed++
		}
	}
	return removed, errors.Join(errs...)
}

// RunJanitor sweeps now and then every interval until ctx ends, and prunes
// old AI call rows through l when it is not nil.
func RunJanitor(ctx context.Context, p Photos, l *ai.Limiter, every time.Duration, logf func(string, ...any)) {
	sweep := func() {
		if n, err := p.Sweep(ctx); err != nil && ctx.Err() == nil {
			logf("journal janitor: %v", err)
		} else if n > 0 {
			logf("journal janitor: removed %d photos", n)
		}
		if l != nil {
			if err := l.Prune(ctx, 7*24*time.Hour); err != nil && ctx.Err() == nil {
				logf("journal janitor: prune ai calls: %v", err)
			}
		}
	}
	sweep()
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			sweep()
		}
	}
}
