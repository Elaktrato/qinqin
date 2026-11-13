package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"qinqin/internal/auth"
	"qinqin/internal/lexicon"
	"qinqin/internal/model"
	"qinqin/internal/overlay"
)

// handleGetEntry serves GET /api/entries/{id} with the lexicon entry, its
// forms, senses, variants, scheme badges, and example sentences (see
// entryResponse). Unknown and malformed ids are 404. An authenticated
// caller sees the entry with their own patch applied; everyone else sees
// the shared entry.
func (s *server) handleGetEntry(w http.ResponseWriter, r *http.Request) {
	e, ok := s.entryFromPath(w, r)
	if !ok {
		return
	}
	// The caller's patch layers on the shared entry and their own example
	// sentences join the pack's; callers without a valid token — anonymous
	// or unknown — see the shared entry and pack sentences only.
	u, err := auth.UserFromRequest(r, s.db)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	var viewerID int64
	if u != nil {
		viewerID = u.ID
	}
	resp, err := buildEntryResponse(r.Context(), s.db, e, viewerID)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if u != nil {
		if err := overlay.Apply(r.Context(), s.db, u.ID, &resp.EntryBase); err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
	}
	writeJSON(w, http.StatusOK, resp)
}

// handleCharsUnderRadical serves GET /api/entries/{id}/chars with the
// active characters classified under the radical entry {id}, ordered by
// headword. A radical without characters answers an empty array;
// unknown and malformed ids are 404.
func (s *server) handleCharsUnderRadical(w http.ResponseWriter, r *http.Request) {
	e, ok := s.entryFromPath(w, r)
	if !ok {
		return
	}
	store := lexicon.Store{DB: s.db}
	chars, err := store.CharsUnder(r.Context(), e.ID)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	list, err := entryBases(r.Context(), store, chars)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// handlePutEntry serves PUT /api/entries/{id}: it stores the
// authenticated caller's patch of the entry — nil fields revert that
// field to the shared value — and responds with the caller's patched
// view. Unknown and malformed ids are 404, unauthenticated calls 401.
func (s *server) handlePutEntry(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	if _, err := strconv.ParseInt(r.PathValue("id"), 10, 64); err != nil {
		http.Error(w, "entry not found", http.StatusNotFound)
		return
	}
	var patch model.EntryPatch
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		http.Error(w, "malformed request body", http.StatusBadRequest)
		return
	}
	if patch.Written != nil && strings.TrimSpace(*patch.Written) == "" {
		http.Error(w, "written must not be empty", http.StatusBadRequest)
		return
	}
	for _, reading := range patch.Readings {
		if strings.TrimSpace(reading.Type) == "" || strings.TrimSpace(reading.Value) == "" {
			http.Error(w, "each reading needs a type and a value", http.StatusBadRequest)
			return
		}
	}

	e, ok := s.entryFromPath(w, r)
	if !ok {
		return
	}
	if err := overlay.Put(r.Context(), s.db, u.ID, e.ID, patch); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	resp, err := buildEntryResponse(r.Context(), s.db, e, u.ID)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if err := overlay.Apply(r.Context(), s.db, u.ID, &resp.EntryBase); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// entryFromPath loads the active lexicon entry named by the {id} path
// value. It answers 404 for malformed and unknown ids and 500 for other
// errors, reporting false when it wrote a response.
func (s *server) entryFromPath(w http.ResponseWriter, r *http.Request) (*lexicon.Entry, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "entry not found", http.StatusNotFound)
		return nil, false
	}
	e, err := lexicon.Store{DB: s.db}.Get(r.Context(), id)
	if errors.Is(err, lexicon.ErrNotFound) {
		http.Error(w, "entry not found", http.StatusNotFound)
		return nil, false
	}
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return nil, false
	}
	return e, true
}
