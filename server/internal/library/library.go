// Package library stores books a user keeps for reading. A book's
// metadata and reading position live in the library_books table; its
// content, a JSON array of chapters, lives in one file per book at
// <Dir>/<userID>/<bookID>.json. Only integer database ids ever build a
// file path, so no user-supplied string can reach the filesystem.
package library

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"time"

	"modernc.org/sqlite"
	sqlite3 "modernc.org/sqlite/lib"
)

// ErrNotFound reports a book (or chapter) that does not exist for the
// asking user; another user's book is indistinguishable from a missing one.
var ErrNotFound = errors.New("library: not found")

// ErrDuplicate reports a book whose (source, source id) the workspace
// already has.
var ErrDuplicate = errors.New("library: duplicate book")

// ErrWorkspaceNotFound reports a workspace that does not exist for the
// asking user; another user's workspace is indistinguishable from a
// missing one.
var ErrWorkspaceNotFound = errors.New("library: workspace not found")

// LanguageMismatchError reports a book whose language differs from its
// workspace's. Its message is meant for the user.
type LanguageMismatchError struct {
	Workspace, Book string
}

func (e *LanguageMismatchError) Error() string {
	return "workspace language is " + e.Workspace + ", book is " + e.Book
}

// Run is a stretch of text, optionally carrying its ruby annotation.
type Run struct {
	Text string `json:"text"`
	Ruby string `json:"ruby,omitempty"`
}

// Paragraph is a sequence of runs.
type Paragraph []Run

// Chapter is a titled sequence of paragraphs.
type Chapter struct {
	Title      string      `json:"title"`
	Paragraphs []Paragraph `json:"paragraphs"`
}

// Book is a library book's metadata.
type Book struct {
	ID           int64     `json:"id"`
	UserID       int64     `json:"-"`
	WorkspaceID  int64     `json:"workspaceId"`
	Language     string    `json:"language"`
	Title        string    `json:"title"`
	Author       string    `json:"author"`
	Source       string    `json:"source"`
	SourceID     string    `json:"sourceId"`
	SourceURL    string    `json:"sourceUrl"`
	Attribution  string    `json:"attribution"`
	LicenseNote  string    `json:"licenseNote"`
	ChapterCount int       `json:"chapterCount"`
	Position     string    `json:"position"`
	CreatedAt    time.Time `json:"createdAt"`
}

// Store keeps books in DB with their content files under Dir.
type Store struct {
	DB  *sql.DB
	Dir string
}

const columns = `id, user_id, workspace_id, language, title, author, source, source_id,
	source_url, attribution, license_note, chapter_count, position, created_at`

// path is the content file of a book, built from integer ids only.
func (s Store) path(userID, id int64) string {
	return filepath.Join(s.Dir, strconv.FormatInt(userID, 10), strconv.FormatInt(id, 10)+".json")
}

// Create stores a book and its chapters and returns the book with its id,
// chapter count and creation time filled in. The row is inserted in a
// transaction, the content file is written (temp file, then rename)
// before the commit, and the file is removed again if anything fails,
// so a failed Create leaves no orphan file. b.WorkspaceID must be one of
// b.UserID's workspaces (ErrWorkspaceNotFound otherwise) of the book's
// language (*LanguageMismatchError otherwise); both are checked inside
// the transaction. A clash on the workspace's (source, source id)
// returns ErrDuplicate.
func (s Store) Create(ctx context.Context, b Book, chapters []Chapter) (Book, error) {
	if chapters == nil {
		chapters = []Chapter{}
	}
	content, err := json.Marshal(chapters)
	if err != nil {
		return Book{}, fmt.Errorf("library: encode chapters: %w", err)
	}
	b.ChapterCount = len(chapters)
	b.CreatedAt = time.Now().UTC().Truncate(time.Second)

	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Book{}, fmt.Errorf("library: create: %w", err)
	}
	defer tx.Rollback()

	// The workspace check is part of the INSERT: one statement takes the
	// write lock before it reads, so the transaction never has to upgrade
	// a read snapshot (which WAL can refuse with SQLITE_BUSY_SNAPSHOT).
	res, err := tx.ExecContext(ctx, `
		INSERT INTO library_books (user_id, workspace_id, language, title, author, source, source_id,
			source_url, attribution, license_note, chapter_count, position, created_at)
		SELECT ?1, w.id, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13
		FROM workspaces w WHERE w.id = ?2 AND w.user_id = ?1 AND w.language = ?3`,
		b.UserID, b.WorkspaceID, b.Language, b.Title, b.Author, b.Source, b.SourceID,
		b.SourceURL, b.Attribution, b.LicenseNote, b.ChapterCount, b.Position,
		b.CreatedAt.Format(time.RFC3339))
	if err != nil {
		if isUniqueViolation(err) {
			return Book{}, ErrDuplicate
		}
		return Book{}, fmt.Errorf("library: insert book: %w", err)
	}
	if n, err := res.RowsAffected(); err != nil {
		return Book{}, fmt.Errorf("library: insert book: %w", err)
	} else if n == 0 {
		// No row: the workspace is not the user's or has another language.
		wsLang, err := workspaceLanguage(ctx, tx, b.UserID, b.WorkspaceID)
		if err != nil {
			return Book{}, err
		}
		return Book{}, &LanguageMismatchError{Workspace: wsLang, Book: b.Language}
	}
	if b.ID, err = res.LastInsertId(); err != nil {
		return Book{}, fmt.Errorf("library: insert book: %w", err)
	}

	path := s.path(b.UserID, b.ID)
	if err := writeFile(path, content); err != nil {
		return Book{}, fmt.Errorf("library: write content: %w", err)
	}
	if err := tx.Commit(); err != nil {
		os.Remove(path)
		return Book{}, fmt.Errorf("library: create: %w", err)
	}
	return b, nil
}

