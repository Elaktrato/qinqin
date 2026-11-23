package api

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"qinqin/internal/auth"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"qinqin/internal/journal"
	"qinqin/internal/lang"
	"qinqin/internal/library"
	"qinqin/internal/study"

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
		writeError(w, http.StatusBadRequest, "bad_request", "Malformed request body.")
		return
	}
	rawLanguage := strings.ToLower(strings.TrimSpace(req.Language))
	if rawLanguage == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "language is required.")
		return
	}
	name, problem := workspaceName(req.Name)
	if problem != "" {
		writeError(w, http.StatusUnprocessableEntity, "invalid_request", problem)
		return
	}

	// Serialized with admin language removal: the known check, the
	// languages row and the workspace cannot interleave with a delete. (A
	// deferred SQLite transaction would fail with SQLITE_BUSY when it
	// upgrades from read to write under concurrent writers.)
	s.langMu.Lock()
	defer s.langMu.Unlock()

	// A code that exactly matches a stored row or installed data keeps its
	// spelling (a legacy pt_br is not split into pt-br); anything else
	// must be a well-formed code.
	language := rawLanguage
	exact, err := languageKnown(r.Context(), s.db, rawLanguage)
	if err != nil {
		writeInternal(w, r)
		return
	}
	known := exact || lang.Registered(rawLanguage)
	if !exact {
		code, valid := lang.ValidCode(req.Language)
		if !valid {
			writeError(w, http.StatusUnprocessableEntity, "invalid_language", "language must be a code like es or pt-br.")
			return
		}
		language = code
		if !lang.Registered(code) {
			if known, err = languageKnown(r.Context(), s.db, code); err != nil {
				writeInternal(w, r)
				return
			}
		} else {
			known = true
		}
	}
	if !lang.Registered(language) {
		// Only an administrator opens a new language; everyone else
		// picks from the known ones.
		if !known && !u.Admin {
			writeError(w, http.StatusUnprocessableEntity, "language_unknown", "This language is not set up on the server: ask an administrator to add it.")
			return
		}
		if _, err := s.db.ExecContext(r.Context(), `
			INSERT INTO languages (code, name, updated_at) VALUES (?, ?, ?)
			ON CONFLICT (code) DO NOTHING`, language, language, now()); err != nil {
			writeInternal(w, r)
			return
		}
	}
	ws, err := scanWorkspace(s.db.QueryRowContext(r.Context(), `
		INSERT INTO workspaces (user_id, language, name, settings, updated_at)
		VALUES (?, ?, ?, '{}', ?)
		RETURNING `+workspaceColumns,
		u.ID, language, name, now()))
	if isUniqueViolation(err) {
		writeError(w, http.StatusConflict, "workspace_exists", "A workspace with this name already exists.")
		return
	}
	if err != nil {
		writeInternal(w, r)
		return
	}
	writeJSON(w, http.StatusCreated, ws)
}

