// Package workspaces owns the study containers of a user: the name rule,
// creating one (and the language it opens), the list with the default
// workspaces of a new user, renaming and settings, ownership checks, and
// deleting one with everything scoped to it (delete.go). The functions take
// a *sql.DB or *sql.Tx and never an HTTP request (record 0003).
package workspaces

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"modernc.org/sqlite"
	sqlite3 "modernc.org/sqlite/lib"

	"qinqin/internal/lang"
)

// Workspace is one study container of a user. A user may keep several
// workspaces of one language told apart by name; the first usually keeps
// the empty name.
type Workspace struct {
	ID        int64
	Language  string
	Name      string
	Settings  json.RawMessage
	UpdatedAt time.Time
}

const (
	// MaxName caps a workspace name, in code points after trimming.
	MaxName = 40
	// MaxSettings caps the merged settings object stored per workspace (the
	// web client stores audio and reader display settings there).
	MaxSettings = 64 << 10
)

var (
	ErrNotFound         = errors.New("workspaces: no such workspace")
	ErrExists           = errors.New("workspaces: a workspace with this name already exists")
	ErrLastWorkspace    = errors.New("workspaces: the last workspace of a user")
	ErrSettingsTooLarge = errors.New("workspaces: settings larger than 64 KiB")
	ErrLanguageRequired = errors.New("workspaces: language is required")
	ErrInvalidLanguage  = errors.New("workspaces: not a language code")
	ErrUnknownLanguage  = errors.New("workspaces: language not set up on the server")
)

// NameError refuses a workspace name; its text is the reason, for the
// person who typed it.
type NameError struct{ Reason string }

func (e *NameError) Error() string { return e.Reason }

// ValidName trims a requested name and checks it: at most 40 code points,
// and no control (Cc) or format (Cf) characters, so no newlines, tabs,
// ZWSP, word joiner, BOM, soft hyphen or bidi controls. The format
// characters that build visible text stay allowed: ZWNJ and ZWJ (scripts
// that need them, ZWJ emoji) and the tag characters U+E0020-E007F
// (subdivision flags).
func ValidName(raw string) (string, error) {
	name := strings.TrimSpace(raw)
	if utf8.RuneCountInString(name) > MaxName {
		return "", &NameError{"name is longer than 40 characters"}
	}
	if strings.ContainsFunc(name, refusedInName) {
		return "", &NameError{"name contains control or invisible characters"}
	}
	return name, nil
}

// refusedInName reports a control or format character other than ZWNJ,
// ZWJ and the emoji tag characters.
func refusedInName(r rune) bool {
	switch {
	case r == 0x200c, r == 0x200d, r >= 0xe0020 && r <= 0xe007f:
		return false
	}
	return unicode.In(r, unicode.Cc, unicode.Cf)
}

// columns is the column list scan reads.
const columns = `id, language, name, settings, updated_at`

type scanner interface {
	Scan(dest ...any) error
}

// scan reads one workspace row (columns), parsing the stored RFC 3339
// timestamp. Settings are scanned as text and kept as raw JSON.
func scan(row scanner) (Workspace, error) {
	var (
		ws        Workspace
		settings  string
		updatedAt string
	)
	if err := row.Scan(&ws.ID, &ws.Language, &ws.Name, &settings, &updatedAt); err != nil {
		return ws, err
	}
	updated, err := time.Parse(time.RFC3339, updatedAt)
	if err != nil {
		return ws, err
	}
	ws.Settings = json.RawMessage(settings)
	ws.UpdatedAt = updated
	return ws, nil
}

func isUniqueViolation(err error) bool {
	var sqliteErr *sqlite.Error
	return errors.As(err, &sqliteErr) && sqliteErr.Code() == sqlite3.SQLITE_CONSTRAINT_UNIQUE
}

func now() string { return time.Now().UTC().Format(time.RFC3339) }

// NewWorkspace is what Create needs: the owner, whether the owner is an
// administrator (who may open a language the server does not know yet),
// the requested language code and name.
type NewWorkspace struct {
	UserID   int64
	Admin    bool
	Language string
	Name     string
}

