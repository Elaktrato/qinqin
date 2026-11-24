package avatar

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"time"
)

// ErrNotFound: the user has no picture with that hash (or no picture).
var ErrNotFound = errors.New("avatar: not found")

var hashPattern = regexp.MustCompile(`^[0-9a-f]{32}$`)

// Store keeps the pictures: a row of user_avatars per user who has one and
// the files Dir/<userId>/<hash>-256.jpg and -64.jpg (0600, folders 0700).
// Writers (Set, Remove, Prune) are serialised by the caller with the users
// lock (auth.Users.WithUserLock), which account deletion and restore hold
// too.
type Store struct {
	DB  *sql.DB
	Dir string
	Now func() time.Time
}

// Dir is the pictures folder of a data directory.
func Dir(dataDir string) string { return filepath.Join(dataDir, "avatars") }

// Hash names a picture: the first 32 hex digits of the SHA-256 of its
// 256 px file.
func Hash(large []byte) string {
	sum := sha256.Sum256(large)
	return hex.EncodeToString(sum[:16])
}

// URL is the address of a picture's 256 px file; ?size=64 is the small one.
func URL(userID int64, hash string) string {
	return "/api/avatars/" + itoa(userID) + "/" + hash
}

// URLOf is URL for a stored hash, nil for none (the JSON avatarUrl).
func URLOf(userID int64, hash string) *string {
	if hash == "" {
		return nil
	}
	u := URL(userID, hash)
	return &u
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }

func (s Store) now() string {
	t := time.Now()
	if s.Now != nil {
		t = s.Now()
	}
	return t.UTC().Format(time.RFC3339)
}

func (s Store) userDir(userID int64) string { return filepath.Join(s.Dir, itoa(userID)) }

func fileName(hash string, size int) string { return hash + "-" + strconv.Itoa(size) + ".jpg" }

// Current is the user's picture hash, "" when there is none.
func (s Store) Current(ctx context.Context, userID int64) (string, error) {
	return current(ctx, s.DB, userID)
}

type queryRower interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

func current(ctx context.Context, q queryRower, userID int64) (string, error) {
	var hash string
	err := q.QueryRowContext(ctx, `SELECT hash FROM user_avatars WHERE user_id = ?`, userID).Scan(&hash)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return hash, err
}

// Set stores a normalised picture as the user's and returns its hash: the
// files first, then the row, then the user's other files go.
func (s Store) Set(ctx context.Context, userID int64, img Images) (string, error) {
	hash := Hash(img.Large)
	if err := s.writeFiles(userID, hash, img); err != nil {
		return "", err
	}
	if _, err := s.DB.ExecContext(ctx, `INSERT INTO user_avatars (user_id, hash, updated_at) VALUES (?, ?, ?)
		ON CONFLICT (user_id) DO UPDATE SET hash = excluded.hash, updated_at = excluded.updated_at`, userID, hash, s.now()); err != nil {
		s.Prune(context.WithoutCancel(ctx), userID)
		return "", fmt.Errorf("avatar: save: %w", err)
	}
	return hash, s.Prune(ctx, userID)
}

// WriteFiles writes the two files of a picture without touching the row
// (a restore writes the row in its own transaction); Prune after the commit
// removes whatever the row does not name.
func (s Store) WriteFiles(userID int64, img Images) (string, error) {
	hash := Hash(img.Large)
	return hash, s.writeFiles(userID, hash, img)
}

func (s Store) writeFiles(userID int64, hash string, img Images) error {
	dir := s.userDir(userID)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("avatar: folder: %w", err)
	}
	for size, data := range map[int][]byte{LargeSize: img.Large, SmallSize: img.Small} {
		// A temporary name, then a rename: a reader never sees half a file.
		tmp := filepath.Join(dir, ".tmp-"+fileName(hash, size))
		if err := os.WriteFile(tmp, data, 0o600); err != nil {
			os.Remove(tmp)
			return fmt.Errorf("avatar: write: %w", err)
		}
		if err := os.Rename(tmp, filepath.Join(dir, fileName(hash, size))); err != nil {
			os.Remove(tmp)
			return fmt.Errorf("avatar: write: %w", err)
		}
	}
	return nil
}

