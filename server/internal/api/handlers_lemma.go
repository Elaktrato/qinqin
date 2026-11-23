package api

import (
	"net/http"

	"qinqin/internal/lemmapack"
)

// lemmaPackBody is one installed lemma-rules pack as served by
// GET /api/lemma-packs, with the credits the Sources page shows.
type lemmaPackBody struct {
	PackID      string `json:"packId"`
	Name        string `json:"name"`
	Version     string `json:"version"`
	Language    string `json:"language"`
	License     string `json:"license"`
	Attribution string `json:"attribution"`
	Notice      string `json:"notice"`
}

// handleListLemmaPacks serves GET /api/lemma-packs (#176) with every live
// lemmatizer rule-table pack's credits, by pack id. Public shared data, like
// /api/component-packs.
func (s *server) handleListLemmaPacks(w http.ResponseWriter, r *http.Request) {
	list, err := lemmapack.List(r.Context(), s.db)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	out := make([]lemmaPackBody, 0, len(list))
	for _, p := range list {
		out = append(out, lemmaPackBody{PackID: p.PackID, Name: p.Name, Version: p.Version, Language: p.Language,
			License: p.License, Attribution: p.Attribution, Notice: p.Notice})
	}
	writeJSON(w, http.StatusOK, out)
}
