package api

import (
	"net/http"
	"strconv"

	"qinqin/internal/images"
	"qinqin/internal/lexicon"
)

// maxPictureSense bounds the ?sense= query of the picture route.
const maxPictureSense = 999

type pictureJSON struct {
	PackID      string `json:"packId"`
	Concept     string `json:"concept"`
	Label       string `json:"label"`
	Credit      string `json:"credit"`
	License     string `json:"license"`
	Attribution string `json:"attribution"`
	Basis       string `json:"basis"`
	Sense       int    `json:"sense"`
	Score       int    `json:"score"`
	SVG         string `json:"svg"`
}

// pictureTargets are the strings an entry's picture is looked up by: its
// key, its written forms, and its kana readings when it has no written form
// (a word usually written in kana).
func pictureTargets(e *lexicon.Entry) []string {
	targets := []string{e.Key}
	for _, f := range e.Forms {
		targets = append(targets, f.Text)
	}
	if len(e.Forms) == 0 {
		for _, rd := range e.Readings {
			if rd.Type == "kana" {
				targets = append(targets, rd.Value)
			}
		}
	}
	return targets
}

// handleEntryPicture serves GET /api/images/entries/{id}[?sense=N]: the best
// bundled picture of one lexicon entry, as {"picture": {...}} or
// {"picture": null} when no installed images pack maps the entry (the usual
// answer for most words). sense (1..999) asks for the picture of that sense
// of the entry (and entry-wide ones); without it every mapping counts.
// The picture's svg is the file of the pack, byte for byte; clients draw it
// themselves (docs/contracts/images/). Signed-in users only.
func (s *server) handleEntryPicture(w http.ResponseWriter, r *http.Request) {
	if s.requireUser(w, r) == nil {
		return
	}
	sense := 0
	if v := r.URL.Query().Get("sense"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > maxPictureSense {
			writeError(w, http.StatusBadRequest, "bad_request", "Bad sense.")
			return
		}
		sense = n
	}
	e, ok := s.entryFromPath(w, r)
	if !ok {
		return
	}
	f, found, err := images.Resolve(r.Context(), s.db, e.Language, pictureTargets(e), sense)
	if err != nil {
		writeInternal(w, r)
		return
	}
	if !found {
		writeJSON(w, http.StatusOK, map[string]any{"picture": nil})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"picture": pictureJSON{f.PackID, f.Concept, f.Label, f.Credit, f.License, f.Attribution, f.Basis, f.Sense, f.Score, f.SVG}})
}

// handleListImagePacks serves GET /api/image-packs: the installed images
// packs with their terms and counts, for the Sources page. Public.
func (s *server) handleListImagePacks(w http.ResponseWriter, r *http.Request) {
	packs, err := images.Packs(r.Context(), s.db)
	if err != nil {
		writeInternal(w, r)
		return
	}
	type packJSON struct {
		PackID       string   `json:"packId"`
		Name         string   `json:"name"`
		Version      string   `json:"version"`
		Languages    []string `json:"languages"`
		License      string   `json:"license"`
		Attribution  string   `json:"attribution"`
		Notice       string   `json:"notice"`
		PictureCount int      `json:"pictureCount"`
		MappingCount int      `json:"mappingCount"`
	}
	out := make([]packJSON, 0, len(packs))
	for _, p := range packs {
		out = append(out, packJSON{p.PackID, p.Name, p.Version, p.Languages, p.License, p.Attribution, p.Notice, p.Pictures, p.Mappings})
	}
	writeJSON(w, http.StatusOK, out)
}
