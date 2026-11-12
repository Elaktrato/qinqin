package api

import (
	"errors"
	"net/http"
	"strconv"

	"qinqin/internal/levels"
	"qinqin/internal/lexicon"
)

// handleSchemeEntries serves GET /api/schemes/{id}/entries: the scheme's
// member entries — words and derived characters — across all its active
// levels, or only one level's when ?level names it. It is public; an
// unknown scheme or level name is 404.
func (s *server) handleSchemeEntries(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "scheme not found", http.StatusNotFound)
		return
	}
	var ids []int64
	if q := r.URL.Query(); q.Has("level") {
		ids, err = levels.EntryIDs(r.Context(), s.db, id, q.Get("level"))
	} else {
		ids, err = levels.SchemeEntryIDs(r.Context(), s.db, id)
	}
	if errors.Is(err, levels.ErrNotFound) {
		http.Error(w, "scheme or level not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	store := lexicon.Store{DB: s.db}
	es, err := store.GetMany(r.Context(), ids)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	list, err := entryBases(r.Context(), store, es)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// handleListSchemes serves GET /api/schemes with every installed scheme,
// in install order, each with its ordered levels.
func (s *server) handleListSchemes(w http.ResponseWriter, r *http.Request) {
	list, err := levels.List(r.Context(), s.db)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// handleUninstallScheme serves DELETE /api/admin/schemes/{id}: the
// scheme, its levels, and its memberships are soft-deleted; entries
// survive. Admin upload routes dispatch packs by manifest type, so
// levels packs install through their own importer — the seed CLI wires
// it.
func (s *server) handleUninstallScheme(w http.ResponseWriter, r *http.Request) {
	u := s.requireAdmin(w, r)
	if u == nil {
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "scheme not found", http.StatusNotFound)
		return
	}
	if err := levels.Uninstall(r.Context(), s.db, id); err != nil {
		if errors.Is(err, levels.ErrNotFound) {
			http.Error(w, "scheme not found", http.StatusNotFound)
			return
		}
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