// Create opens a workspace of the requested language for the user. The
// language is trimmed and lowercased; a code that exactly matches a stored
// row or installed data keeps its spelling (a legacy pt_br is not split
// into pt-br), anything else must be a well-formed code (lang.ValidCode).
// A language without a code pack that the server does not know is opened
// only by an administrator, which registers it as a data-only language.
// Errors: ErrLanguageRequired, a NameError, ErrInvalidLanguage,
// ErrUnknownLanguage, ErrExists (the user has that language and name).
//
// The caller serialises Create with language removal (lang.Remove): the
// known check, the languages row and the workspace row are three
// statements.
func Create(ctx context.Context, db *sql.DB, in NewWorkspace) (Workspace, error) {
	rawLanguage := strings.ToLower(strings.TrimSpace(in.Language))
	if rawLanguage == "" {
		return Workspace{}, ErrLanguageRequired
	}
	name, err := ValidName(in.Name)
	if err != nil {
		return Workspace{}, err
	}
	language := rawLanguage
	exact, err := lang.Exists(ctx, db, rawLanguage)
	if err != nil {
		return Workspace{}, err
	}
	known := exact || lang.Registered(rawLanguage)
	if !exact {
		code, valid := lang.ValidCode(in.Language)
		if !valid {
			return Workspace{}, ErrInvalidLanguage
		}
		language = code
		if !lang.Registered(code) {
			if known, err = lang.Exists(ctx, db, code); err != nil {
				return Workspace{}, err
			}
		} else {
			known = true
		}
	}
	if !lang.Registered(language) {
		if !known && !in.Admin {
			return Workspace{}, ErrUnknownLanguage
		}
		if err := lang.AddDataRow(ctx, db, language); err != nil {
			return Workspace{}, err
		}
	}
	ws, err := scan(db.QueryRowContext(ctx, `
		INSERT INTO workspaces (user_id, language, name, settings, updated_at)
		VALUES (?, ?, ?, '{}', ?)
		RETURNING `+columns,
		in.UserID, language, name, now()))
	if isUniqueViolation(err) {
		return Workspace{}, ErrExists
	}
	return ws, err
}

