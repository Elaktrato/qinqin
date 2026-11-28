package api

import (
	"bytes"
	"encoding/json"
	"net/http"

	"qinqin/internal/counters"
)

const (
	maxMeasureWordsBody = 16 << 10 // POST /api/drills/measure-words/words: up to 500 ids
	maxMeasureWordsIDs  = 500
)

// handleMeasureWordsWords serves POST /api/drills/measure-words/words
// {"ids":[...]}: the nouns of the measure-word and counter drills (#179,
// docs/contracts/counters/) among 1 to 500 entries, each with its measure
// words or counters, in first-occurrence order, and the pools of wrong
// choices of their languages. The caller's own entry patch applies,
// nobody else's.
func (s *server) handleMeasureWordsWords(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	body, ok := readBody(w, r, maxMeasureWordsBody)
	if !ok {
		return
	}
	var req struct {
		IDs []int64 `json:"ids"`
	}
	if err := json.NewDecoder(bytes.NewReader(body)).Decode(&req); err != nil ||
		len(req.IDs) == 0 || len(req.IDs) > maxMeasureWordsIDs {
		writeError(w, http.StatusBadRequest, "bad_request", "ids must be 1 to 500 entry ids.")
		return
	}
	for _, id := range req.IDs {
		if id <= 0 {
			writeError(w, http.StatusBadRequest, "bad_request", "ids must be 1 to 500 entry ids.")
			return
		}
	}
	answer, err := counters.Words(r.Context(), s.db, u.ID, req.IDs)
	if err != nil {
		writeInternal(w, r)
		return
	}
	writeJSON(w, http.StatusOK, answer)
}

// handleCounterReadings serves GET /api/drills/counters: every counter of
// the Japanese counters table with the readings of every number the
// readings drill asks (docs/contracts/counters/readings.json).
func (s *server) handleCounterReadings(w http.ResponseWriter, r *http.Request) {
	if s.requireUser(w, r) == nil {
		return
	}
	writeJSON(w, http.StatusOK, map[string][]counters.CounterReadings{"counters": counters.AllReadings()})
}
