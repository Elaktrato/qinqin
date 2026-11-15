package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"qinqin/internal/plugins"
)

// handleRegisterPlugin serves POST /api/admin/plugins: an admin
// registers a feature-plugin manifest, which must pass the SDK contract
// (plugins.ParseManifest) and is then stored verbatim and keyed by its
// id; re-registering an id replaces its manifest. A refused manifest
// answers 400 with the reasons, and the id of a built-in plugin 409.
func (s *server) handleRegisterPlugin(w http.ResponseWriter, r *http.Request) {
	if s.requireAdmin(w, r) == nil {
		return
	}
	body, ok := readBody(w, r, maxPluginManifestBody)
	if !ok {
		return
	}
	if err := plugins.Register(r.Context(), s.db, body); err != nil {
		if errors.Is(err, plugins.ErrBuiltinID) {
			http.Error(w, err.Error(), http.StatusConflict)
			return
		}
		if errors.Is(err, plugins.ErrInvalidManifest) {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusCreated, json.RawMessage(body))
}

// handleListPlugins serves GET /api/plugins with the caller's plugins
// — feature and data — each with the caller's state overlaid, in the
// caller's plugin order (the position in the Plugins list).
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
// position in the Plugins list for one plugin (the home layout is the
// per-user widget layout in the qinqin-core plugin data). The plugin must exist — unknown ids
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
	body, ok := readBody(w, r, maxPluginStateBody)
	if !ok {
		return
	}
	if err := json.NewDecoder(bytes.NewReader(body)).Decode(&req); err != nil || req.Enabled == nil || req.Order == nil {
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
	state, err := plugins.SetStateRow(r.Context(), s.db, u.ID, pluginID, *req.Enabled, *req.Order)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, state)
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

// handleListPluginData serves GET /api/plugins/{id}/data?workspace=&prefix=:
// the caller's live rows of the plugin whose key starts with prefix, scoped
// like the single-row routes. Unknown plugins are 404.
func (s *server) handleListPluginData(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	workspaceID, ok := s.pluginWorkspace(w, r, u.ID)
	if !ok {
		return
	}
	pluginID := r.PathValue("id")
	exists, err := plugins.Exists(r.Context(), s.db, pluginID)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if !exists {
		http.Error(w, "plugin not found", http.StatusNotFound)
		return
	}
	list, err := plugins.ListData(r.Context(), s.db, u.ID, workspaceID, pluginID, r.URL.Query().Get("prefix"))
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// handlePutPluginData serves PUT /api/plugins/{id}/data/{key} with the
// value — any JSON document — as the request body: the caller's stored
// value for that key, versioning the row up and reviving a tombstone.
// The row is scoped to the caller's workspace named by ?workspace=, or
// user-global without it; the plugin must exist — unknown ids are 404
// — so data never keys to a plugin nothing registered — and an sdk-1
// plugin must declare owns-data (403 otherwise).
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
	body, ok := readBody(w, r, maxPluginDataValue)
	if !ok {
		return
	}
	if !json.Valid(body) {
		http.Error(w, "data must be valid JSON", http.StatusBadRequest)
		return
	}
	exists, allowed, err := plugins.CanWriteData(r.Context(), s.db, pluginID)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if !exists {
		http.Error(w, "plugin not found", http.StatusNotFound)
		return
	}
	if !allowed {
		http.Error(w, "plugin does not declare owns-data", http.StatusForbidden)
		return
	}
	d, err := plugins.PutDataRow(r.Context(), s.db, u.ID, workspaceID, pluginID, key, json.RawMessage(body), nil)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, d)
}

// handleDeletePluginData serves DELETE /api/plugins/{id}/data/{key}:
// the caller's value for that key is tombstoned, stamped so a sync
// pull since before the delete sees it. Missing and already-deleted
// keys alike are 404; a plugin that does not declare owns-data is 403.
func (s *server) handleDeletePluginData(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	workspaceID, ok := s.pluginWorkspace(w, r, u.ID)
	if !ok {
		return
	}
	pluginID := r.PathValue("id")
	exists, allowed, err := plugins.CanWriteData(r.Context(), s.db, pluginID)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if !exists {
		http.Error(w, "plugin data not found", http.StatusNotFound)
		return
	}
	if !allowed {
		http.Error(w, "plugin does not declare owns-data", http.StatusForbidden)
		return
	}
	err = plugins.DeleteData(r.Context(), s.db, u.ID, workspaceID, pluginID, r.PathValue("key"))
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