// SetTx records hash as the user's picture inside a transaction (restore).
func SetTx(ctx context.Context, tx *sql.Tx, userID int64, hash, now string) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO user_avatars (user_id, hash, updated_at) VALUES (?, ?, ?)
		ON CONFLICT (user_id) DO UPDATE SET hash = excluded.hash, updated_at = excluded.updated_at`, userID, hash, now)
	return err
}

// Remove deletes the user's picture (row, then files); false when there was none.
func (s Store) Remove(ctx context.Context, userID int64) (bool, error) {
	res, err := s.DB.ExecContext(ctx, `DELETE FROM user_avatars WHERE user_id = ?`, userID)
	if err != nil {
		return false, fmt.Errorf("avatar: remove: %w", err)
	}
	n, _ := res.RowsAffected()
	return n > 0, RemoveFiles(s.Dir, userID)
}

// DeleteTx deletes the row inside the caller's transaction (an
// administrator's removal with its audit row); the caller removes the files
// with RemoveFiles after the commit.
func DeleteTx(ctx context.Context, tx *sql.Tx, userID int64) (bool, error) {
	res, err := tx.ExecContext(ctx, `DELETE FROM user_avatars WHERE user_id = ?`, userID)
	if err != nil {
		return false, fmt.Errorf("avatar: remove: %w", err)
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// RemoveFiles removes the user's pictures folder; a missing one is fine.
func RemoveFiles(dir string, userID int64) error {
	if err := os.RemoveAll(filepath.Join(dir, itoa(userID))); err != nil {
		return fmt.Errorf("avatar: remove files: %w", err)
	}
	return nil
}

// Prune removes every file of the user's folder that is not a file of the
// current picture (a replaced picture, a failed write, a restore's old one).
func (s Store) Prune(ctx context.Context, userID int64) error {
	hash, err := s.Current(ctx, userID)
	if err != nil {
		return err
	}
	entries, err := os.ReadDir(s.userDir(userID))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var errs []error
	for _, e := range entries {
		if hash != "" && (e.Name() == fileName(hash, LargeSize) || e.Name() == fileName(hash, SmallSize)) {
			continue
		}
		if err := os.RemoveAll(filepath.Join(s.userDir(userID), e.Name())); err != nil {
			errs = append(errs, err)
		}
	}
	if hash == "" && len(errs) == 0 {
		os.Remove(s.userDir(userID))
	}
	return errors.Join(errs...)
}

// Read returns a file of the user's current picture: size LargeSize or
// SmallSize, hash the current one (ErrNotFound otherwise, and for a file that
// is gone).
func (s Store) Read(ctx context.Context, userID int64, hash string, size int) ([]byte, error) {
	if !hashPattern.MatchString(hash) || (size != LargeSize && size != SmallSize) {
		return nil, ErrNotFound
	}
	cur, err := s.Current(ctx, userID)
	if err != nil {
		return nil, err
	}
	if cur != hash {
		return nil, ErrNotFound
	}
	data, err := os.ReadFile(filepath.Join(s.userDir(userID), fileName(hash, size)))
	if errors.Is(err, os.ErrNotExist) {
		return nil, ErrNotFound
	}
	return data, err
}

// ReadLarge returns the 256 px file of the user's picture and its hash, ""
// and no error when there is none (the personal export).
func ReadLarge(ctx context.Context, q queryRower, dir string, userID int64) (string, []byte, error) {
	hash, err := current(ctx, q, userID)
	if err != nil || hash == "" {
		return "", nil, err
	}
	data, err := os.ReadFile(filepath.Join(dir, itoa(userID), fileName(hash, LargeSize)))
	if errors.Is(err, os.ErrNotExist) {
		return "", nil, nil
	}
	return hash, data, err
}
