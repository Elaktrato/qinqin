package api

import (
	"errors"
	"net/http"
	"slices"
	"strconv"
	"strings"

	"qinqin/internal/lexicon"
)

// handleSearch serves GET /api/search?q=&lang=&kind=&scheme=&level=&limit=
// with the ranked lexicon hits, each an entry's base fields plus the
// source of its match. The route is public, like entry reads. lang is
// required; a non-numeric or negative limit is a 400, as is a level
// without a scheme.
func (s *server) handleSearch(w http.ResponseWriter, r *http.Request) {
	params := r.URL.Query()
	q := lexicon.SearchQuery{
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
	store := lexicon.Store{DB: s.db}
	hits, err := store.Search(r.Context(), q)
	if errors.Is(err, lexicon.ErrInvalidQuery) {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	es := make([]lexicon.Entry, len(hits))
	for i, h := range hits {
		es[i] = h.Entry
	}
	bases, err := entryBases(r.Context(), store, es)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	out := make([]searchHit, len(hits))
	for i, h := range hits {
		if h.Source == "written" && h.Entry.Language == "ja" {
			bases[i].Written = matchedForm(h.Entry, strings.TrimSpace(q.Text))
		}
		out[i] = searchHit{EntryBase: bases[i], Source: h.Source}
	}
	writeJSON(w, http.StatusOK, out)
}

// matchedForm is what a Japanese written-form hit shows: the form that
// matched (為る searched shows 為る, as a lookup does), unless it is
// search-only (sK: 之 shows の) — then the entry's display form. Chinese
// keeps the display form (a traditional match shows the simplified word).
func matchedForm(e lexicon.Entry, text string) string {
	for _, f := range e.Forms {
		if f.Text == text && !slices.Contains(f.Flags, "sK") {
			return f.Text
		}
	}
	return e.Headword()
}
