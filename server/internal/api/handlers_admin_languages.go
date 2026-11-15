package api

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
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

// usageCountsSQL counts what depends on language ?1 (compared exactly),
// one column each, in the order scanned by languageUse. Entries orphaned
// by an uninstall do not count.
const usageCountsSQL = `
	SELECT
		(SELECT COUNT(*) FROM workspaces WHERE language = ?1) AS workspaces,
		EXISTS (
			SELECT 1 FROM entries e
			JOIN senses s ON s.entry_id = e.id AND s.deleted_at IS NULL
			JOIN dictionaries d ON d.id = s.dictionary_id AND d.deleted_at IS NULL
			WHERE e.language = ?1 AND e.deleted_at IS NULL) AS installed,
		(SELECT COUNT(*) FROM schemes WHERE language = ?1 AND deleted_at IS NULL) AS levels,
		(SELECT COUNT(*) FROM frequency_packs WHERE language = ?1 AND deleted_at IS NULL) AS freq,
		(SELECT COUNT(*) FROM sentence_packs WHERE language = ?1 AND deleted_at IS NULL) AS sentences,
		(SELECT COUNT(*) FROM grammar_packs WHERE language = ?1 AND deleted_at IS NULL) AS grammar,
		(SELECT COUNT(*) FROM audio_packs WHERE language = ?1 AND deleted_at IS NULL) AS audio,
		EXISTS (
			SELECT 1 FROM sentences st JOIN entries e ON e.id = st.entry_id
			WHERE e.language = ?1 AND st.deleted_at IS NULL
			AND st.source_pack NOT IN (SELECT pack_id FROM sentence_packs)) AS legacy`

type languageUse struct {
	workspaces, levels, freq, sentences, grammar, audio int
	installed, legacy                                   bool
}

func plural(n int, one, many string) string {
	if n == 1 {
		return "a " + one
	}
	return strconv.Itoa(n) + " " + many
}

// blockers names what keeps a language in use, never who uses it.
func (u languageUse) blockers() string {
	var parts []string
	if u.workspaces > 0 {
		if u.workspaces == 1 {
			parts = append(parts, "1 workspace")
		} else {
			parts = append(parts, strconv.Itoa(u.workspaces)+" workspaces")
		}
	}
	if u.installed {
		parts = append(parts, "installed dictionary data")
	}
	for _, c := range []struct {
		n         int
		one, many string
	}{
		{u.levels, "level list", "level lists"},
		{u.freq, "frequency pack", "frequency packs"},
		{u.sentences, "sentence pack", "sentence packs"},
		{u.grammar, "grammar pack", "grammar packs"},
		{u.audio, "audio pack", "audio packs"},
	} {
		if c.n > 0 {
			parts = append(parts, plural(c.n, c.one, c.many))
		}
	}
	if u.legacy {
		parts = append(parts, "sentences from an older pack")
	}
	return strings.Join(parts, ", ")
}

func (s *server) languageUse(ctx context.Context, code string) (languageUse, error) {
	var u languageUse
	err := s.db.QueryRowContext(ctx, usageCountsSQL, code).Scan(
		&u.workspaces, &u.installed, &u.levels, &u.freq, &u.sentences, &u.grammar, &u.audio, &u.legacy)
	return u, err
}

// handleDeleteLanguage serves DELETE /api/admin/languages/{code}: it
// removes an unused data-only language. The stored code is matched by
// the exact path value first, then lowercased, with no "_" rewriting, so
// legacy odd codes stay removable. The row is deleted by one statement
// that re-checks every dependency, so a concurrent pack install or
// workspace creation cannot slip in between check and delete.
func (s *server) handleDeleteLanguage(w http.ResponseWriter, r *http.Request) {
	if s.requireAdmin(w, r) == nil {
		return
	}
	s.langMu.Lock()
	defer s.langMu.Unlock()
	code := r.PathValue("code")
	var stored string
	err := s.db.QueryRowContext(r.Context(), `
		SELECT code FROM languages WHERE code = ?1
		UNION ALL SELECT code FROM languages WHERE code = lower(?1)
		LIMIT 1`, code).Scan(&stored)
	if errors.Is(err, sql.ErrNoRows) {
		if lang.Registered(code) {
			http.Error(w, strings.ToLower(code)+" is built in", http.StatusConflict)
			return
		}
		http.Error(w, "language not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if lang.Registered(stored) {
		http.Error(w, stored+" is built in", http.StatusConflict)
		return
	}
	res, err := s.db.ExecContext(r.Context(), `
		DELETE FROM languages WHERE code = ?1 AND (
			SELECT workspaces + installed + levels + freq + sentences + grammar + audio + legacy
			FROM (`+usageCountsSQL+`)) = 0`, stored)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		use, err := s.languageUse(r.Context(), stored)
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if msg := use.blockers(); msg != "" {
			http.Error(w, "still used by: "+msg, http.StatusConflict)
			return
		}
		http.Error(w, "language not found", http.StatusNotFound)
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
