package api

import (
	"net/http"

	"qinqin/internal/freq"
)

// frequencyPackBody is one installed frequency pack as served by
// GET /api/frequency-packs, with the credits the Sources page shows.
type frequencyPackBody struct {
	ID          int64  `json:"id"`
	PackID      string `json:"packId"`
	Name        string `json:"name"`
	Version     string `json:"version"`
	Language    string `json:"language"`
	License     string `json:"license"`
	Attribution string `json:"attribution"`
	Notice      string `json:"notice"`
}

// handleListFrequencyPacks serves GET /api/frequency-packs with every
// installed frequency pack, in priority order.
func (s *server) handleListFrequencyPacks(w http.ResponseWriter, r *http.Request) {
	packs, err := freq.Store{DB: s.db}.Packs(r.Context())
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	list := make([]frequencyPackBody, 0, len(packs))
	for _, p := range packs {
		list = append(list, frequencyPackBody{ID: p.ID, PackID: p.PackID, Name: p.Name, Version: p.Version,
			Language: p.Language, License: p.License, Attribution: p.Attribution, Notice: p.Notice})
	}
	writeJSON(w, http.StatusOK, list)
}
