package api

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"qinqin/internal/journal"
	"qinqin/internal/lang"
	"qinqin/internal/library"

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
	body, ok := readBody(w, r, maxWorkspaceBody)
	if !ok {
		return
	}
	var req struct {
		Language string `json:"language"`
		Name     string `json:"name"`
	}
	if err := json.NewDecoder(bytes.NewReader(body)).Decode(&req); err != nil {
		http.Error(w, "malformed request body", http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(req.Language) == "" {
		http.Error(w, "language is required", http.StatusBadRequest)
		return
	}
	language, valid := lang.ValidCode(req.Language)
	if !valid {
		http.Error(w, "language must be a code like es or pt-br", http.StatusUnprocessableEntity)
		return
	}
	name, problem := workspaceName(req.Name)
	if problem != "" {
		http.Error(w, problem, http.StatusUnprocessableEntity)
		return
	}
	if !lang.Registered(language) {
		// Only an administrator opens a new language; everyone else
		// picks from the known ones.
		if !u.Admin {
			known, err := s.languageKnown(r.Context(), language)
			if err != nil {
				http.Error(w, "internal error", http.StatusInternalServerError)
				return
			}
			if !known {
				http.Error(w, "unknown language — ask the administrator to add it", http.StatusUnprocessableEntity)
				return
			}
		}
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

// languageKnown reports whether a data-only code has a languages row or
// installed dictionary data.
func (s *server) languageKnown(ctx context.Context, code string) (bool, error) {
	var n int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM languages WHERE code = ?`, code).Scan(&n); err != nil {
		return false, err
	}
	if n > 0 {
		return true, nil
	}
	installed, err := installedLanguages(ctx, s.db)
	if err != nil {
		return false, err
	}
	for _, li := range installed {
		if li.Code == code {
			return true, nil
		}
	}
	return false, nil
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
	// Code-pack languages (zh, ja) first, then data-only ones (the es
	// demo), each group in code order: ids follow the array order, and
	// the web app opens the lowest id, so a new user lands in a language
	// the reader and lookup fully support.
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
	body, ok := readBody(w, r, maxWorkspaceBody)
	if !ok {
		return
	}
	dec := json.NewDecoder(bytes.NewReader(body))
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
	// keys update, new keys are added) while stamping updated_at. A patch
	// whose merged object would outgrow maxWorkspaceSettings changes
	// nothing; the row then still exists and the answer is a 413.
	ws, err := scanWorkspace(s.db.QueryRowContext(r.Context(), `
		UPDATE workspaces
		SET name = COALESCE(?1, name),
		    settings = CASE WHEN ?2 IS NULL THEN settings ELSE json_patch(settings, ?2) END,
		    updated_at = ?3
		WHERE id = ?4 AND user_id = ?5
		  AND (?2 IS NULL OR length(CAST(json_patch(settings, ?2) AS BLOB)) <= ?6)
		RETURNING `+workspaceColumns,
		name, patch, now(), id, u.ID, maxWorkspaceSettings))
	if errors.Is(err, sql.ErrNoRows) {
		owned, oerr := s.workspaceOwned(r.Context(), u.ID, id)
		switch {
		case oerr != nil:
			http.Error(w, "internal error", http.StatusInternalServerError)
		case owned && patch.Valid:
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "workspace settings too large"})
		default:
			http.Error(w, "workspace not found", http.StatusNotFound)
		}
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

// handleDeleteWorkspace serves DELETE /api/workspaces/{id}: it deletes
// one of the caller's workspaces and everything scoped to it — its study
// events, its plugin data rows (user-global rows stay), its library books
// with their bookmarks and highlights — in one transaction, then removes
// the books' content files (a failure there is logged, not fatal: the
// rows are already gone). 204 on success; unknown and foreign ids are
// 404; the caller's last workspace is a 409, since a user without any
// would get every installed language back as defaults on the next list.
// Foreign keys are not enforced in this database, so every child table
// is deleted from explicitly; user-scoped data (overlays, own sentences,
// plugin states) is not the workspace's and stays.
func (s *server) handleDeleteWorkspace(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "workspace not found", http.StatusNotFound)
		return
	}
	books, photoIDs, err := s.deleteWorkspace(r.Context(), u.ID, id)
	switch {
	case errors.Is(err, errWorkspaceNotFound):
		http.Error(w, "workspace not found", http.StatusNotFound)
		return
	case errors.Is(err, errLastWorkspace):
		http.Error(w, "keep at least one workspace", http.StatusConflict)
		return
	case err != nil:
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if err := s.library().RemoveContent(u.ID, books); err != nil {
		log.Printf("delete workspace %d: %v", id, err)
	}
	if err := s.photos().RemoveFiles(u.ID, photoIDs); err != nil {
		log.Printf("delete workspace %d: %v", id, err)
	}
	w.WriteHeader(http.StatusNoContent)
}

var (
	errWorkspaceNotFound = errors.New("workspace not found")
	errLastWorkspace     = errors.New("last workspace")
)

// deleteWorkspace runs the deletion transaction of handleDeleteWorkspace
// and returns the ids of the deleted books and photos, whose files the
// caller removes. The first statement deletes the workspace row only
// when the user keeps another one: being a write, it takes SQLite's
// write lock before reading, so concurrent deletes serialize and two of
// them can never remove a user's last two workspaces together.
func (s *server) deleteWorkspace(ctx context.Context, userID, id int64) ([]int64, []string, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx, `
		DELETE FROM workspaces WHERE id = ?1 AND user_id = ?2
		AND EXISTS (SELECT 1 FROM workspaces WHERE user_id = ?2 AND id <> ?1)`, id, userID)
	if err != nil {
		return nil, nil, err
	}
	if n, err := res.RowsAffected(); err != nil {
		return nil, nil, err
	} else if n == 0 {
		var owned bool
		if err := tx.QueryRowContext(ctx,
			`SELECT EXISTS (SELECT 1 FROM workspaces WHERE id = ? AND user_id = ?)`, id, userID).Scan(&owned); err != nil {
			return nil, nil, err
		}
		if owned {
			return nil, nil, errLastWorkspace
		}
		return nil, nil, errWorkspaceNotFound
	}
	// Every table with a workspace_id column (migrations 009, 010, 019);
	// bookmarks and highlights hang off the books.
	for _, table := range []string{"study_events", "plugin_data"} {
		if _, err := tx.ExecContext(ctx, `DELETE FROM `+table+` WHERE workspace_id = ?`, id); err != nil {
			return nil, nil, err
		}
	}
	books, err := library.DeleteWorkspaceBooks(ctx, tx, userID, id)
	if err != nil {
		return nil, nil, err
	}
	photoIDs, err := journal.DeleteWorkspacePhotosTx(ctx, tx, userID, id)
	if err != nil {
		return nil, nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, nil, err
	}
	return books, photoIDs, nil
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
