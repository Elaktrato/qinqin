package api

import (
	"bytes"
	"encoding/json"
	"net/http"

	"qinqin/internal/lexicon"
	"qinqin/internal/overlay"
)

const (
	maxEntryBasesBody = 16 << 10 // POST /api/entries/bases: up to 500 ids
	maxEntryBasesIDs  = 500
)

// handleEntryBases serves POST /api/entries/bases {"ids":[...]}: the base
// rows (the shape of GET /api/schemes/{id}/entries) of 1 to 500 entries in
// first-occurrence order, unknown ids omitted, duplicates once. The
// caller's own overlay is applied, exactly as GET /api/entries/{id} does,
// so a deck list and the entry page agree; nothing of it reaches another
// user. It exists so a client can read a whole deck's written forms and
// readings in a few requests instead of one per entry.
func (s *server) handleEntryBases(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	body, ok := readBody(w, r, maxEntryBasesBody)
	if !ok {
		return
	}
	var req struct {
		IDs []int64 `json:"ids"`
	}
	if err := json.NewDecoder(bytes.NewReader(body)).Decode(&req); err != nil ||
		len(req.IDs) == 0 || len(req.IDs) > maxEntryBasesIDs {
		http.Error(w, "ids must be 1 to 500 entry ids", http.StatusBadRequest)
		return
	}
	seen := make(map[int64]bool, len(req.IDs))
	ids := make([]int64, 0, len(req.IDs))
	for _, id := range req.IDs {
		if id <= 0 {
			http.Error(w, "ids must be 1 to 500 entry ids", http.StatusBadRequest)
			return
		}
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
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
	for i := range list {
		if err := overlay.Apply(r.Context(), s.db, u.ID, &list[i]); err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
	}
	writeJSON(w, http.StatusOK, list)
}
