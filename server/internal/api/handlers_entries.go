package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"qinqin/internal/auth"
	"qinqin/internal/entries"
	"qinqin/internal/levels"
	"qinqin/internal/model"
	"qinqin/internal/overlay"
	"qinqin/internal/sentences"
)

// entryResponse is an entry together with its variants, scheme badges,
// and example sentences: the body of GET and PUT /api/entries/{id}.
type entryResponse struct {
	model.Entry
	Variants  []model.Entry    `json:"variants"`
	Badges    []model.Badge    `json:"badges"`
	Sentences []model.Sentence `json:"sentences"`
}

// handleGetEntry serves GET /api/entries/{id} with the entry, its
// variants, and its scheme badges. Unknown and malformed ids are 404.
// An authenticated caller sees the entry with their own patch applied;
// everyone else sees the shared entry.
func (s *server) handleGetEntry(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "entry not found", http.StatusNotFound)
		return
	}
	store := entries.Store{DB: s.db}
	e, err := store.GetByID(r.Context(), id)
	if errors.Is(err, entries.ErrNotFound) {
		http.Error(w, "entry not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	// The caller's patch layers on the shared entry; callers without a
	// valid token — anonymous or unknown — see the shared entry.
	u, err := auth.UserFromRequest(r, s.db)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if u != nil {
		if err := overlay.Apply(r.Context(), s.db, u.ID, e); err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
	}
	variants, err := store.Variants(r.Context(), id)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	badges, err := levels.ForEntry(r.Context(), s.db, id)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	entrySentences, err := sentences.ForEntry(r.Context(), s.db, id)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, entryResponse{Entry: *e, Variants: variants, Badges: badges, Sentences: entrySentences})
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
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
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

	store := entries.Store{DB: s.db}
	e, err := store.GetByID(r.Context(), id)
	if errors.Is(err, entries.ErrNotFound) {
		http.Error(w, "entry not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if err := overlay.Put(r.Context(), s.db, u.ID, id, patch); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if err := overlay.Apply(r.Context(), s.db, u.ID, e); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	variants, err := store.Variants(r.Context(), id)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	badges, err := levels.ForEntry(r.Context(), s.db, id)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	entrySentences, err := sentences.ForEntry(r.Context(), s.db, id)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, entryResponse{Entry: *e, Variants: variants, Badges: badges, Sentences: entrySentences})
}
