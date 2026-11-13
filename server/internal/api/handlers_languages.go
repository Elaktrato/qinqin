package api

import (
	"context"
	"database/sql"
	"net/http"
)

// languageInfo is one installed language as served by GET
// /api/languages.
type languageInfo struct {
	Code      string `json:"code"`
	Name      string `json:"name"`
	Installed bool   `json:"installed"`
}

// installedLanguagesSQL lists the languages with at least one live sense
// in a live dictionary on a live entry, sorted by code. The recursive
// CTE walks the distinct entry languages through the (language, kind,
// ext_key) unique index one seek per language instead of scanning every
// entry; the EXISTS then stops at the first live sense of each. The
// name comes from the languages row of a data-only language, else the
// code (code packs have no row).
const installedLanguagesSQL = `
	WITH RECURSIVE langs(code) AS (
		SELECT MIN(language) FROM entries
		UNION ALL
		SELECT (SELECT MIN(language) FROM entries WHERE language > langs.code)
		FROM langs WHERE langs.code IS NOT NULL
	)
	SELECT langs.code, COALESCE(l.name, langs.code)
	FROM langs
	LEFT JOIN languages l ON l.code = langs.code
	WHERE langs.code IS NOT NULL AND EXISTS (
		SELECT 1 FROM entries e
		JOIN senses s ON s.entry_id = e.id AND s.deleted_at IS NULL
		JOIN dictionaries d ON d.id = s.dictionary_id AND d.deleted_at IS NULL
		WHERE e.language = langs.code AND e.deleted_at IS NULL
	)
	ORDER BY langs.code`

// queryer is what installedLanguages reads through: *sql.DB or *sql.Tx.
type queryer interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

// installedLanguages returns the languages with installed dictionary
// data (entries ⋈ senses ⋈ dictionaries, all live), sorted by code.
func installedLanguages(ctx context.Context, db queryer) ([]languageInfo, error) {
	rows, err := db.QueryContext(ctx, installedLanguagesSQL)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]languageInfo, 0)
	for rows.Next() {
		li := languageInfo{Installed: true}
		if err := rows.Scan(&li.Code, &li.Name); err != nil {
			return nil, err
		}
		list = append(list, li)
	}
	return list, rows.Err()
}

// handleListLanguages serves GET /api/languages: the installed
// languages. Like GET /api/dictionaries it is public.
func (s *server) handleListLanguages(w http.ResponseWriter, r *http.Request) {
	list, err := installedLanguages(r.Context(), s.db)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, list)
}
