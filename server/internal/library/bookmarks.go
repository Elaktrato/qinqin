package library

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const (
	// MaxPositionLen caps a stored position (reading position or
	// bookmark), in bytes.
	MaxPositionLen = 1 << 10
	// MaxBookmarks caps the bookmarks of one book.
	MaxBookmarks = 200
	// MaxLabelLen caps a bookmark label, in code points after cleaning.
	MaxLabelLen = 120
)

var (
	// ErrPositionTooLong reports a position over MaxPositionLen bytes.
	ErrPositionTooLong = errors.New("library: position too long")
	// ErrPositionEmpty reports a bookmark without a position.
	ErrPositionEmpty = errors.New("library: position required")
	// ErrLabelTooLong reports a label over MaxLabelLen code points.
	ErrLabelTooLong = errors.New("library: label too long")
	// ErrTooMany reports a book that already has MaxBookmarks bookmarks.
	ErrTooMany = errors.New("library: too many bookmarks")
)

// Bookmark is a saved place in a book.
type Bookmark struct {
	ID        int64     `json:"id"`
	BookID    int64     `json:"bookId"`
	Position  string    `json:"position"`
	Label     string    `json:"label"`
	CreatedAt time.Time `json:"createdAt"`
}

// checkPosition is the rule every stored position follows.
func checkPosition(position string) error {
	if len(position) > MaxPositionLen {
		return ErrPositionTooLong
	}
	return nil
}

// cleanLabel collapses whitespace runs (newlines included) to single
// spaces, trims, and drops control characters; format characters such
// as soft hyphens and zero-width joiners stay, since they occur in book
// text. A result over MaxLabelLen code points is ErrLabelTooLong.
func cleanLabel(raw string) (string, error) {
	label := strings.Map(func(r rune) rune {
		if unicode.IsControl(r) && !unicode.IsSpace(r) {
			return -1
		}
		return r
	}, raw)
	label = strings.Join(strings.Fields(label), " ")
	if utf8.RuneCountInString(label) > MaxLabelLen {
		return "", ErrLabelTooLong
	}
	return label, nil
}

const bookmarkColumns = `id, book_id, position, label, created_at`

// scanBookmark reads one bookmark row (bookmarkColumns).
func scanBookmark(row interface{ Scan(...any) error }) (Bookmark, error) {
	var m Bookmark
	var created string
	if err := row.Scan(&m.ID, &m.BookID, &m.Position, &m.Label, &created); err != nil {
		return Bookmark{}, err
	}
	t, err := time.Parse(time.RFC3339, created)
	if err != nil {
		return Bookmark{}, fmt.Errorf("library: parse created_at %q: %w", created, err)
	}
	m.CreatedAt = t
	return m, nil
}

// ownsBook reports whether the book exists and is the user's.
func (s Store) ownsBook(ctx context.Context, userID, bookID int64) (bool, error) {
	var ok bool
	err := s.DB.QueryRowContext(ctx,
		`SELECT EXISTS (SELECT 1 FROM library_books WHERE id = ? AND user_id = ?)`, bookID, userID).Scan(&ok)
	if err != nil {
		return false, fmt.Errorf("library: book %d: %w", bookID, err)
	}
	return ok, nil
}

