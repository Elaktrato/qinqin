package sentences

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"qinqin/internal/model"
	"qinqin/internal/pack"
)

// Sentence sources (#280, docs/contracts/reader/sentence-sources.json): an
// own sentence saved from the reader keeps its book, chapter and the word's
// place, so the entry page can link back to it.

const (
	// SourceKindBook is the kind of a source in a library book.
	SourceKindBook = "book"
	// MaxSourceParagraph caps a source's paragraph index.
	MaxSourceParagraph = 100000
	// MaxSourceOffset caps a source's end offset, in code points of the
	// paragraph's plain text (the highlights' cap).
	MaxSourceOffset = 100000
)

// ErrBadSource reports a source that is not a place in one of the caller's
// books of the entry's language.
var ErrBadSource = errors.New("sentences: the source is not a place in one of your books")

// SourceRequest is the source a client sends with a new sentence: the book,
// the chapter and paragraph (zero-based) and the word's code-point range
// [Start, End) in the paragraph.
type SourceRequest struct {
	BookID    int64 `json:"bookId"`
	Chapter   int   `json:"chapter"`
	Paragraph int   `json:"paragraph"`
	Start     int   `json:"start"`
	End       int   `json:"end"`
}

// SourceBook is what CheckSource needs of the named book; nil when it is not
// one of the caller's (missing and another user's look the same).
type SourceBook struct {
	Language     string
	ChapterCount int
	Title        string
}

// CheckSource is the request rule (contract `check`): one of the caller's
// books, of the entry's language, a chapter it has, a paragraph within
// MaxSourceParagraph and 0 <= Start < End <= MaxSourceOffset. Anything else
// is ErrBadSource.
func CheckSource(src SourceRequest, book *SourceBook, entryLanguage string) error {
	switch {
	case book == nil,
		!strings.EqualFold(book.Language, entryLanguage),
		src.Chapter < 0 || src.Chapter >= book.ChapterCount,
		src.Paragraph < 0 || src.Paragraph > MaxSourceParagraph,
		src.Start < 0 || src.Start >= src.End || src.End > MaxSourceOffset:
		return ErrBadSource
	}
	return nil
}

// BookSource is the stored source of a checked request, with the book's title.
func BookSource(src SourceRequest, title string) model.SentenceSource {
	id := src.BookID
	return model.SentenceSource{Kind: SourceKindBook, BookID: &id, Title: title,
		Chapter: src.Chapter, Paragraph: src.Paragraph, Start: src.Start, End: src.End}
}

// sourceColumns are the column values of a source (none: the zero values and
// a NULL book).
func sourceColumns(src *model.SentenceSource) (model.SentenceSource, any) {
	if src == nil {
		return model.SentenceSource{}, nil
	}
	var book any
	if src.BookID != nil {
		book = *src.BookID
	}
	return *src, book
}

// AdoptSource gives userID's own sentence sentenceID the source when it has
// none (contract `merge`: the same text saved again from a book); a sentence
// with a source keeps it and a pack or another user's sentence is untouched.
// It reports whether the row changed; a change moves updated_at, so the pull
// ships it.
func AdoptSource(ctx context.Context, sqlDB *sql.DB, userID, sentenceID int64, src model.SentenceSource) (bool, error) {
	cols, book := sourceColumns(&src)
	res, err := sqlDB.ExecContext(ctx, `
		UPDATE sentences SET source_kind = ?, source_book_id = ?, source_title = ?, source_chapter = ?,
			source_paragraph = ?, source_start = ?, source_end = ?, updated_at = ?
		WHERE id = ? AND user_id = ? AND deleted_at IS NULL AND source_kind = ''`,
		cols.Kind, book, cols.Title, cols.Chapter, cols.Paragraph, cols.Start, cols.End, pack.Now(), sentenceID, userID)
	if err != nil {
		return false, fmt.Errorf("adopt source of sentence %d: %w", sentenceID, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("adopt source of sentence %d: %w", sentenceID, err)
	}
	return n > 0, nil
}

// execer is what *sql.DB and *sql.Tx offer for a statement.
type execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// DetachBooks runs inside a book delete (the caller's transaction): userID's
// sentences from the books lose the book and keep their title and place
// (contract `detach`); updated_at moves, so the pull ships the change. Other
// users' sentences are never touched (a book is one user's).
func DetachBooks(ctx context.Context, tx execer, userID int64, bookIDs []int64) error {
	const chunk = 500
	stamp := pack.Now()
	for start := 0; start < len(bookIDs); start += chunk {
		part := bookIDs[start:min(start+chunk, len(bookIDs))]
		args := make([]any, 0, len(part)+2)
		args = append(args, stamp, userID)
		marks := make([]string, len(part))
		for i, id := range part {
			marks[i] = "?"
			args = append(args, id)
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE sentences SET source_book_id = NULL, updated_at = ?
			WHERE user_id = ? AND source_book_id IN (`+strings.Join(marks, ",")+`)`, args...); err != nil {
			return fmt.Errorf("detach sentences of deleted books: %w", err)
		}
	}
	return nil
}