// List returns the user's workspaces in creation order, never nil. A user
// without any workspace first gets the defaults (EnsureDefaults).
func List(ctx context.Context, db *sql.DB, userID int64) ([]Workspace, error) {
	if err := EnsureDefaults(ctx, db, userID); err != nil {
		return nil, err
	}
	rows, err := db.QueryContext(ctx, `SELECT `+columns+` FROM workspaces WHERE user_id = ? ORDER BY id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]Workspace, 0)
	for rows.Next() {
		ws, err := scan(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, ws)
	}
	return list, rows.Err()
}

// EnsureDefaults gives a user who has no workspace one unnamed workspace
// per installed language; a user with any workspace is never touched. The
// insert is one statement, so one SQLite write transaction that takes the
// write lock before it reads, and it re-checks "no workspace yet" inside
// that transaction, with INSERT OR IGNORE under UNIQUE(user_id, language,
// name) as the backstop: concurrent first requests serialise and the later
// ones insert nothing.
func EnsureDefaults(ctx context.Context, db *sql.DB, userID int64) error {
	var has bool
	if err := db.QueryRowContext(ctx,
		`SELECT EXISTS (SELECT 1 FROM workspaces WHERE user_id = ?)`, userID).Scan(&has); err != nil {
		return err
	}
	if has {
		return nil
	}
	langs, err := lang.Installed(ctx, db)
	if err != nil || len(langs) == 0 {
		return err
	}
	// Code-pack languages (zh, ja) first, then data-only ones (the es
	// demo), each group in code order: ids follow the array order, and the
	// web app opens the lowest id, so a new user lands in a language the
	// reader and lookup fully support.
	codes := make([]string, 0, len(langs))
	for _, l := range langs {
		if lang.Registered(l.Code) {
			codes = append(codes, l.Code)
		}
	}
	for _, l := range langs {
		if !lang.Registered(l.Code) {
			codes = append(codes, l.Code)
		}
	}
	codesJSON, err := json.Marshal(codes)
	if err != nil {
		return err
	}
	_, err = db.ExecContext(ctx, `
		INSERT OR IGNORE INTO workspaces (user_id, language, name, settings, updated_at)
		SELECT ?1, j.value, '', '{}', ?2 FROM json_each(?3) j
		WHERE NOT EXISTS (SELECT 1 FROM workspaces WHERE user_id = ?1)
		ORDER BY j.key`,
		userID, now(), string(codesJSON))
	return err
}

// Patch is a change to a workspace: a new name (checked by ValidName),
// and a settings object merged into the stored one (RFC 7396: existing
// keys update, new keys are added, a null value deletes its key). A nil
// field is left alone.
type Patch struct {
	Name     *string
	Settings []byte
}

// Update applies the patch to one of the user's workspaces and stamps it.
// Errors: a NameError, ErrNotFound (unknown and foreign ids alike),
// ErrExists (the user has that language and name), ErrSettingsTooLarge (the
// merged settings would outgrow MaxSettings; nothing changes).
func Update(ctx context.Context, db *sql.DB, userID, id int64, p Patch) (Workspace, error) {
	var name, patch sql.NullString
	if p.Name != nil {
		n, err := ValidName(*p.Name)
		if err != nil {
			return Workspace{}, err
		}
		name = sql.NullString{String: n, Valid: true}
	}
	if p.Settings != nil {
		patch = sql.NullString{String: string(p.Settings), Valid: true}
	}
	ws, err := scan(db.QueryRowContext(ctx, `
		UPDATE workspaces
		SET name = COALESCE(?1, name),
		    settings = CASE WHEN ?2 IS NULL THEN settings ELSE json_patch(settings, ?2) END,
		    updated_at = ?3
		WHERE id = ?4 AND user_id = ?5
		  AND (?2 IS NULL OR length(CAST(json_patch(settings, ?2) AS BLOB)) <= ?6)
		RETURNING `+columns,
		name, patch, now(), id, userID, MaxSettings))
	switch {
	case errors.Is(err, sql.ErrNoRows):
		owned, oerr := Owned(ctx, db, userID, id)
		switch {
		case oerr != nil:
			return Workspace{}, oerr
		case owned && patch.Valid:
			return Workspace{}, ErrSettingsTooLarge
		}
		return Workspace{}, ErrNotFound
	case isUniqueViolation(err):
		return Workspace{}, ErrExists
	}
	return ws, err
}

// Queryer is what the read-only checks read through: *sql.DB or *sql.Tx.
type Queryer interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// Owned reports whether the workspace belongs to the user. The lookup keys
// on (id, user_id), so unknown and foreign ids are indistinguishable.
func Owned(ctx context.Context, q Queryer, userID, id int64) (bool, error) {
	var one int
	err := q.QueryRowContext(ctx, `SELECT 1 FROM workspaces WHERE id = ? AND user_id = ?`, id, userID).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// Language returns the language of one of the user's workspaces;
// ErrNotFound for unknown and foreign ids.
func Language(ctx context.Context, q Queryer, userID, id int64) (string, error) {
	var language string
	err := q.QueryRowContext(ctx, `SELECT language FROM workspaces WHERE id = ? AND user_id = ?`, id, userID).Scan(&language)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return language, err
}

// Languages lists the distinct languages of the user's workspaces, sorted,
// never nil.
func Languages(ctx context.Context, q Queryer, userID int64) ([]string, error) {
	rows, err := q.QueryContext(ctx, `SELECT DISTINCT language FROM workspaces WHERE user_id = ? ORDER BY language`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	langs := []string{}
	for rows.Next() {
		var l string
		if err := rows.Scan(&l); err != nil {
			return nil, err
		}
		langs = append(langs, l)
	}
	return langs, rows.Err()
}