// isUniqueViolation reports whether err is a SQLite UNIQUE constraint error.
func isUniqueViolation(err error) bool {
	var sqliteErr *sqlite.Error
	return errors.As(err, &sqliteErr) && sqliteErr.Code() == sqlite3.SQLITE_CONSTRAINT_UNIQUE
}

// writeFile writes content to path atomically via a temp file in the
// same directory; no partial file remains on failure.
func writeFile(path string, content []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".tmp-*")
	if err != nil {
		return err
	}
	_, werr := tmp.Write(content)
	cerr := tmp.Close()
	if err := errors.Join(werr, cerr); err != nil {
		os.Remove(tmp.Name())
		return err
	}
	if err := os.Rename(tmp.Name(), path); err != nil {
		os.Remove(tmp.Name())
		return err
	}
	return nil
}

// scan reads one book row.
func scan(row interface{ Scan(...any) error }) (Book, error) {
	var b Book
	var created string
	err := row.Scan(&b.ID, &b.UserID, &b.WorkspaceID, &b.Language, &b.Title, &b.Author, &b.Source, &b.SourceID,
		&b.SourceURL, &b.Attribution, &b.LicenseNote, &b.ChapterCount, &b.Position, &created)
	if err != nil {
		return Book{}, err
	}
	if b.CreatedAt, err = time.Parse(time.RFC3339, created); err != nil {
		return Book{}, fmt.Errorf("library: parse created_at %q: %w", created, err)
	}
	return b, nil
}

// queryer is what both *sql.DB and *sql.Tx offer for a single-row read.
type queryer interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// workspaceLanguage returns the language of one of the user's
// workspaces, or ErrWorkspaceNotFound.
func workspaceLanguage(ctx context.Context, q queryer, userID, workspaceID int64) (string, error) {
	var language string
	err := q.QueryRowContext(ctx,
		`SELECT language FROM workspaces WHERE id = ? AND user_id = ?`, workspaceID, userID).Scan(&language)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrWorkspaceNotFound
	}
	if err != nil {
		return "", fmt.Errorf("library: workspace %d: %w", workspaceID, err)
	}
	return language, nil
}

// WorkspaceLanguage returns the language of one of the user's
// workspaces, or ErrWorkspaceNotFound.
func (s Store) WorkspaceLanguage(ctx context.Context, userID, workspaceID int64) (string, error) {
	return workspaceLanguage(ctx, s.DB, userID, workspaceID)
}

