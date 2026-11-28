package api

import (
	"bytes"
	"encoding/json"
	"net/http"

	"qinqin/internal/conjugation"
)

const (
	maxConjugationBody = 16 << 10 // POST /api/drills/conjugation/words: up to 500 ids
	maxConjugationIDs  = 500
)

// handleConjugationWords serves POST /api/drills/conjugation/words
// {"ids":[...]}: the conjugation trainer's words among 1 to 500 entries
// (docs/contracts/conjugation/): each drilled Japanese verb or adjective with
// its class, families and forms, in first-occurrence order; other entries
// are absent. The caller's own entry patch applies, nobody else's.
func (s *server) handleConjugationWords(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	body, ok := readBody(w, r, maxConjugationBody)
	if !ok {
		return
	}
	var req struct {
		IDs []int64 `json:"ids"`
	}
	if err := json.NewDecoder(bytes.NewReader(body)).Decode(&req); err != nil ||
		len(req.IDs) == 0 || len(req.IDs) > maxConjugationIDs {
		writeError(w, http.StatusBadRequest, "bad_request", "ids must be 1 to 500 entry ids.")
		return
	}
	for _, id := range req.IDs {
		if id <= 0 {
			writeError(w, http.StatusBadRequest, "bad_request", "ids must be 1 to 500 entry ids.")
			return
		}
	}
	words, err := conjugation.Words(r.Context(), s.db, u.ID, req.IDs)
	if err != nil {
		writeInternal(w, r)
		return
	}
	writeJSON(w, http.StatusOK, map[string][]conjugation.DrillWord{"words": words})
}
