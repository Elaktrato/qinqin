package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"time"

	"qinqin/internal/model"
	"qinqin/internal/plugins"
)

// handleRegisterPlugin serves POST /api/admin/plugins: an admin
// registers a feature-plugin manifest — any JSON object carrying a
// non-empty id — which is stored verbatim and keyed by that id;
// re-registering an id replaces its manifest.
func (s *server) handleRegisterPlugin(w http.ResponseWriter, r *http.Request) {
	if s.requireAdmin(w, r) == nil {
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "malformed request body", http.StatusBadRequest)
		return
	}
	if err := plugins.Register(r.Context(), s.db, body); err != nil {
		if errors.Is(err, plugins.ErrInvalidManifest) {
			http.Error(w, `manifest must be a JSON object with a non-empty "id"`, http.StatusBadRequest)
			return
		}
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusCreated, json.RawMessage(body))
}

// handleListPlugins serves GET /api/plugins with the caller's plugins
// — feature and data — each with the caller's state overlaid, in home
// order.
func (s *server) handleListPlugins(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	list, err := plugins.ListFor(r.Context(), s.db, u.ID)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// handleSetPluginState serves PUT /api/plugins/{id}/state with the
// body {"enabled": bool, "order": int}: the caller's enable flag and
// home position for one plugin. The plugin must exist — unknown ids
// are 404 — but state is the caller's alone.
func (s *server) handleSetPluginState(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	pluginID := r.PathValue("id")
	var req struct {
		Enabled *bool `json:"enabled"`
		Order   *int  `json:"order"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Enabled == nil || req.Order == nil {
		http.Error(w, "enabled and order are required", http.StatusBadRequest)
		return
	}
	exists, err := plugins.Exists(r.Context(), s.db, pluginID)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if !exists {
		http.Error(w, "plugin not found", http.StatusNotFound)
		return
	}
	if err := plugins.SetState(r.Context(), s.db, u.ID, pluginID, *req.Enabled, *req.Order); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, model.PluginState{
		PluginID:  pluginID,
		UserID:    u.ID,
		Enabled:   *req.Enabled,
		Order:     *req.Order,
		UpdatedAt: time.Now().UTC(),
	})
}

// pluginWorkspace resolves the ?workspace= query parameter the plugin
// data routes scope rows by: absent or empty is the user-global nil;
// otherwise the id must name one of the caller's workspaces — unknown
// and foreign ids are 404.
func (s *server) pluginWorkspace(w http.ResponseWriter, r *http.Request, userID int64) (*int64, bool) {
	raw := r.URL.Query().Get("workspace")
	if raw == "" {
		return nil, true
	}
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		http.Error(w, "workspace must be an integer", http.StatusBadRequest)
		return nil, false
	}
	ok, err := s.workspaceOwned(r.Context(), userID, id)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return nil, false
	}
	if !ok {
		http.Error(w, "workspace not found", http.StatusNotFound)
		return nil, false
	}
	return &id, true
}

// handleGetPluginData serves GET /api/plugins/{id}/data/{key}: the
// caller's stored value for that key, scoped like the write was.
// Tombstoned and never-stored keys alike read 404.
func (s *server) handleGetPluginData(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	workspaceID, ok := s.pluginWorkspace(w, r, u.ID)
	if !ok {
		return
	}
	d, err := plugins.GetData(r.Context(), s.db, u.ID, workspaceID, r.PathValue("id"), r.PathValue("key"))
	if errors.Is(err, plugins.ErrNotFound) {
		http.Error(w, "plugin data not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, d)
}

// handlePutPluginData serves PUT /api/plugins/{id}/data/{key} with the
// value — any JSON document — as the request body: the caller's stored
// value for that key, versioning the row up and reviving a tombstone.
// The row is scoped to the caller's workspace named by ?workspace=, or
// user-global without it; the plugin must exist — unknown ids are 404
// — so data never keys to a plugin nothing registered.
func (s *server) handlePutPluginData(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	pluginID := r.PathValue("id")
	key := r.PathValue("key")
	workspaceID, ok := s.pluginWorkspace(w, r, u.ID)
	if !ok {
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "malformed request body", http.StatusBadRequest)
		return
	}
	if !json.Valid(body) {
		http.Error(w, "data must be valid JSON", http.StatusBadRequest)
		return
	}
	exists, err := plugins.Exists(r.Context(), s.db, pluginID)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if !exists {
		http.Error(w, "plugin not found", http.StatusNotFound)
		return
	}
	if _, err := plugins.PutData(r.Context(), s.db, u.ID, workspaceID, pluginID, key, json.RawMessage(body)); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	d, err := plugins.GetData(r.Context(), s.db, u.ID, workspaceID, pluginID, key)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, d)
}

// handleDeletePluginData serves DELETE /api/plugins/{id}/data/{key}:
// the caller's value for that key is tombstoned, stamped so a sync
// pull since before the delete sees it. Missing and already-deleted
// keys alike are 404.
func (s *server) handleDeletePluginData(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	workspaceID, ok := s.pluginWorkspace(w, r, u.ID)
	if !ok {
		return
	}
	err := plugins.DeleteData(r.Context(), s.db, u.ID, workspaceID, r.PathValue("id"), r.PathValue("key"))
	if errors.Is(err, plugins.ErrNotFound) {
		http.Error(w, "plugin data not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
