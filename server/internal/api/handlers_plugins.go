package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"

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
