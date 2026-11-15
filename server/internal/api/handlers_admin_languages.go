package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"qinqin/internal/lang"
)

const maxLanguageBody = 4 << 10 // POST /api/admin/languages: one code

// handleRegisterLanguage serves POST /api/admin/languages {code}: an
// admin adds a data-only language on purpose. Code-pack languages are
// 409, an existing row 200, a new row 201 (name = code).
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
		http.Error(w, "malformed request body", http.StatusBadRequest)
		return
	}
	code, valid := lang.ValidCode(req.Code)
	if !valid {
		http.Error(w, "language must be a code like es or pt-br", http.StatusUnprocessableEntity)
		return
	}
	if lang.Registered(code) {
		http.Error(w, code+" is built in", http.StatusConflict)
		return
	}
	res, err := s.db.ExecContext(r.Context(), `
		INSERT INTO languages (code, name, updated_at) VALUES (?, ?, ?)
		ON CONFLICT (code) DO NOTHING`, code, code, now())
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	created, _ := res.RowsAffected()
	list, err := knownLanguages(r.Context(), s.db)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	status := http.StatusOK
	if created > 0 {
		status = http.StatusCreated
	}
	for _, li := range list {
		if li.Code == code {
			writeJSON(w, status, li)
			return
		}
	}
	http.Error(w, "internal error", http.StatusInternalServerError)
}

// languageInUse reports whether anything still depends on code: installed
// dictionary data, a live scheme, frequency pack or sentence pack, a
// legacy sentence on an entry of the language, or any user's workspace.
// Entries orphaned by an uninstall do not count.
func (s *server) languageInUse(ctx context.Context, code string) (bool, error) {
	installed, err := installedLanguages(ctx, s.db)
	if err != nil {
		return false, err
	}
	for _, li := range installed {
		if li.Code == code {
			return true, nil
		}
	}
	var used bool
	err = s.db.QueryRowContext(ctx, `
		SELECT EXISTS (SELECT 1 FROM schemes WHERE language = ?1 AND deleted_at IS NULL)
			OR EXISTS (SELECT 1 FROM frequency_packs WHERE language = ?1 AND deleted_at IS NULL)
			OR EXISTS (SELECT 1 FROM sentence_packs WHERE language = ?1 AND deleted_at IS NULL)
			OR EXISTS (SELECT 1 FROM workspaces WHERE language = ?1)
			OR EXISTS (
				SELECT 1 FROM sentences st JOIN entries e ON e.id = st.entry_id
				WHERE e.language = ?1 AND st.deleted_at IS NULL
				AND st.source_pack NOT IN (SELECT pack_id FROM sentence_packs))`, code).Scan(&used)
	return used, err
}

// handleDeleteLanguage serves DELETE /api/admin/languages/{code}: it
// removes an unused data-only language. The stored code is matched
// exactly (lowercased, no "_" rewriting) so legacy odd codes stay
// removable.
func (s *server) handleDeleteLanguage(w http.ResponseWriter, r *http.Request) {
	if s.requireAdmin(w, r) == nil {
		return
	}
	code := strings.ToLower(r.PathValue("code"))
	if lang.Registered(code) {
		http.Error(w, code+" is built in", http.StatusConflict)
		return
	}
	var n int
	if err := s.db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM languages WHERE code = ?`, code).Scan(&n); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if n == 0 {
		http.Error(w, "language not found", http.StatusNotFound)
		return
	}
	used, err := s.languageInUse(r.Context(), code)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if used {
		http.Error(w, "still used by packs or workspaces", http.StatusConflict)
		return
	}
	if _, err := s.db.ExecContext(r.Context(), `DELETE FROM languages WHERE code = ?`, code); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleLanguageUsage serves GET /api/admin/languages/usage: the number
// of workspaces of all users per language, sorted by code.
func (s *server) handleLanguageUsage(w http.ResponseWriter, r *http.Request) {
	if s.requireAdmin(w, r) == nil {
		return
	}
	rows, err := s.db.QueryContext(r.Context(), `
		SELECT language, COUNT(*) FROM workspaces GROUP BY language ORDER BY language`)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	list := make([]struct {
		Code       string `json:"code"`
		Workspaces int    `json:"workspaces"`
	}, 0)
	for rows.Next() {
		var u struct {
			Code       string `json:"code"`
			Workspaces int    `json:"workspaces"`
		}
		if err := rows.Scan(&u.Code, &u.Workspaces); err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		list = append(list, u)
	}
	if rows.Err() != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, list)
}