// ListBookmarks returns the bookmarks of one of the user's books in
// creation order; a book that is not the user's is ErrNotFound.
func (s Store) ListBookmarks(ctx context.Context, userID, bookID int64) ([]Bookmark, error) {
	if ok, err := s.ownsBook(ctx, userID, bookID); err != nil {
		return nil, err
	} else if !ok {
		return nil, ErrNotFound
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT `+bookmarkColumns+` FROM library_bookmarks
		WHERE book_id = ? AND user_id = ? ORDER BY id`, bookID, userID)
	if err != nil {
		return nil, fmt.Errorf("library: list bookmarks %d: %w", bookID, err)
	}
	defer rows.Close()
	out := []Bookmark{}
	for rows.Next() {
		m, err := scanBookmark(rows)
		if err != nil {
			return nil, fmt.Errorf("library: list bookmarks %d: %w", bookID, err)
		}
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("library: list bookmarks %d: %w", bookID, err)
	}
	return out, nil
}

// AddBookmark bookmarks a position in one of the user's books and
// reports whether a new bookmark was created: a bookmark already at that
// position is returned unchanged instead. The position follows the
// reading-position rule and must not be empty; the label is cleaned
// (see cleanLabel). A book that is not the user's is ErrNotFound, and a
// book with MaxBookmarks bookmarks is ErrTooMany.
func (s Store) AddBookmark(ctx context.Context, userID, bookID int64, position, label string) (Bookmark, bool, error) {
	if position == "" {
		return Bookmark{}, false, ErrPositionEmpty
	}
	if err := checkPosition(position); err != nil {
		return Bookmark{}, false, err
	}
	label, err := cleanLabel(label)
	if err != nil {
		return Bookmark{}, false, err
	}
	// One statement: the ownership check, the cap and the insert run
	// under the write lock; UNIQUE(book_id, position) settles concurrent
	// adds at one position.
	m, err := scanBookmark(s.DB.QueryRowContext(ctx, `
		INSERT INTO library_bookmarks (user_id, book_id, position, label, created_at)
		SELECT ?1, b.id, ?3, ?4, ?5 FROM library_books b
		WHERE b.id = ?2 AND b.user_id = ?1
		  AND (SELECT COUNT(*) FROM library_bookmarks WHERE book_id = ?2) < ?6
		ON CONFLICT (book_id, position) DO NOTHING
		RETURNING `+bookmarkColumns,
		userID, bookID, position, label, time.Now().UTC().Format(time.RFC3339), MaxBookmarks))
	if err == nil {
		return m, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return Bookmark{}, false, fmt.Errorf("library: add bookmark %d: %w", bookID, err)
	}
	// Nothing inserted: not the user's book, an existing bookmark at the
	// position, or the cap.
	m, err = scanBookmark(s.DB.QueryRowContext(ctx, `SELECT `+bookmarkColumns+` FROM library_bookmarks
		WHERE book_id = ? AND user_id = ? AND position = ?`, bookID, userID, position))
	if err == nil {
		return m, false, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return Bookmark{}, false, fmt.Errorf("library: add bookmark %d: %w", bookID, err)
	}
	if ok, err := s.ownsBook(ctx, userID, bookID); err != nil {
		return Bookmark{}, false, err
	} else if !ok {
		return Bookmark{}, false, ErrNotFound
	}
	return Bookmark{}, false, ErrTooMany
}

// RenameBookmark sets the label (cleaned, see cleanLabel) of a bookmark
// of one of the user's books and returns the bookmark; a bookmark that
// is not in that book of the user is ErrNotFound.
func (s Store) RenameBookmark(ctx context.Context, userID, bookID, bookmarkID int64, label string) (Bookmark, error) {
	label, err := cleanLabel(label)
	if err != nil {
		return Bookmark{}, err
	}
	m, err := scanBookmark(s.DB.QueryRowContext(ctx, `
		UPDATE library_bookmarks SET label = ? WHERE id = ? AND book_id = ? AND user_id = ?
		RETURNING `+bookmarkColumns, label, bookmarkID, bookID, userID))
	if errors.Is(err, sql.ErrNoRows) {
		return Bookmark{}, ErrNotFound
	}
	if err != nil {
		return Bookmark{}, fmt.Errorf("library: rename bookmark %d: %w", bookmarkID, err)
	}
	return m, nil
}

// DeleteBookmark removes a bookmark of one of the user's books; a
// bookmark that is not in that book of the user is ErrNotFound.
func (s Store) DeleteBookmark(ctx context.Context, userID, bookID, bookmarkID int64) error {
	res, err := s.DB.ExecContext(ctx,
		`DELETE FROM library_bookmarks WHERE id = ? AND book_id = ? AND user_id = ?`, bookmarkID, bookID, userID)
	if err != nil {
		return fmt.Errorf("library: delete bookmark %d: %w", bookmarkID, err)
	}
	if n, err := res.RowsAffected(); err != nil {
		return fmt.Errorf("library: delete bookmark %d: %w", bookmarkID, err)
	} else if n == 0 {
		return ErrNotFound
	}
	return nil
}
