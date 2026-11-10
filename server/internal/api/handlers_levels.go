package api

import (
	"errors"
	"net/http"
	"strconv"

	"qinqin/internal/levels"
)

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
