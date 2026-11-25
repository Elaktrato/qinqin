package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"qinqin/internal/grammar"
)

const maxGrammarRunBody = 4 << 10 // POST /api/grammar/progress: two ids and two numbers

// handleListGrammarProgress serves GET /api/grammar/progress?workspace=.
func (s *server) handleListGrammarProgress(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	ws, ok := s.requiredWorkspace(w, r, u.ID)
	if !ok {
		return
	}
	list, err := grammar.ListProgress(r.Context(), s.db, u.ID, ws)
	if err != nil {
		writeInternal(w, r)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// handleRecordGrammarRun serves POST /api/grammar/progress?workspace=
// {packId, lessonId, score, total}: the stored progress of the lesson.
func (s *server) handleRecordGrammarRun(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	ws, ok := s.requiredWorkspace(w, r, u.ID)
	if !ok {
		return
	}
	body, ok := readBody(w, r, maxGrammarRunBody)
	if !ok {
		return
	}
	var in struct {
		PackID   string `json:"packId"`
		LessonID string `json:"lessonId"`
		Score    *int   `json:"score"`
		Total    *int   `json:"total"`
	}
	if json.Unmarshal(body, &in) != nil || in.Score == nil || in.Total == nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Malformed request body.")
		return
	}
	p, err := grammar.RecordRun(r.Context(), s.db, u.ID, ws, in.PackID, in.LessonID, *in.Score, *in.Total)
	var inv *grammar.InvalidError
	if errors.As(err, &inv) {
		writeError(w, http.StatusBadRequest, "bad_request", inv.Msg)
		return
	}
	if err != nil {
		writeInternal(w, r)
		return
	}
	writeJSON(w, http.StatusOK, p)
}
