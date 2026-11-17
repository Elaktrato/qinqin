package api

import (
	"errors"
	"net/http"

	"qinqin/internal/auth"
	"qinqin/internal/i18n"
)

// maxInterfaceLanguageBody bounds the PUT /api/me/interface-language body.
const maxInterfaceLanguageBody = 1 << 10

// handlePutInterfaceLanguage serves PUT /api/me/interface-language: stores
// the caller's interface language, "" (follow the browser/device) or a
// canonical language tag (docs/contracts/i18n/). Syntax only: a well-formed
// tag no client supports is stored. GET /api/auth/me reads it back.
func (s *server) handlePutInterfaceLanguage(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	var req struct {
		Language *string `json:"language"`
	}
	if err := decodeStrictJSON(w, r, &req, maxInterfaceLanguageBody); err != nil || req.Language == nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeAuthError(w, http.StatusRequestEntityTooLarge, "too_large", "Request body too large.")
			return
		}
		writeAuthError(w, http.StatusBadRequest, "bad_request", "Invalid request body: send {\"language\": string}.")
		return
	}
	if !i18n.IsLanguageSetting(*req.Language) {
		writeAuthError(w, http.StatusUnprocessableEntity, "invalid_language", "The interface language must be empty or a language tag such as en, zh-Hant or pt-BR.")
		return
	}
	if err := auth.SetInterfaceLanguage(r.Context(), s.db, u.ID, *req.Language); err != nil {
		writeInternal(w, r)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"language": *req.Language})
}
