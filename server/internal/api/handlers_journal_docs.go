package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"qinqin/internal/journal"
	"qinqin/internal/workspaces"
)

// maxJournalDoc caps the body of an entry or settings write: an entry's text
// is at most journal.MaxTextRunes code points (4 bytes each at worst).
const maxJournalDoc = 256 << 10

// requiredWorkspace resolves ?workspace= of a route that is always scoped to
// one workspace: absent or not an integer is 400, an unknown or foreign id 404.
func (s *server) requiredWorkspace(w http.ResponseWriter, r *http.Request, userID int64) (int64, bool) {
	id, err := strconv.ParseInt(r.URL.Query().Get("workspace"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "workspace must be an integer.")
		return 0, false
	}
	ok, err := workspaces.Owned(r.Context(), s.db, userID, id)
	if err != nil {
		writeInternal(w, r)
		return 0, false
	}
	if !ok {
		writeError(w, http.StatusNotFound, "workspace_not_found", "No such workspace.")
		return 0, false
	}
	return id, true
}

// journalScope is the user and workspace of a journal document route.
func (s *server) journalScope(w http.ResponseWriter, r *http.Request) (userID, ws int64, ok bool) {
	u := s.requireUser(w, r)
	if u == nil {
		return 0, 0, false
	}
	ws, ok = s.requiredWorkspace(w, r, u.ID)
	return u.ID, ws, ok
}

// answerJournalStoreError maps a journal store error to its answer.
func answerJournalStoreError(w http.ResponseWriter, r *http.Request, err error) {
	var inv *journal.InvalidError
	switch {
	case errors.Is(err, journal.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "Entry not found.")
	case errors.As(err, &inv):
		writeError(w, http.StatusBadRequest, "bad_request", inv.Msg)
	default:
		writeInternal(w, r)
	}
}

// handleListJournalEntries serves GET /api/journal/entries?workspace=.
func (s *server) handleListJournalEntries(w http.ResponseWriter, r *http.Request) {
	userID, ws, ok := s.journalScope(w, r)
	if !ok {
		return
	}
	list, err := journal.ListEntries(r.Context(), s.db, userID, ws)
	if err != nil {
		writeInternal(w, r)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// handleGetJournalEntry serves GET /api/journal/entries/{id}?workspace=.
func (s *server) handleGetJournalEntry(w http.ResponseWriter, r *http.Request) {
	userID, ws, ok := s.journalScope(w, r)
	if !ok {
		return
	}
	e, err := journal.GetEntry(r.Context(), s.db, userID, ws, r.PathValue("id"))
	if err != nil {
		answerJournalStoreError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, e)
}

// handlePutJournalEntry serves PUT /api/journal/entries/{id}?workspace=
// {date, title, text, source, createdAt?}: the stored entry.
func (s *server) handlePutJournalEntry(w http.ResponseWriter, r *http.Request) {
	userID, ws, ok := s.journalScope(w, r)
	if !ok {
		return
	}
	body, ok := readBody(w, r, maxJournalDoc)
	if !ok {
		return
	}
	var in struct {
		Date      string `json:"date"`
		Title     string `json:"title"`
		Text      string `json:"text"`
		Source    string `json:"source"`
		CreatedAt string `json:"createdAt"`
	}
	if json.Unmarshal(body, &in) != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Malformed request body.")
		return
	}
	e, err := journal.PutEntry(r.Context(), s.db, userID, ws, journal.Entry{
		ID: r.PathValue("id"), Date: in.Date, Title: in.Title, Text: in.Text, Source: in.Source, CreatedAt: in.CreatedAt,
	})
	if err != nil {
		answerJournalStoreError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, e)
}

// handleDeleteJournalEntry serves DELETE /api/journal/entries/{id}?workspace=:
// the entry and its review go; a missing entry is 404.
func (s *server) handleDeleteJournalEntry(w http.ResponseWriter, r *http.Request) {
	userID, ws, ok := s.journalScope(w, r)
	if !ok {
		return
	}
	if err := journal.DeleteEntry(r.Context(), s.db, userID, ws, r.PathValue("id")); err != nil {
		answerJournalStoreError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleGetJournalReview serves GET /api/journal/entries/{id}/review?workspace=:
// {review: … | null}.
func (s *server) handleGetJournalReview(w http.ResponseWriter, r *http.Request) {
	userID, ws, ok := s.journalScope(w, r)
	if !ok {
		return
	}
	rev, err := journal.GetReview(r.Context(), s.db, userID, ws, r.PathValue("id"))
	if err != nil {
		writeInternal(w, r)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"review": rev})
}

// handleGetJournalSuggestions serves GET /api/journal/suggestions?workspace=:
// {suggestions: … | null}.
func (s *server) handleGetJournalSuggestions(w http.ResponseWriter, r *http.Request) {
	userID, ws, ok := s.journalScope(w, r)
	if !ok {
		return
	}
	doc, err := journal.GetSuggestions(r.Context(), s.db, userID, ws)
	if err != nil {
		writeInternal(w, r)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"suggestions": doc})
}

// handleGetJournalSettings serves GET /api/journal/settings?workspace=.
func (s *server) handleGetJournalSettings(w http.ResponseWriter, r *http.Request) {
	userID, ws, ok := s.journalScope(w, r)
	if !ok {
		return
	}
	st, err := journal.GetSettings(r.Context(), s.db, userID, ws)
	if err != nil {
		writeInternal(w, r)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

// handlePutJournalSettings serves PUT /api/journal/settings?workspace=
// {guidance, explanationLanguage}.
func (s *server) handlePutJournalSettings(w http.ResponseWriter, r *http.Request) {
	userID, ws, ok := s.journalScope(w, r)
	if !ok {
		return
	}
	body, ok := readBody(w, r, maxJournalDoc)
	if !ok {
		return
	}
	var in journal.Settings
	if json.Unmarshal(body, &in) != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Malformed request body.")
		return
	}
	st, err := journal.PutSettings(r.Context(), s.db, userID, ws, in)
	if err != nil {
		answerJournalStoreError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}
