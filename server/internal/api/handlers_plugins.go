package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strconv"

	"qinqin/internal/model"
	"qinqin/internal/plugins"
	"qinqin/internal/study/rows"
	"qinqin/internal/workspaces"
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
			writeError(w, http.StatusConflict, "conflict", err.Error())
			return
		}
		if errors.Is(err, plugins.ErrInvalidManifest) {
			writeError(w, http.StatusBadRequest, "bad_request", err.Error())
			return
		}
		writeInternal(w, r)
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
		writeInternal(w, r)
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
		writeError(w, http.StatusBadRequest, "bad_request", "enabled and order are required.")
		return
	}
	exists, err := plugins.Exists(r.Context(), s.db, pluginID)
	if err != nil {
		writeInternal(w, r)
		return
	}
	if !exists {
		writeError(w, http.StatusNotFound, "not_found", "Plugin not found.")
		return
	}
	state, err := plugins.SetStateRow(r.Context(), s.db, u.ID, pluginID, *req.Enabled, *req.Order)
	if err != nil {
		writeInternal(w, r)
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
		writeError(w, http.StatusBadRequest, "bad_request", "workspace must be an integer.")
		return nil, false
	}
	ok, err := workspaces.Owned(r.Context(), s.db, userID, id)
	if err != nil {
		writeInternal(w, r)
		return nil, false
	}
	if !ok {
		writeError(w, http.StatusNotFound, "workspace_not_found", "No such workspace.")
		return nil, false
	}
	return &id, true
}

// typedStudyKey answers 404 for a key of the study namespace that belongs
// to a typed study family (cards, decks, deck settings, limits, FSRS sets,
// the active set): those rows are typed rows of the sync pull and push
// (docs/contracts/study/), never plugin data, and the v0.3.x view of them
// is gone (#198). True when it answered.
func typedStudyKey(w http.ResponseWriter, pluginID, key string) bool {
	if pluginID != rows.Namespace {
		return false
	}
	if _, typed := rows.FamilyOf(key); !typed {
		return false
	}
	writeError(w, http.StatusNotFound, "not_found", "Study rows of this key are typed rows of GET /api/sync/pull?v=2 and POST /api/sync/push, not plugin data.")
	return true
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
	if typedStudyKey(w, r.PathValue("id"), r.PathValue("key")) {
		return
	}
	d, err := plugins.GetData(r.Context(), s.db, u.ID, workspaceID, r.PathValue("id"), r.PathValue("key"))
	if errors.Is(err, plugins.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "Plugin data not found.")
		return
	}
	if err != nil {
		writeInternal(w, r)
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
		writeInternal(w, r)
		return
	}
	if !exists {
		writeError(w, http.StatusNotFound, "not_found", "Plugin not found.")
		return
	}
	prefix := r.URL.Query().Get("prefix")
	list, err := plugins.ListData(r.Context(), s.db, u.ID, workspaceID, pluginID, prefix)
	if err != nil {
		writeInternal(w, r)
		return
	}
	if pluginID == rows.Namespace {
		// a leftover row of a typed family is no plugin data (typedStudyKey)
		list = slices.DeleteFunc(list, func(d model.PluginData) bool {
			_, typed := rows.FamilyOf(d.Key)
			return typed
		})
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
	if typedStudyKey(w, pluginID, key) {
		return
	}
	body, ok := readBody(w, r, maxPluginDataValue)
	if !ok {
		return
	}
	if !json.Valid(body) {
		writeError(w, http.StatusBadRequest, "bad_request", "data must be valid JSON.")
		return
	}
	exists, allowed, err := plugins.CanWriteData(r.Context(), s.db, pluginID)
	if err != nil {
		writeInternal(w, r)
		return
	}
	if !exists {
		writeError(w, http.StatusNotFound, "not_found", "Plugin not found.")
		return
	}
	if !allowed {
		writeError(w, http.StatusForbidden, "plugin_no_data", "Plugin does not declare owns-data.")
		return
	}
	d, err := plugins.PutDataRow(r.Context(), s.db, u.ID, workspaceID, pluginID, key, json.RawMessage(body), nil)
	if err != nil {
		writeInternal(w, r)
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
	if typedStudyKey(w, pluginID, r.PathValue("key")) {
		return
	}
	exists, allowed, err := plugins.CanWriteData(r.Context(), s.db, pluginID)
	if err != nil {
		writeInternal(w, r)
		return
	}
	if !exists {
		writeError(w, http.StatusNotFound, "not_found", "Plugin data not found.")
		return
	}
	if !allowed {
		writeError(w, http.StatusForbidden, "plugin_no_data", "Plugin does not declare owns-data.")
		return
	}
	err = plugins.DeleteData(r.Context(), s.db, u.ID, workspaceID, pluginID, r.PathValue("key"))
	if errors.Is(err, plugins.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "Plugin data not found.")
		return
	}
	if err != nil {
		writeInternal(w, r)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
