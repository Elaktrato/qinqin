package api

import (
	"errors"
	"net/http"
	"strconv"

	"qinqin/internal/entries"
	"qinqin/internal/model"
)

// entryResponse is an entry together with its variants: the body of
// GET /api/entries/{id}.
type entryResponse struct {
	model.Entry
	Variants []model.Entry `json:"variants"`
}

// handleGetEntry serves GET /api/entries/{id} with the entry and its
// variants. Unknown and malformed ids are 404.
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
	variants, err := store.Variants(r.Context(), id)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, entryResponse{Entry: *e, Variants: variants})
}
