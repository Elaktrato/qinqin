package journal

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"qinqin/internal/ai"
)

// The journal's typed storage (migration 044, docs/contracts/journal/): one
// table per document kind, each row scoped to one workspace of one user. The
// caller checks that the workspace is the user's; every statement here also
// names the user, so a wrong workspace id reads nothing of anyone else.

// Tables are the journal's typed tables, each with a workspace_id.
func Tables() []string {
	return []string{"journal_entries", "journal_reviews", "journal_suggestions", "journal_settings", "journal_conversations", "journal_messages"}
}

// ErrNotFound reports a missing entry.
var ErrNotFound = errors.New("journal: not found")

// InvalidError is a document the contract refuses; its message says why and
// is safe to show.
type InvalidError struct{ Msg string }

func (e *InvalidError) Error() string { return e.Msg }

func invalid(format string, args ...any) error {
	return &InvalidError{Msg: fmt.Sprintf(format, args...)}
}

// Limits of an entry.
const (
	MaxTitleRunes = 200
	MaxTextRunes  = 50000
)

var entryID = regexp.MustCompile(`^[0-9A-Za-z_-]{1,64}$`)

// ValidEntryID reports whether id may name an entry.
func ValidEntryID(id string) bool { return entryID.MatchString(id) }

func stampNow() string { return time.Now().UTC().Format(time.RFC3339) }

// plainText rejects control characters other than line breaks and tabs.
func plainText(s string) bool {
	return !strings.ContainsFunc(s, func(r rune) bool { return unicode.IsControl(r) && r != '\n' && r != '\r' && r != '\t' })
}

func validateEntry(e Entry) error {
	switch {
	case !ValidEntryID(e.ID):
		return invalid("id must be 1 to 64 letters, digits, '-' or '_'.")
	case !validDate(e.Date):
		return invalid("date must be YYYY-MM-DD.")
	case e.Source != "typed" && e.Source != "photo":
		return invalid(`source must be "typed" or "photo".`)
	case !utf8.ValidString(e.Title) || utf8.RuneCountInString(e.Title) > MaxTitleRunes || !plainText(e.Title):
		return invalid("title must be plain text of at most %d characters.", MaxTitleRunes)
	case !utf8.ValidString(e.Text) || utf8.RuneCountInString(e.Text) > MaxTextRunes || !plainText(e.Text):
		return invalid("text must be plain text of at most %d characters.", MaxTextRunes)
	}
	if e.CreatedAt != "" {
		if _, err := time.Parse(time.RFC3339Nano, e.CreatedAt); err != nil {
			return invalid("createdAt must be an RFC 3339 time.")
		}
	}
	return nil
}

func validDate(s string) bool {
	d, err := time.Parse("2006-01-02", s)
	return err == nil && d.Format("2006-01-02") == s
}

const entryCols = `id, date, title, text, source, created_at, updated_at`

type scanner interface{ Scan(...any) error }

// Querier is what the writes need of a database or a transaction (a restore
// writes inside its own transaction).
type Querier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

func scanEntry(row scanner) (Entry, error) {
	var e Entry
	err := row.Scan(&e.ID, &e.Date, &e.Title, &e.Text, &e.Source, &e.CreatedAt, &e.UpdatedAt)
	return e, err
}

