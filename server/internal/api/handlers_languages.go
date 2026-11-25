package api

import (
	"net/http"

	"qinqin/internal/lang"
)

// languageInfo is one known language as served by GET /api/languages.
type languageInfo struct {
	Code      string `json:"code"`
	Name      string `json:"name"`
	Installed bool   `json:"installed"`
	// Kind is "code" for a language with a code pack, else "data".
	Kind string `json:"kind"`
}

func toLanguageInfo(li lang.Info) languageInfo {
	return languageInfo{Code: li.Code, Name: li.Name, Installed: li.Installed, Kind: li.Kind}
}

// handleListLanguages serves GET /api/languages: every known language,
// installed or not (lang.Known). Like GET /api/dictionaries it is public.
func (s *server) handleListLanguages(w http.ResponseWriter, r *http.Request) {
	known, err := lang.Known(r.Context(), s.db)
	if err != nil {
		writeInternal(w, r)
		return
	}
	list := make([]languageInfo, 0, len(known))
	for _, li := range known {
		list = append(list, toLanguageInfo(li))
	}
	writeJSON(w, http.StatusOK, list)
}
