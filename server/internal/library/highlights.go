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
	// MaxHighlights caps the highlights of one book.
	MaxHighlights = 2000
	// MaxHighlightOffset caps a highlight's end offset, in code points
	// of the paragraph's plain text.
	MaxHighlightOffset = 100000
	// MaxHighlightText caps a highlight's text snapshot, in code points
	// after trimming.
	MaxHighlightText = 500
	// MaxNoteLen caps a highlight's note, in code points.
	MaxNoteLen = 2000
	// DefaultHighlightColor is the colour of a highlight added without one.
	DefaultHighlightColor = "yellow"
)

// highlightColors are the colours a highlight may have.
var highlightColors = map[string]bool{"yellow": true, "green": true, "blue": true, "pink": true}

var (
	// ErrHighlightRange reports a highlight position outside the book or
	// an empty or reversed range: chapter not below the chapter count,
	// negative paragraph or start, start >= end, or end over
	// MaxHighlightOffset.
	ErrHighlightRange = errors.New("library: highlight range out of bounds")
	// ErrHighlightColor reports a colour outside yellow, green, blue, pink.
	ErrHighlightColor = errors.New("library: unknown highlight colour")
	// ErrHighlightText reports a text snapshot that is empty, starts or
	// ends with whitespace, is longer than MaxHighlightText code points,
	// or does not have exactly End-Start code points.
	ErrHighlightText = errors.New("library: highlight text does not match its range")
	// ErrNoteTooLong reports a note over MaxNoteLen code points after
	// cleaning.
	ErrNoteTooLong = errors.New("library: note too long")
	// ErrOverlap reports a highlight overlapping an existing one in the
	// same paragraph; the error is an *OverlapError naming it.
	ErrOverlap = errors.New("library: highlight overlaps another")
)

// OverlapError is the ErrOverlap of one add: ExistingID is the highlight
// already covering part of the range.
type OverlapError struct {
	ExistingID int64
}

func (e *OverlapError) Error() string {
	return fmt.Sprintf("%v (highlight %d)", ErrOverlap, e.ExistingID)
}

// Unwrap makes errors.Is(err, ErrOverlap) hold.
func (e *OverlapError) Unwrap() error { return ErrOverlap }

