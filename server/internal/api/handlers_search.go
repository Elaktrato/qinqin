package api

import (
	"errors"
	"net/http"
	"strconv"

	"qinqin/internal/entries"
)

// handleSearch serves GET /api/search?q=&lang=&kind=&scheme=&level=&limit=
// with the ranked hits, each an entry plus the source of its match. The
// route is public, like entry reads. lang is required; a non-numeric or
// negative limit is a 400, as is a level without a scheme.
func (s *server) handleSearch(w http.ResponseWriter, r *http.Request) {
	params := r.URL.Query()
	q := entries.SearchQuery{
		Text:      params.Get("q"),
		Lang:      params.Get("lang"),
		Kind:      params.Get("kind"),
		SchemeID:  params.Get("scheme"),
		LevelName: params.Get("level"),
	}
	if raw := params.Get("limit"); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil || limit < 0 {
			http.Error(w, "invalid limit", http.StatusBadRequest)
			return
		}
		q.Limit = limit
	}
	hits, err := entries.Store{DB: s.db}.Search(r.Context(), q)
	if errors.Is(err, entries.ErrInvalidQuery) {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, hits)
}
