package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"

	"qinqin/internal/lang"
)

const maxLanguageBody = 4 << 10 // POST /api/admin/languages: one code

// handleRegisterLanguage serves POST /api/admin/languages {code}: an
// admin adds a data-only language on purpose (lang.AddData). Code-pack
// languages are 409, an existing row 200, a new row 201 (name = code).
func (s *server) handleRegisterLanguage(w http.ResponseWriter, r *http.Request) {
	if s.requireAdmin(w, r) == nil {
		return
	}
	body, ok := readBody(w, r, maxLanguageBody)
	if !ok {
		return
	}
	var req struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(bytes.NewReader(body)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Malformed request body.")
		return
	}
	li, created, err := lang.AddData(r.Context(), s.db, req.Code)
	var builtIn *lang.BuiltInError
	switch {
	case errors.Is(err, lang.ErrInvalidCode):
		writeError(w, http.StatusUnprocessableEntity, "invalid_language", "language must be a code like es or pt-br.")
	case errors.As(err, &builtIn):
		writeError(w, http.StatusConflict, "language_built_in", builtIn.Error())
	case err != nil:
		writeInternal(w, r)
	case created:
		writeJSON(w, http.StatusCreated, toLanguageInfo(li))
	default:
		writeJSON(w, http.StatusOK, toLanguageInfo(li))
	}
}

// handleDeleteLanguage serves DELETE /api/admin/languages/{code}: it
// removes an unused data-only language (lang.Remove: the stored code is
// matched exactly, then lowercased; the delete re-checks every
// dependency). A language in use is a 409 naming what uses it, with the
// counts beside the code, never who uses it.
func (s *server) handleDeleteLanguage(w http.ResponseWriter, r *http.Request) {
	if s.requireAdmin(w, r) == nil {
		return
	}
	s.langMu.Lock()
	defer s.langMu.Unlock()
	err := lang.Remove(r.Context(), s.db, r.PathValue("code"))
	var builtIn *lang.BuiltInError
	var inUse *lang.InUseError
	switch {
	case err == nil:
		w.WriteHeader(http.StatusNoContent)
	case errors.Is(err, lang.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "No such language.")
	case errors.As(err, &builtIn):
		writeError(w, http.StatusConflict, "language_built_in", builtIn.Error())
	case errors.As(err, &inUse):
		writeError(w, http.StatusConflict, "language_in_use", inUse.Error(),
			map[string]any{"usage": inUse.Use.Counts()})
	default:
		writeInternal(w, r)
	}
}

// handleLanguageUsage serves GET /api/admin/languages/usage: the number
// of workspaces of all users per language, sorted by code.
func (s *server) handleLanguageUsage(w http.ResponseWriter, r *http.Request) {
	if s.requireAdmin(w, r) == nil {
		return
	}
	counts, err := lang.WorkspaceCounts(r.Context(), s.db)
	if err != nil {
		writeInternal(w, r)
		return
	}
	type usageJSON struct {
		Code       string `json:"code"`
		Workspaces int    `json:"workspaces"`
	}
	list := make([]usageJSON, 0, len(counts))
	for _, c := range counts {
		list = append(list, usageJSON{c.Code, c.Workspaces})
	}
	writeJSON(w, http.StatusOK, list)
}