// Highlight is a marked range of one paragraph of a book, with an
// optional note. Start and End are code-point offsets into the
// paragraph's plain text, End exclusive; Text is the highlighted text
// as it was when the highlight was made.
type Highlight struct {
	ID        int64     `json:"id"`
	BookID    int64     `json:"bookId"`
	Chapter   int       `json:"chapter"`
	Paragraph int       `json:"paragraph"`
	Start     int       `json:"start"`
	End       int       `json:"end"`
	Text      string    `json:"text"`
	Color     string    `json:"color"`
	Note      string    `json:"note"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func checkColor(color string) error {
	if !highlightColors[color] {
		return ErrHighlightColor
	}
	return nil
}

// cleanNote turns CR LF and lone CR into LF and drops the bidi
// embedding, override and isolate controls (U+202A-202E, U+2066-2069)
// and every other control character except newline and tab; whitespace
// is otherwise kept as written. A result over MaxNoteLen code points is
// ErrNoteTooLong.
func cleanNote(raw string) (string, error) {
	note := strings.ReplaceAll(raw, "\r\n", "\n")
	note = strings.Map(func(r rune) rune {
		switch {
		case r == '\r':
			return '\n'
		case r == '\n', r == '\t':
			return r
		case unicode.IsControl(r),
			r >= 0x202a && r <= 0x202e,
			r >= 0x2066 && r <= 0x2069:
			return -1
		}
		return r
	}, note)
	if utf8.RuneCountInString(note) > MaxNoteLen {
		return "", ErrNoteTooLong
	}
	return note, nil
}

// checkText is the snapshot rule: the text is exactly the code points
// of [start, end), so it is not empty, has no leading or trailing
// whitespace (the client trims the selection and adjusts the range)
// and has end-start code points (which also catches UTF-16 offsets).
// The text is stored as given, never cleaned.
func checkText(text string, start, end int) error {
	n := utf8.RuneCountInString(text)
	if n == 0 || n > MaxHighlightText || n != end-start || text != strings.TrimSpace(text) {
		return ErrHighlightText
	}
	return nil
}

// cleanHighlight validates a new highlight's fields apart from the
// chapter count, cleans its note and fills in the default colour.
func cleanHighlight(h Highlight) (Highlight, error) {
	if h.Chapter < 0 || h.Paragraph < 0 || h.Start < 0 || h.Start >= h.End || h.End > MaxHighlightOffset {
		return Highlight{}, ErrHighlightRange
	}
	if h.Color == "" {
		h.Color = DefaultHighlightColor
	}
	if err := checkColor(h.Color); err != nil {
		return Highlight{}, err
	}
	if err := checkText(h.Text, h.Start, h.End); err != nil {
		return Highlight{}, err
	}
	note, err := cleanNote(h.Note)
	if err != nil {
		return Highlight{}, err
	}
	h.Note = note
	return h, nil
}

const highlightColumns = `id, book_id, chapter, paragraph, start_cp, end_cp, text, color, note, created_at, updated_at`

// scanHighlight reads one highlight row (highlightColumns).
func scanHighlight(row interface{ Scan(...any) error }) (Highlight, error) {
	var h Highlight
	var created, updated string
	if err := row.Scan(&h.ID, &h.BookID, &h.Chapter, &h.Paragraph, &h.Start, &h.End,
		&h.Text, &h.Color, &h.Note, &created, &updated); err != nil {
		return Highlight{}, err
	}
	var err error
	if h.CreatedAt, err = time.Parse(time.RFC3339, created); err != nil {
		return Highlight{}, fmt.Errorf("library: parse created_at %q: %w", created, err)
	}
	if h.UpdatedAt, err = time.Parse(time.RFC3339, updated); err != nil {
		return Highlight{}, fmt.Errorf("library: parse updated_at %q: %w", updated, err)
	}
	return h, nil
}

// ListHighlights returns the highlights of one of the user's books
// ordered by chapter, paragraph and start; a book that is not the
// user's is ErrNotFound.
func (s Store) ListHighlights(ctx context.Context, userID, bookID int64) ([]Highlight, error) {
	if ok, err := s.ownsBook(ctx, userID, bookID); err != nil {
		return nil, err
	} else if !ok {
		return nil, ErrNotFound
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT `+highlightColumns+` FROM library_highlights
		WHERE book_id = ? AND user_id = ? ORDER BY chapter, paragraph, start_cp, id`, bookID, userID)
	if err != nil {
		return nil, fmt.Errorf("library: list highlights %d: %w", bookID, err)
	}
	defer rows.Close()
	out := []Highlight{}
	for rows.Next() {
		h, err := scanHighlight(rows)
		if err != nil {
			return nil, fmt.Errorf("library: list highlights %d: %w", bookID, err)
		}
		out = append(out, h)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("library: list highlights %d: %w", bookID, err)
	}
	return out, nil
}

// AddHighlight highlights a range of one paragraph of one of the user's
// books; the ID, BookID and timestamps of h are ignored. The range must
// lie in the book (chapter below its chapter count, see
// ErrHighlightRange), the colour defaults to yellow, the text must be
// exactly the range's code points (see checkText, ErrHighlightText) and
// the note is cleaned (see cleanNote, ErrNoteTooLong). A range overlapping a highlight of the same
// paragraph is an *OverlapError (ErrOverlap); ranges that only touch
// are fine. A book that is not the user's is ErrNotFound, and a book
// with MaxHighlights highlights is ErrTooMany.
func (s Store) AddHighlight(ctx context.Context, userID, bookID int64, h Highlight) (Highlight, error) {
	h, err := cleanHighlight(h)
	if err != nil {
		return Highlight{}, err
	}
	// A failed insert is diagnosed after the fact; a highlight deleted
	// in between can leave no reason, so the insert is tried again.
	for range 3 {
		added, err := s.insertHighlight(ctx, userID, bookID, h)
		if err == nil {
			return added, nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return Highlight{}, fmt.Errorf("library: add highlight %d: %w", bookID, err)
		}
		if err := s.whyNoHighlight(ctx, userID, bookID, h); err != nil {
			return Highlight{}, err
		}
	}
	return Highlight{}, fmt.Errorf("library: add highlight %d: insert keeps failing", bookID)
}

