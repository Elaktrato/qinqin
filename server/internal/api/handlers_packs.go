package api

import (
	"errors"
	"net/http"

	"qinqin/internal/packs"
)

// handleListPacks serves GET /api/admin/packs: every live pack of every
// type with the licence and attribution it was installed under, as the
// pack stated them. Packs without a recorded licence (sentence packs
// imported before the registry) list with empty fields; the web shows
// them as "Licence not recorded".
func (s *server) handleListPacks(w http.ResponseWriter, r *http.Request) {
	if u := s.requireAdmin(w, r); u == nil {
		return
	}
	list, err := packs.List(r.Context(), s.db)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if list == nil {
		list = []packs.Installed{}
	}
	writeJSON(w, http.StatusOK, list)
}

// handleUninstallPack serves DELETE /api/admin/packs/{type}/{packId}:
// uninstalls one pack of any type. Pack files under <data>/packs stay.
func (s *server) handleUninstallPack(w http.ResponseWriter, r *http.Request) {
	if u := s.requireAdmin(w, r); u == nil {
		return
	}
	s.packMu.Lock()
	defer s.packMu.Unlock()
	err := packs.Uninstall(r.Context(), s.db, r.PathValue("type"), r.PathValue("packId"))
	switch {
	case errors.Is(err, packs.ErrUnknownType):
		http.Error(w, "unknown pack type", http.StatusNotFound)
	case errors.Is(err, packs.ErrNotFound):
		http.Error(w, "pack not found", http.StatusNotFound)
	case err != nil:
		http.Error(w, "internal error", http.StatusInternalServerError)
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

// sentencePackBody is one registered sentence pack on the public list.
type sentencePackBody struct {
	PackID      string `json:"packId"`
	Name        string `json:"name"`
	Version     string `json:"version"`
	Language    string `json:"language"`
	License     string `json:"license"`
	Attribution string `json:"attribution"`
	Notice      string `json:"notice"`
}

// handleListSentencePacks serves GET /api/sentence-packs: the live
// registered sentence packs by name, public like the other pack lists so
// the Sources page can credit them. Legacy packs without a registry row
// have nothing to credit and are not listed.
func (s *server) handleListSentencePacks(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.QueryContext(r.Context(), `
		SELECT pack_id, name, version, language, license, attribution, notice
		FROM sentence_packs WHERE deleted_at IS NULL ORDER BY name, pack_id`)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	list := []sentencePackBody{}
	for rows.Next() {
		var p sentencePackBody
		if err := rows.Scan(&p.PackID, &p.Name, &p.Version, &p.Language, &p.License, &p.Attribution, &p.Notice); err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		list = append(list, p)
	}
	if err := rows.Err(); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, list)
}