// ListEntries returns the workspace's entries, newest date first, then the
// most recently saved first.
func ListEntries(ctx context.Context, sqlDB Querier, userID, workspaceID int64) ([]Entry, error) {
	rows, err := sqlDB.QueryContext(ctx, `SELECT `+entryCols+` FROM journal_entries
		WHERE user_id = ? AND workspace_id = ? ORDER BY date DESC, updated_at DESC, id`, userID, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("journal: list entries: %w", err)
	}
	defer rows.Close()
	out := []Entry{}
	for rows.Next() {
		e, err := scanEntry(rows)
		if err != nil {
			return nil, fmt.Errorf("journal: scan entry: %w", err)
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// GetEntry returns one entry, or ErrNotFound.
func GetEntry(ctx context.Context, sqlDB Querier, userID, workspaceID int64, id string) (Entry, error) {
	e, err := scanEntry(sqlDB.QueryRowContext(ctx, `SELECT `+entryCols+` FROM journal_entries
		WHERE user_id = ? AND workspace_id = ? AND id = ?`, userID, workspaceID, id))
	if errors.Is(err, sql.ErrNoRows) {
		return Entry{}, ErrNotFound
	}
	if err != nil {
		return Entry{}, fmt.Errorf("journal: get entry: %w", err)
	}
	return e, nil
}

// PutEntry validates and stores an entry (an InvalidError when the contract
// refuses it). updatedAt is the server's stamp; createdAt is the first
// write's (the client's when it sent one, else the server's) and never changes.
func PutEntry(ctx context.Context, sqlDB Querier, userID, workspaceID int64, e Entry) (Entry, error) {
	if err := validateEntry(e); err != nil {
		return Entry{}, err
	}
	stamp := stampNow()
	created := e.CreatedAt
	if created == "" {
		created = stamp
	}
	out, err := scanEntry(sqlDB.QueryRowContext(ctx, `
		INSERT INTO journal_entries (user_id, workspace_id, id, date, title, text, source, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (user_id, workspace_id, id) DO UPDATE SET
			date = excluded.date, title = excluded.title, text = excluded.text,
			source = excluded.source, updated_at = excluded.updated_at
		RETURNING `+entryCols,
		userID, workspaceID, e.ID, e.Date, e.Title, e.Text, e.Source, created, stamp))
	if err != nil {
		return Entry{}, fmt.Errorf("journal: put entry: %w", err)
	}
	return out, nil
}

// DeleteEntry removes an entry and its review; a missing entry is ErrNotFound.
func DeleteEntry(ctx context.Context, sqlDB *sql.DB, userID, workspaceID int64, id string) error {
	tx, err := beginWrite(ctx, sqlDB)
	if err != nil {
		return fmt.Errorf("journal: delete entry: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	res, err := tx.ExecContext(ctx, `DELETE FROM journal_entries WHERE user_id = ? AND workspace_id = ? AND id = ?`, userID, workspaceID, id)
	if err != nil {
		return fmt.Errorf("journal: delete entry: %w", err)
	}
	if n, err := res.RowsAffected(); err != nil {
		return fmt.Errorf("journal: delete entry: %w", err)
	} else if n == 0 {
		return ErrNotFound
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM journal_reviews WHERE user_id = ? AND workspace_id = ? AND entry_id = ?`, userID, workspaceID, id); err != nil {
		return fmt.Errorf("journal: delete review: %w", err)
	}
	return tx.Commit()
}

// GetReview returns the entry's review, or nil when it has none.
func GetReview(ctx context.Context, sqlDB Querier, userID, workspaceID int64, entryID string) (*Review, error) {
	var (
		r                          Review
		annotations, overall, drop string
	)
	err := sqlDB.QueryRowContext(ctx, `SELECT entry_id, text_hash, annotations, overall, model, provider, fallback_from, dropped, created_at
		FROM journal_reviews WHERE user_id = ? AND workspace_id = ? AND entry_id = ?`, userID, workspaceID, entryID).
		Scan(&r.EntryID, &r.TextHash, &annotations, &overall, &r.Model, &r.Provider, &r.FallbackFrom, &drop, &r.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("journal: get review: %w", err)
	}
	if err := errors.Join(json.Unmarshal([]byte(annotations), &r.Annotations), json.Unmarshal([]byte(overall), &r.Overall),
		json.Unmarshal([]byte(drop), &r.Dropped)); err != nil {
		return nil, fmt.Errorf("journal: decode review: %w", err)
	}
	if r.Annotations == nil {
		r.Annotations = []Annotation{}
	}
	return &r, nil
}

// PutReview stores the review of an entry, replacing an earlier one, in one
// statement that writes nothing when the entry is gone (ErrNotFound): a review
// that finishes after its entry was deleted leaves nothing behind.
func PutReview(ctx context.Context, sqlDB Querier, userID, workspaceID int64, r Review) error {
	annotations := r.Annotations
	if annotations == nil {
		annotations = []Annotation{}
	}
	a, err := json.Marshal(annotations)
	if err != nil {
		return err
	}
	o, err := json.Marshal(r.Overall)
	if err != nil {
		return err
	}
	d, err := json.Marshal(r.Dropped)
	if err != nil {
		return err
	}
	res, err := sqlDB.ExecContext(ctx, `
		INSERT INTO journal_reviews (user_id, workspace_id, entry_id, text_hash, annotations, overall, model, provider, fallback_from, dropped, created_at)
		SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11
		WHERE EXISTS (SELECT 1 FROM journal_entries WHERE user_id = ?1 AND workspace_id = ?2 AND id = ?3)
		ON CONFLICT (user_id, workspace_id, entry_id) DO UPDATE SET
			text_hash = excluded.text_hash, annotations = excluded.annotations, overall = excluded.overall,
			model = excluded.model, provider = excluded.provider, fallback_from = excluded.fallback_from,
			dropped = excluded.dropped, created_at = excluded.created_at`,
		userID, workspaceID, r.EntryID, r.TextHash, string(a), string(o), r.Model, r.Provider, r.FallbackFrom, string(d), r.CreatedAt)
	if err != nil {
		return fmt.Errorf("journal: put review: %w", err)
	}
	if n, err := res.RowsAffected(); err != nil {
		return fmt.Errorf("journal: put review: %w", err)
	} else if n == 0 {
		return ErrNotFound
	}
	return nil
}

// GetSuggestions returns the workspace's topic ideas, or nil.
func GetSuggestions(ctx context.Context, sqlDB Querier, userID, workspaceID int64) (*Suggestions, error) {
	var (
		s     Suggestions
		items string
	)
	err := sqlDB.QueryRowContext(ctx, `SELECT items, model, provider, created_at FROM journal_suggestions
		WHERE user_id = ? AND workspace_id = ?`, userID, workspaceID).Scan(&items, &s.Model, &s.Provider, &s.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("journal: get suggestions: %w", err)
	}
	if err := json.Unmarshal([]byte(items), &s.Items); err != nil {
		return nil, fmt.Errorf("journal: decode suggestions: %w", err)
	}
	if s.Items == nil {
		s.Items = []ai.SuggestionItem{}
	}
	return &s, nil
}

// PutSuggestions replaces the workspace's topic ideas.
func PutSuggestions(ctx context.Context, sqlDB Querier, userID, workspaceID int64, s Suggestions) error {
	items := s.Items
	if items == nil {
		items = []ai.SuggestionItem{}
	}
	b, err := json.Marshal(items)
	if err != nil {
		return err
	}
	if _, err := sqlDB.ExecContext(ctx, `
		INSERT INTO journal_suggestions (user_id, workspace_id, items, model, provider, created_at) VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT (user_id, workspace_id) DO UPDATE SET
			items = excluded.items, model = excluded.model, provider = excluded.provider, created_at = excluded.created_at`,
		userID, workspaceID, string(b), s.Model, s.Provider, s.CreatedAt); err != nil {
		return fmt.Errorf("journal: put suggestions: %w", err)
	}
	return nil
}

// GetSettings returns the workspace's journal settings, read leniently: none
// stored gives the defaults, an unknown language reads as "en".
func GetSettings(ctx context.Context, sqlDB Querier, userID, workspaceID int64) (Settings, error) {
	var s Settings
	err := sqlDB.QueryRowContext(ctx, `SELECT guidance, explanation_language FROM journal_settings
		WHERE user_id = ? AND workspace_id = ?`, userID, workspaceID).Scan(&s.Guidance, &s.ExplanationLanguage)
	if errors.Is(err, sql.ErrNoRows) {
		return Settings{ExplanationLanguage: "en"}, nil
	}
	if err != nil {
		return Settings{}, fmt.Errorf("journal: get settings: %w", err)
	}
	if !slices.Contains(ExplanationLanguages, s.ExplanationLanguage) {
		s.ExplanationLanguage = "en"
	}
	s.Guidance = cutRunes(s.Guidance, MaxGuidanceRunes)
	return s, nil
}

// PutSettings validates and stores the workspace's journal settings.
func PutSettings(ctx context.Context, sqlDB Querier, userID, workspaceID int64, s Settings) (Settings, error) {
	if !slices.Contains(ExplanationLanguages, s.ExplanationLanguage) {
		return Settings{}, invalid("explanationLanguage must be one of %s.", strings.Join(ExplanationLanguages, ", "))
	}
	if !utf8.ValidString(s.Guidance) || utf8.RuneCountInString(s.Guidance) > MaxGuidanceRunes || !plainText(s.Guidance) {
		return Settings{}, invalid("guidance must be plain text of at most %d characters.", MaxGuidanceRunes)
	}
	if _, err := sqlDB.ExecContext(ctx, `
		INSERT INTO journal_settings (user_id, workspace_id, guidance, explanation_language, updated_at) VALUES (?, ?, ?, ?, ?)
		ON CONFLICT (user_id, workspace_id) DO UPDATE SET
			guidance = excluded.guidance, explanation_language = excluded.explanation_language, updated_at = excluded.updated_at`,
		userID, workspaceID, s.Guidance, s.ExplanationLanguage, stampNow()); err != nil {
		return Settings{}, fmt.Errorf("journal: put settings: %w", err)
	}
	return s, nil
}