// insertHighlight inserts h in one statement, so the ownership and
// chapter checks, the overlap check, the cap and the insert run under
// the write lock. Nothing inserted is sql.ErrNoRows.
func (s Store) insertHighlight(ctx context.Context, userID, bookID int64, h Highlight) (Highlight, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	return scanHighlight(s.DB.QueryRowContext(ctx, `
		INSERT INTO library_highlights
			(user_id, book_id, chapter, paragraph, start_cp, end_cp, text, color, note, created_at, updated_at)
		SELECT ?1, b.id, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10 FROM library_books b
		WHERE b.id = ?2 AND b.user_id = ?1 AND ?3 < b.chapter_count
		  AND NOT EXISTS (SELECT 1 FROM library_highlights
			WHERE book_id = ?2 AND chapter = ?3 AND paragraph = ?4 AND start_cp < ?6 AND ?5 < end_cp)
		  AND (SELECT COUNT(*) FROM library_highlights WHERE book_id = ?2) < ?11
		RETURNING `+highlightColumns,
		userID, bookID, h.Chapter, h.Paragraph, h.Start, h.End, h.Text, h.Color, h.Note, now, MaxHighlights))
}

// whyNoHighlight explains an insert of h that inserted nothing:
// ErrNotFound, ErrHighlightRange, an *OverlapError or ErrTooMany, in
// that order; nil when none holds any more.
func (s Store) whyNoHighlight(ctx context.Context, userID, bookID int64, h Highlight) error {
	var chapters int
	err := s.DB.QueryRowContext(ctx,
		`SELECT chapter_count FROM library_books WHERE id = ? AND user_id = ?`, bookID, userID).Scan(&chapters)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("library: add highlight %d: %w", bookID, err)
	}
	if h.Chapter >= chapters {
		return ErrHighlightRange
	}
	var existing int64
	err = s.DB.QueryRowContext(ctx, `SELECT id FROM library_highlights
		WHERE book_id = ? AND chapter = ? AND paragraph = ? AND start_cp < ? AND ? < end_cp
		ORDER BY start_cp, id LIMIT 1`, bookID, h.Chapter, h.Paragraph, h.End, h.Start).Scan(&existing)
	if err == nil {
		return &OverlapError{ExistingID: existing}
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("library: add highlight %d: %w", bookID, err)
	}
	var n int
	if err := s.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM library_highlights WHERE book_id = ?`, bookID).Scan(&n); err != nil {
		return fmt.Errorf("library: add highlight %d: %w", bookID, err)
	}
	if n >= MaxHighlights {
		return ErrTooMany
	}
	return nil
}

// UpdateHighlight sets the colour and/or the note (cleaned, see
// cleanNote; a nil pointer keeps the field) of a highlight of one of the user's books and returns the
// highlight; the range and text never change. A highlight that is not
// in that book of the user is ErrNotFound.
func (s Store) UpdateHighlight(ctx context.Context, userID, bookID, highlightID int64, color, note *string) (Highlight, error) {
	if color != nil {
		if err := checkColor(*color); err != nil {
			return Highlight{}, err
		}
	}
	if note != nil {
		cleaned, err := cleanNote(*note)
		if err != nil {
			return Highlight{}, err
		}
		note = &cleaned
	}
	// Nothing to change leaves updated_at as it is.
	h, err := scanHighlight(s.DB.QueryRowContext(ctx, `
		UPDATE library_highlights SET color = COALESCE(?1, color), note = COALESCE(?2, note),
			updated_at = CASE WHEN ?1 IS NULL AND ?2 IS NULL THEN updated_at ELSE ?3 END
		WHERE id = ?4 AND book_id = ?5 AND user_id = ?6
		RETURNING `+highlightColumns,
		color, note, time.Now().UTC().Format(time.RFC3339), highlightID, bookID, userID))
	if errors.Is(err, sql.ErrNoRows) {
		return Highlight{}, ErrNotFound
	}
	if err != nil {
		return Highlight{}, fmt.Errorf("library: update highlight %d: %w", highlightID, err)
	}
	return h, nil
}

// DeleteHighlight removes a highlight of one of the user's books; a
// highlight that is not in that book of the user is ErrNotFound.
func (s Store) DeleteHighlight(ctx context.Context, userID, bookID, highlightID int64) error {
	res, err := s.DB.ExecContext(ctx,
		`DELETE FROM library_highlights WHERE id = ? AND book_id = ? AND user_id = ?`, highlightID, bookID, userID)
	if err != nil {
		return fmt.Errorf("library: delete highlight %d: %w", highlightID, err)
	}
	if n, err := res.RowsAffected(); err != nil {
		return fmt.Errorf("library: delete highlight %d: %w", highlightID, err)
	} else if n == 0 {
		return ErrNotFound
	}
	return nil
}
