package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"qinqin/internal/lang"

	"modernc.org/sqlite"
	sqlite3 "modernc.org/sqlite/lib"
)

// workspace is one study container of a user as served by the
// /api/workspaces routes: the body of POST and PUT responses, one
// element of the GET list. A user may keep several workspaces of one
// language told apart by name; the first usually keeps the empty name.
type workspace struct {
	ID        int64           `json:"id"`
	Language  string          `json:"language"`
	Name      string          `json:"name"`
	Settings  json.RawMessage `json:"settings"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

// maxWorkspaceName caps a workspace name, in code points after trimming.
const maxWorkspaceName = 40

// workspaceColumns is the column list scanWorkspace reads.
const workspaceColumns = `id, language, name, settings, updated_at`

// rowScanner is anything with a Scan method: *sql.Row and *sql.Rows.
type rowScanner interface {
	Scan(dest ...any) error
}

// workspaceName trims a requested name and checks it: at most 40 code
// points, and no control (Cc) or format (Cf) characters, so no
// newlines, tabs, ZWSP, word joiner, BOM, soft hyphen or bidi controls.
// The format characters that build visible text stay allowed: ZWNJ and
// ZWJ (scripts that need them, ZWJ emoji) and the tag characters
// U+E0020-E007F (subdivision flags). A refused name comes back with the
// reason, for a 422.
func workspaceName(raw string) (name, problem string) {
	name = strings.TrimSpace(raw)
	if utf8.RuneCountInString(name) > maxWorkspaceName {
		return "", "name is longer than 40 characters"
	}
	if strings.ContainsFunc(name, refusedInName) {
		return "", "name contains control or invisible characters"
	}
	return name, ""
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

// handleCreateWorkspace serves POST /api/workspaces {language, name?}:
// it opens a workspace of the request's language for the caller,
// auto-registering codes without a code pack as data-only languages.
// The name is trimmed and checked by workspaceName (422 otherwise); an
// existing (language, name) pair of the caller is a 409.
func (s *server) handleCreateWorkspace(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	var req struct {
		Language string `json:"language"`
		Name     string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed request body", http.StatusBadRequest)
		return
	}
	language := strings.ToLower(strings.TrimSpace(req.Language))
	if language == "" {
		http.Error(w, "language is required", http.StatusBadRequest)
		return
	}
	name, problem := workspaceName(req.Name)
	if problem != "" {
		http.Error(w, problem, http.StatusUnprocessableEntity)
		return
	}
	if !lang.Registered(language) {
		if _, err := s.db.ExecContext(r.Context(), `
			INSERT INTO languages (code, name, updated_at) VALUES (?, ?, ?)
			ON CONFLICT (code) DO NOTHING`, language, language, now()); err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
	}
	ws, err := scanWorkspace(s.db.QueryRowContext(r.Context(), `
		INSERT INTO workspaces (user_id, language, name, settings, updated_at)
		VALUES (?, ?, ?, '{}', ?)
		RETURNING `+workspaceColumns,
		u.ID, language, name, now()))
	if isUniqueViolation(err) {
		http.Error(w, "workspace already exists", http.StatusConflict)
		return
	}
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusCreated, ws)
}

// handleListWorkspaces serves GET /api/workspaces with the caller's
// workspaces only, in creation order. A caller without any workspace
// first gets one default, unnamed workspace per installed language.
func (s *server) handleListWorkspaces(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	if err := s.ensureDefaultWorkspaces(r.Context(), u.ID); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	rows, err := s.db.QueryContext(r.Context(), `
		SELECT `+workspaceColumns+` FROM workspaces
		WHERE user_id = ? ORDER BY id`, u.ID)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	list := make([]workspace, 0)
	for rows.Next() {
		ws, err := scanWorkspace(rows)
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		list = append(list, ws)
	}
	if err := rows.Err(); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// ensureDefaultWorkspaces gives a user who has no workspace one
// unnamed workspace per installed language; a user with any workspace
// is never touched. The insert is one statement, so one SQLite write
// transaction that takes the write lock before it reads, and it
// re-checks "no workspace yet" inside that transaction, with INSERT OR
// IGNORE under UNIQUE(user_id, language, name) as the backstop:
// concurrent first requests serialize and the later ones insert
// nothing.
func (s *server) ensureDefaultWorkspaces(ctx context.Context, userID int64) error {
	var has bool
	if err := s.db.QueryRowContext(ctx,
		`SELECT EXISTS (SELECT 1 FROM workspaces WHERE user_id = ?)`, userID).Scan(&has); err != nil {
		return err
	}
	if has {
		return nil
	}
	langs, err := installedLanguages(ctx, s.db)
	if err != nil || len(langs) == 0 {
		return err
	}
	codes := make([]string, len(langs))
	for i, l := range langs {
		codes[i] = l.Code
	}
	codesJSON, err := json.Marshal(codes)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT OR IGNORE INTO workspaces (user_id, language, name, settings, updated_at)
		SELECT ?1, j.value, '', '{}', ?2 FROM json_each(?3) j
		WHERE NOT EXISTS (SELECT 1 FROM workspaces WHERE user_id = ?1)
		ORDER BY j.key`,
		userID, now(), string(codesJSON))
	return err
}

