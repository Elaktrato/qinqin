package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strconv"

	"qinqin/internal/eligibility"
)

const (
	maxEligibilityBody = 16 << 10 // POST /api/study/eligibility: up to 500 ids
	maxEligibilityIDs  = 500
)

// handleStudyEligibility serves POST /api/study/eligibility {"ids":[...]}:
// for each of 1 to 500 entries, the companion card kinds a study session
// can make of it for the caller (docs/contracts/cards/eligibility.json), as
// {"entries": {"<id>": ["sentence", "tone", "reverse", "cloze"]}} in kind
// order; every asked id is answered, an unknown entry with []. The caller's
// own sentences and patch count, nobody else's. It segments sentences, so it
// shares the per-user slots of POST /api/segment.
func (s *server) handleStudyEligibility(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	body, ok := readBody(w, r, maxEligibilityBody)
	if !ok {
		return
	}
	var req struct {
		IDs []int64 `json:"ids"`
	}
	if err := json.NewDecoder(bytes.NewReader(body)).Decode(&req); err != nil ||
		len(req.IDs) == 0 || len(req.IDs) > maxEligibilityIDs {
		writeError(w, http.StatusBadRequest, "bad_request", "ids must be 1 to 500 entry ids.")
		return
	}
	seen := make(map[int64]bool, len(req.IDs))
	ids := make([]int64, 0, len(req.IDs))
	for _, id := range req.IDs {
		if id <= 0 {
			writeError(w, http.StatusBadRequest, "bad_request", "ids must be 1 to 500 entry ids.")
			return
		}
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	release, ok := s.segments.acquire(u.ID, MaxSegmentsInFlight)
	if !ok {
		w.Header().Set("Retry-After", "1")
		writeError(w, http.StatusTooManyRequests, "rate_limited", "Too many texts are being segmented at once. Try again in a moment.")
		return
	}
	defer release()
	svc := s.segmenter()
	segmenter := func(language string) eligibility.SegmentFunc {
		if !segmentable(language) {
			return nil
		}
		return svc.Segment
	}
	kinds, err := eligibility.ForEntries(r.Context(), s.db, segmenter, u.ID, ids)
	if err != nil {
		writeInternal(w, r)
		return
	}
	out := make(map[string][]string, len(kinds))
	for id, list := range kinds {
		out[strconv.FormatInt(id, 10)] = list
	}
	writeJSON(w, http.StatusOK, map[string]map[string][]string{"entries": out})
}
