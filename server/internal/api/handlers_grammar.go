package api

import (
	"errors"
	"net/http"

	"qinqin/internal/grammar"
)

// handleListGrammar serves GET /api/grammar?language=<code>: the
// installed grammar packs of the language (every language when omitted)
// with credits, levels and lesson summaries. Public, like
// GET /api/schemes.
func (s *server) handleListGrammar(w http.ResponseWriter, r *http.Request) {
	packs, err := grammar.ListPacks(r.Context(), s.db, r.URL.Query().Get("language"))
	if err != nil {
		writeInternal(w, r)
		return
	}
	writeJSON(w, http.StatusOK, packs)
}

// handleGrammarLesson serves GET /api/grammar/{pack}/{lesson}: the full
// lesson with its pack's credits and neighbouring lessons; 404 for an
// unknown or removed lesson. Public.
func (s *server) handleGrammarLesson(w http.ResponseWriter, r *http.Request) {
	view, err := grammar.LessonByID(r.Context(), s.db, r.PathValue("pack"), r.PathValue("lesson"))
	if errors.Is(err, grammar.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "No such grammar lesson.")
		return
	}
	if err != nil {
		writeInternal(w, r)
		return
	}
	writeJSON(w, http.StatusOK, view)
}
