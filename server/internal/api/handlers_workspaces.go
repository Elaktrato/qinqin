package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"time"

	"qinqin/internal/workspaces"
)

// workspace is one study container of a user as served by the
// /api/workspaces routes: the body of POST and PUT responses, one
// element of the GET list.
type workspace struct {
	ID        int64           `json:"id"`
	Language  string          `json:"language"`
	Name      string          `json:"name"`
	Settings  json.RawMessage `json:"settings"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

func toWorkspace(ws workspaces.Workspace) workspace {
	return workspace{ID: ws.ID, Language: ws.Language, Name: ws.Name, Settings: ws.Settings, UpdatedAt: ws.UpdatedAt}
}

// writeWorkspaceError answers an error of the workspaces package, or a
// 500 for anything else.
func writeWorkspaceError(w http.ResponseWriter, r *http.Request, err error) {
	var nameErr *workspaces.NameError
	switch {
	case errors.As(err, &nameErr):
		writeError(w, http.StatusUnprocessableEntity, "invalid_request", nameErr.Error())
	case errors.Is(err, workspaces.ErrNotFound):
		writeError(w, http.StatusNotFound, "workspace_not_found", "No such workspace.")
	case errors.Is(err, workspaces.ErrExists):
		writeError(w, http.StatusConflict, "workspace_exists", "A workspace with this name already exists.")
	case errors.Is(err, workspaces.ErrLastWorkspace):
		writeError(w, http.StatusConflict, "last_workspace", "Keep at least one workspace.")
	case errors.Is(err, workspaces.ErrSettingsTooLarge):
		writeError(w, http.StatusRequestEntityTooLarge, "too_large", "The workspace settings would be larger than 64 KiB.")
	case errors.Is(err, workspaces.ErrLanguageRequired):
		writeError(w, http.StatusBadRequest, "bad_request", "language is required.")
	case errors.Is(err, workspaces.ErrInvalidLanguage):
		writeError(w, http.StatusUnprocessableEntity, "invalid_language", "language must be a code like es or pt-br.")
	case errors.Is(err, workspaces.ErrUnknownLanguage):
		writeError(w, http.StatusUnprocessableEntity, "language_unknown", "This language is not set up on the server: ask an administrator to add it.")
	default:
		writeInternal(w, r)
	}
}

// handleCreateWorkspace serves POST /api/workspaces {language, name?}:
// it opens a workspace of the request's language for the caller
// (workspaces.Create: an administrator may open a new data-only
// language). A refused name is a 422; an existing (language, name) pair
// of the caller is a 409.
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
	// Serialized with admin language removal: the known check, the
	// languages row and the workspace cannot interleave with a delete. (A
	// deferred SQLite transaction would fail with SQLITE_BUSY when it
	// upgrades from read to write under concurrent writers.)
	s.langMu.Lock()
	defer s.langMu.Unlock()
	ws, err := workspaces.Create(r.Context(), s.db, workspaces.NewWorkspace{
		UserID: u.ID, Admin: u.Admin, Language: req.Language, Name: req.Name})
	if err != nil {
		writeWorkspaceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, toWorkspace(ws))
}

// handleListWorkspaces serves GET /api/workspaces with the caller's
// workspaces only, in creation order. A caller without any workspace
// first gets one default, unnamed workspace per installed language.
func (s *server) handleListWorkspaces(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	list, err := workspaces.List(r.Context(), s.db, u.ID)
	if err != nil {
		writeInternal(w, r)
		return
	}
	out := make([]workspace, 0, len(list))
	for _, ws := range list {
		out = append(out, toWorkspace(ws))
	}
	writeJSON(w, http.StatusOK, out)
}

// handleUpdateWorkspace serves PUT /api/workspaces/{id} with a body of
// {name?: string, settings?: object}: it renames the workspace and merges
// settings into the stored object (workspaces.Update). At least one of
// the two is required and no other key is accepted. Other users'
// workspaces are invisible: unknown and foreign ids are 404; merged
// settings over 64 KiB are a 413.
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
	var patch workspaces.Patch
	if req.Name != nil {
		// Checked before the settings, so a bad name is the answer when
		// both are bad.
		if _, err := workspaces.ValidName(*req.Name); err != nil {
			writeWorkspaceError(w, r, err)
			return
		}
		patch.Name = req.Name
	}
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
		patch.Settings = merged
	}
	if patch.Name == nil && patch.Settings == nil {
		writeError(w, http.StatusBadRequest, "bad_request", "name or settings required.")
		return
	}
	ws, err := workspaces.Update(r.Context(), s.db, u.ID, id, patch)
	if err != nil {
		writeWorkspaceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, toWorkspace(ws))
}

// handleDeleteWorkspace serves DELETE /api/workspaces/{id}: it deletes
// one of the caller's workspaces and everything scoped to it in one
// transaction (workspaces.Delete, one rule per table), then removes the
// books' content files and the journal photos (a failure there is logged,
// not fatal: the rows are already gone). 204 on success; unknown and
// foreign ids are 404; the caller's last workspace is a 409, since a user
// without any would get every installed language back as defaults on the
// next list.
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
	deleted, err := workspaces.Delete(r.Context(), s.db, u.ID, id)
	if err != nil {
		writeWorkspaceError(w, r, err)
		return
	}
	if err := s.library().RemoveContent(u.ID, deleted.Books); err != nil {
		log.Printf("delete workspace %d: %v", id, err)
	}
	if err := s.photos().RemoveFiles(u.ID, deleted.Photos); err != nil {
		log.Printf("delete workspace %d: %v", id, err)
	}
	w.WriteHeader(http.StatusNoContent)
}
