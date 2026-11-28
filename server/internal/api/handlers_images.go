package api

import (
	"encoding/json"
	"errors"
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
// The picture's svg is the pack's file in canonical form (images.CanonicalSVG); clients draw it
// themselves (docs/contracts/images/). Signed-in users only. A picture the
// caller reported for the entry (#274) is passed over.
func (s *server) handleEntryPicture(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
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
	skip, err := images.ReportedOf(r.Context(), s.db, u.ID, e.ID)
	if err != nil {
		writeInternal(w, r)
		return
	}
	f, found, err := images.Resolve(r.Context(), s.db, e.Language, pictureTargets(e), sense, skip)
	if err != nil {
		writeInternal(w, r)
		return
	}
	if !found {
		writeJSON(w, http.StatusOK, map[string]any{"picture": nil})
		return
	}
	// A pack installed before the canonical form existed holds the pack's own
	// bytes: never serve those, only what CanonicalSVG makes of them (it is the
	// identity on a stored canonical picture). One that fails the check is
	// treated as no picture; a re-install of the pack repairs it.
	svg, err := images.CanonicalSVG([]byte(f.SVG))
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"picture": nil})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"picture": pictureJSON{f.PackID, f.Concept, f.Label, f.Credit, f.License, f.Attribution, f.Basis, f.Sense, f.Score, string(svg)}})
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

// maxPictureReportBody bounds the body of POST /api/images/reports.
const maxPictureReportBody = 1 << 10

// handleReportPicture serves POST /api/images/reports {entryId, packId,
// concept, reason}: the caller reports a wrong picture of an entry (#274).
// 204; the picture is not answered to them for that entry again. 400 for a
// bad body or reason, 404 for an unknown entry or picture.
func (s *server) handleReportPicture(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	body, ok := readBody(w, r, maxPictureReportBody)
	if !ok {
		return
	}
	var in struct {
		EntryID int64  `json:"entryId"`
		PackID  string `json:"packId"`
		Concept string `json:"concept"`
		Reason  string `json:"reason"`
	}
	if json.Unmarshal(body, &in) != nil || in.EntryID <= 0 || in.PackID == "" || in.Concept == "" || len(in.PackID) > 64 || len(in.Concept) > 64 {
		writeError(w, http.StatusBadRequest, "bad_request", "The body must be {entryId, packId, concept, reason}.")
		return
	}
	if _, err := (lexicon.Store{DB: s.db}).Get(r.Context(), in.EntryID); errors.Is(err, lexicon.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "Entry not found.")
		return
	} else if err != nil {
		writeInternal(w, r)
		return
	}
	switch err := images.Report(r.Context(), s.db, u.ID, in.EntryID, in.PackID, in.Concept, in.Reason); {
	case errors.Is(err, images.ErrBadReason):
		writeError(w, http.StatusBadRequest, "bad_request", "Unknown reason.")
	case errors.Is(err, images.ErrNoSuchPicture):
		writeError(w, http.StatusNotFound, "not_found", "Picture not found.")
	case err != nil:
		writeInternal(w, r)
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleReportedPictures serves GET /api/images/reports: the pictures the
// caller reported, {"reports": [{entryId, packId, concept}]}, so a client
// that answers pictures offline passes them over too (#274).
func (s *server) handleReportedPictures(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	list, err := images.Reported(r.Context(), s.db, u.ID)
	if err != nil {
		writeInternal(w, r)
		return
	}
	type reportJSON struct {
		EntryID int64  `json:"entryId"`
		PackID  string `json:"packId"`
		Concept string `json:"concept"`
	}
	out := make([]reportJSON, 0, len(list))
	for _, rp := range list {
		out = append(out, reportJSON{rp.EntryID, rp.PackID, rp.Concept})
	}
	writeJSON(w, http.StatusOK, map[string]any{"reports": out})
}