// languageKnown reports whether code (compared exactly) is known: a
// languages row, installed dictionary data, or any live level, frequency,
// sentence, grammar or audio pack of that language.
func languageKnown(ctx context.Context, db interface {
	queryer
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}, code string) (bool, error) {
	var known bool
	err := db.QueryRowContext(ctx, `
		SELECT EXISTS (SELECT 1 FROM languages WHERE code = ?1)
			OR EXISTS (SELECT 1 FROM dictionaries WHERE language = ?1 AND deleted_at IS NULL)
			OR EXISTS (SELECT 1 FROM schemes WHERE language = ?1 AND deleted_at IS NULL)
			OR EXISTS (SELECT 1 FROM frequency_packs WHERE language = ?1 AND deleted_at IS NULL)
			OR EXISTS (SELECT 1 FROM sentence_packs WHERE language = ?1 AND deleted_at IS NULL)
			OR EXISTS (SELECT 1 FROM grammar_packs WHERE language = ?1 AND deleted_at IS NULL)
			OR EXISTS (SELECT 1 FROM audio_packs WHERE language = ?1 AND deleted_at IS NULL)`, code).Scan(&known)
	if err != nil || known {
		return known, err
	}
	installed, err := installedLanguages(ctx, db)
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
		writeInternal(w, r)
		return
	}
	rows, err := s.db.QueryContext(r.Context(), `
		SELECT `+workspaceColumns+` FROM workspaces
		WHERE user_id = ? ORDER BY id`, u.ID)
	if err != nil {
		writeInternal(w, r)
		return
	}
	defer rows.Close()
	list := make([]workspace, 0)
	for rows.Next() {
		ws, err := scanWorkspace(rows)
		if err != nil {
			writeInternal(w, r)
			return
		}
		list = append(list, ws)
	}
	if err := rows.Err(); err != nil {
		writeInternal(w, r)
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
		writeError(w, http.StatusNotFound, "workspace_not_found", "No such workspace.")
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
		writeError(w, http.StatusBadRequest, "bad_request", "Malformed request body.")
		return
	}
	var name sql.NullString
	if req.Name != nil {
		n, problem := workspaceName(*req.Name)
		if problem != "" {
			writeError(w, http.StatusUnprocessableEntity, "invalid_request", problem)
			return
		}
		name = sql.NullString{String: n, Valid: true}
	}
	var patch sql.NullString
	if len(req.Settings) > 0 && string(req.Settings) != "null" {
		var obj map[string]any
		if err := json.Unmarshal(req.Settings, &obj); err != nil {
			writeError(w, http.StatusBadRequest, "bad_request", "settings must be an object.")
			return
		}
		merged, err := json.Marshal(obj)
		if err != nil {
			writeInternal(w, r)
			return
		}
		patch = sql.NullString{String: string(merged), Valid: true}
	}
	if !name.Valid && !patch.Valid {
		writeError(w, http.StatusBadRequest, "bad_request", "name or settings required.")
		return
	}
	// json_patch merges the settings object in place (RFC 7396: existing
	// keys update, new keys are added, a null value deletes its key) while stamping updated_at. A patch
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
			writeInternal(w, r)
		case owned && patch.Valid:
			writeError(w, http.StatusRequestEntityTooLarge, "too_large", "The workspace settings would be larger than 64 KiB.")
		default:
			writeError(w, http.StatusNotFound, "workspace_not_found", "No such workspace.")
		}
		return
	}
	if isUniqueViolation(err) {
		writeError(w, http.StatusConflict, "workspace_exists", "A workspace with this name already exists.")
		return
	}
	if err != nil {
		writeInternal(w, r)
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
		writeError(w, http.StatusNotFound, "workspace_not_found", "No such workspace.")
		return
	}
	books, photoIDs, err := s.deleteWorkspace(r.Context(), u.ID, id)
	switch {
	case errors.Is(err, errWorkspaceNotFound):
		writeError(w, http.StatusNotFound, "workspace_not_found", "No such workspace.")
		return
	case errors.Is(err, errLastWorkspace):
		writeError(w, http.StatusConflict, "last_workspace", "Keep at least one workspace.")
		return
	case err != nil:
		writeInternal(w, r)
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
	// Every table with a workspace_id column (migrations 009, 010, 019,
	// 037, the typed study tables of 038); bookmarks and highlights hang
	// off the books.
	for _, table := range append([]string{"study_events", "plugin_data"}, study.Tables()...) {
		if _, err := tx.ExecContext(ctx, `DELETE FROM `+table+` WHERE workspace_id = ?`, id); err != nil {
			return nil, nil, err
		}
	}
	// Access tokens limited to the workspace go with it (foreign keys are
	// off), audited like every other revocation.
	res, err = tx.ExecContext(ctx, `DELETE FROM access_tokens WHERE workspace_id = ? AND user_id = ?`, id, userID)
	if err != nil {
		return nil, nil, err
	}
	if n, _ := res.RowsAffected(); n > 0 {
		if err := auth.Audit(ctx, tx, auth.AuditEvent{Action: "token_revoked", ActorID: userID, TargetID: &userID,
			Detail: map[string]any{"scope": "workspace", "count": n}}); err != nil {
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
