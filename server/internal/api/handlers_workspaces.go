package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"qinqin/internal/lang"

	"modernc.org/sqlite"
	sqlite3 "modernc.org/sqlite/lib"
)

// workspace is one (user, language) study container as served by the
// /api/workspaces routes: the body of POST and PUT, one element of the
// GET list.
type workspace struct {
	ID        int64           `json:"id"`
	Language  string          `json:"language"`
	Settings  json.RawMessage `json:"settings"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

// rowScanner is anything with a Scan method: *sql.Row and *sql.Rows.
type rowScanner interface {
	Scan(dest ...any) error
}

// handleCreateWorkspace serves POST /api/workspaces: it opens the
// caller's workspace for the request's language, auto-registering codes
// without a code pack as data-only languages.
func (s *server) handleCreateWorkspace(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	var req struct {
		Language string `json:"language"`
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
	if !lang.Registered(language) {
		if _, err := s.db.ExecContext(r.Context(), `
			INSERT INTO languages (code, name, updated_at) VALUES (?, ?, ?)
			ON CONFLICT (code) DO NOTHING`, language, language, now()); err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
	}
	ws, err := scanWorkspace(s.db.QueryRowContext(r.Context(), `
		INSERT INTO workspaces (user_id, language, settings, updated_at)
		VALUES (?, ?, '{}', ?)
		RETURNING id, language, settings, updated_at`,
		u.ID, language, now()))
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
// workspaces only, in creation order.
func (s *server) handleListWorkspaces(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	rows, err := s.db.QueryContext(r.Context(), `
		SELECT id, language, settings, updated_at FROM workspaces
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

// handleUpdateWorkspace serves PUT /api/workspaces/{id}: it merges the
// request body, a JSON object, into the workspace's settings. Other
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
	var patch map[string]any
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		http.Error(w, "malformed request body", http.StatusBadRequest)
		return
	}
	if patch == nil {
		http.Error(w, "settings object required", http.StatusBadRequest)
		return
	}
	merged, err := json.Marshal(patch)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	// json_patch merges the settings object in place (RFC 7396: existing
	// keys update, new keys are added) while stamping updated_at.
	ws, err := scanWorkspace(s.db.QueryRowContext(r.Context(), `
		UPDATE workspaces
		SET settings = json_patch(settings, ?), updated_at = ?
		WHERE id = ? AND user_id = ?
		RETURNING id, language, settings, updated_at`,
		merged, now(), id, u.ID))
	if errors.Is(err, sql.ErrNoRows) {
		http.Error(w, "workspace not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, ws)
}

// scanWorkspace reads one workspace row, parsing the stored RFC 3339
// timestamp. Settings are scanned as text and wrapped as raw JSON.
func scanWorkspace(row rowScanner) (workspace, error) {
	var (
		ws        workspace
		settings  string
		updatedAt string
	)
	if err := row.Scan(&ws.ID, &ws.Language, &settings, &updatedAt); err != nil {
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