// HasSource reports whether one of the user's workspaces already holds
// the work (source, sourceID): one lookup on the dedupe key.
func (s Store) HasSource(ctx context.Context, userID, workspaceID int64, source, sourceID string) (bool, error) {
	var has bool
	err := s.DB.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM library_books
		WHERE workspace_id = ? AND source = ? AND source_id = ? AND source_id <> '' AND user_id = ?)`,
		workspaceID, source, sourceID, userID).Scan(&has)
	if err != nil {
		return false, fmt.Errorf("library: has source: %w", err)
	}
	return has, nil
}

// List returns the user's books of one workspace, or of all the user's
// workspaces when workspaceID is 0, oldest first. Another user's
// workspace lists nothing.
func (s Store) List(ctx context.Context, userID, workspaceID int64) ([]Book, error) {
	query, args := `SELECT `+columns+` FROM library_books WHERE user_id = ? ORDER BY id`, []any{userID}
	if workspaceID != 0 {
		query = `SELECT ` + columns + ` FROM library_books WHERE user_id = ? AND workspace_id = ? ORDER BY id`
		args = append(args, workspaceID)
	}
	rows, err := s.DB.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("library: list: %w", err)
	}
	defer rows.Close()
	books := []Book{}
	for rows.Next() {
		b, err := scan(rows)
		if err != nil {
			return nil, fmt.Errorf("library: list: %w", err)
		}
		books = append(books, b)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("library: list: %w", err)
	}
	return books, nil
}

// Get returns one of the user's books, or ErrNotFound.
func (s Store) Get(ctx context.Context, userID, id int64) (Book, error) {
	b, err := scan(s.DB.QueryRowContext(ctx,
		`SELECT `+columns+` FROM library_books WHERE user_id = ? AND id = ?`, userID, id))
	if errors.Is(err, sql.ErrNoRows) {
		return Book{}, ErrNotFound
	}
	if err != nil {
		return Book{}, fmt.Errorf("library: get %d: %w", id, err)
	}
	return b, nil
}

// Chapter returns chapter n (zero-based) of one of the user's books;
// a missing book or an n out of range is ErrNotFound.
func (s Store) Chapter(ctx context.Context, userID, id int64, n int) (Chapter, error) {
	b, err := s.Get(ctx, userID, id)
	if err != nil {
		return Chapter{}, err
	}
	if n < 0 || n >= b.ChapterCount {
		return Chapter{}, ErrNotFound
	}
	data, err := os.ReadFile(s.path(userID, id))
	if err != nil {
		return Chapter{}, fmt.Errorf("library: read book %d: %w", id, err)
	}
	var chapters []Chapter
	if err := json.Unmarshal(data, &chapters); err != nil {
		return Chapter{}, fmt.Errorf("library: decode book %d: %w", id, err)
	}
	if n >= len(chapters) {
		return Chapter{}, ErrNotFound
	}
	return chapters[n], nil
}

// SetPosition stores the reader's position in one of the user's books;
// a position over MaxPositionLen bytes is ErrPositionTooLong.
func (s Store) SetPosition(ctx context.Context, userID, id int64, position string) error {
	if err := checkPosition(position); err != nil {
		return err
	}
	res, err := s.DB.ExecContext(ctx,
		`UPDATE library_books SET position = ? WHERE user_id = ? AND id = ?`, position, userID, id)
	if err != nil {
		return fmt.Errorf("library: set position %d: %w", id, err)
	}
	if n, err := res.RowsAffected(); err != nil {
		return fmt.Errorf("library: set position %d: %w", id, err)
	} else if n == 0 {
		return ErrNotFound
	}
	return nil
}

// Delete removes one of the user's books: its row, its bookmarks and
// highlights (in the same transaction) and its content file.
func (s Store) Delete(ctx context.Context, userID, id int64) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("library: delete %d: %w", id, err)
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx,
		`DELETE FROM library_books WHERE user_id = ? AND id = ?`, userID, id)
	if err != nil {
		return fmt.Errorf("library: delete %d: %w", id, err)
	}
	if n, err := res.RowsAffected(); err != nil {
		return fmt.Errorf("library: delete %d: %w", id, err)
	} else if n == 0 {
		return ErrNotFound
	}
	if _, err := tx.ExecContext(ctx,
		`DELETE FROM library_bookmarks WHERE book_id = ?`, id); err != nil {
		return fmt.Errorf("library: delete bookmarks %d: %w", id, err)
	}
	if _, err := tx.ExecContext(ctx,
		`DELETE FROM library_highlights WHERE book_id = ?`, id); err != nil {
		return fmt.Errorf("library: delete highlights %d: %w", id, err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("library: delete %d: %w", id, err)
	}
	// A failed file removal after the row delete can leave an orphan file;
	// a reused id overwrites it.
	if err := os.Remove(s.path(userID, id)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("library: delete content %d: %w", id, err)
	}
	return nil
}

// DeleteWorkspaceBooks deletes, inside the caller's transaction, every
// book of one of userID's workspaces with its bookmarks and highlights,
// and returns the deleted book ids in id order. The content files stay:
// the caller removes them with RemoveContent once the transaction has
// committed, so a rollback never loses a book's text. Another user's
// workspace deletes nothing.
func DeleteWorkspaceBooks(ctx context.Context, tx *sql.Tx, userID, workspaceID int64) ([]int64, error) {
	// Children first, while the book rows still say which books they are.
	const books = `SELECT id FROM library_books WHERE user_id = ?1 AND workspace_id = ?2`
	for _, table := range []string{"library_bookmarks", "library_highlights"} {
		if _, err := tx.ExecContext(ctx,
			`DELETE FROM `+table+` WHERE book_id IN (`+books+`)`, userID, workspaceID); err != nil {
			return nil, fmt.Errorf("library: delete workspace %d %s: %w", workspaceID, table, err)
		}
	}
	rows, err := tx.QueryContext(ctx,
		`DELETE FROM library_books WHERE user_id = ?1 AND workspace_id = ?2 RETURNING id`, userID, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("library: delete workspace %d books: %w", workspaceID, err)
	}
	defer rows.Close()
	ids := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("library: delete workspace %d books: %w", workspaceID, err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("library: delete workspace %d books: %w", workspaceID, err)
	}
	slices.Sort(ids)
	return ids, nil
}

// RemoveContent removes the content files of the user's books ids, the
// second half of DeleteWorkspaceBooks. A missing file is not an error;
// every other failure is reported, joined, after trying all of them.
func (s Store) RemoveContent(userID int64, ids []int64) error {
	var errs []error
	for _, id := range ids {
		if err := os.Remove(s.path(userID, id)); err != nil && !errors.Is(err, os.ErrNotExist) {
			errs = append(errs, fmt.Errorf("library: remove content %d: %w", id, err))
		}
	}
	return errors.Join(errs...)
}