// handleUpdateWorkspace serves PUT /api/workspaces/{id} with a body of
// {name?: string, settings?: object}: it renames the workspace (trimmed,
// checked by workspaceName, 409 when the caller already has that
// (language, name)) and merges settings into the stored object. At
// least one of the two is required and no other key is accepted. Other
// users' workspaces are invisible: unknown and foreign ids are 404.
func (s *server) handleUpdateWorkspace(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "workspace not found", http.StatusNotFound)
		return
	}
	var req struct {
		Name     *string         `json:"name"`
		Settings json.RawMessage `json:"settings"`
	}
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		http.Error(w, "malformed request body", http.StatusBadRequest)
		return
	}
	var name sql.NullString
	if req.Name != nil {
		n, problem := workspaceName(*req.Name)
		if problem != "" {
			http.Error(w, problem, http.StatusUnprocessableEntity)
			return
		}
		name = sql.NullString{String: n, Valid: true}
	}
	var patch sql.NullString
	if len(req.Settings) > 0 && string(req.Settings) != "null" {
		var obj map[string]any
		if err := json.Unmarshal(req.Settings, &obj); err != nil {
			http.Error(w, "settings must be an object", http.StatusBadRequest)
			return
		}
		merged, err := json.Marshal(obj)
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		patch = sql.NullString{String: string(merged), Valid: true}
	}
	if !name.Valid && !patch.Valid {
		http.Error(w, "name or settings required", http.StatusBadRequest)
		return
	}
	// json_patch merges the settings object in place (RFC 7396: existing
	// keys update, new keys are added) while stamping updated_at.
	ws, err := scanWorkspace(s.db.QueryRowContext(r.Context(), `
		UPDATE workspaces
		SET name = COALESCE(?1, name),
		    settings = CASE WHEN ?2 IS NULL THEN settings ELSE json_patch(settings, ?2) END,
		    updated_at = ?3
		WHERE id = ?4 AND user_id = ?5
		RETURNING `+workspaceColumns,
		name, patch, now(), id, u.ID))
	if errors.Is(err, sql.ErrNoRows) {
		http.Error(w, "workspace not found", http.StatusNotFound)
		return
	}
	if isUniqueViolation(err) {
		http.Error(w, "workspace already exists", http.StatusConflict)
		return
	}
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, ws)
}

// scanWorkspace reads one workspace row (workspaceColumns), parsing the
// stored RFC 3339 timestamp. Settings are scanned as text and wrapped as
// raw JSON.
func scanWorkspace(row rowScanner) (workspace, error) {
	var (
		ws        workspace
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

// isUniqueViolation reports whether err is a SQLite UNIQUE constraint
// error.
func isUniqueViolation(err error) bool {
	var sqliteErr *sqlite.Error
	return errors.As(err, &sqliteErr) && sqliteErr.Code() == sqlite3.SQLITE_CONSTRAINT_UNIQUE
}

// now returns the server clock as UTC RFC 3339, the timestamp convention
// for every write.
func now() string {
	return time.Now().UTC().Format(time.RFC3339)
}
