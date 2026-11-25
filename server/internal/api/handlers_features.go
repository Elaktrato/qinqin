package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"qinqin/internal/features"
)

const maxFeatureBody = 4 << 10 // PUT /api/features/{id}: {"enabled": bool}

// handleListFeatures serves GET /api/features: the caller's switch of every
// core feature (docs/contracts/features/), in the navigation order.
func (s *server) handleListFeatures(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	list, err := features.List(r.Context(), s.db, u.ID)
	if err != nil {
		writeInternal(w, r)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// handleSetFeature serves PUT /api/features/{id} {enabled}: the caller's
// switch of one feature, as stored. An unknown id is 404.
func (s *server) handleSetFeature(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	body, ok := readBody(w, r, maxFeatureBody)
	if !ok {
		return
	}
	var in struct {
		Enabled *bool `json:"enabled"`
	}
	if json.Unmarshal(body, &in) != nil || in.Enabled == nil {
		writeError(w, http.StatusBadRequest, "bad_request", "enabled is required.")
		return
	}
	sw, err := features.Set(r.Context(), s.db, u.ID, r.PathValue("id"), *in.Enabled)
	if errors.Is(err, features.ErrUnknown) {
		writeError(w, http.StatusNotFound, "not_found", "No such feature.")
		return
	}
	if err != nil {
		writeInternal(w, r)
		return
	}
	writeJSON(w, http.StatusOK, sw)
}
