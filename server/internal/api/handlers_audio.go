package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"

	"qinqin/internal/audio"
	"qinqin/internal/lexicon"
)

const (
	maxAudioResolveBody = 16 << 10 // POST /api/audio/resolve: up to 200 ids
	maxAudioResolveIDs  = 200
	defaultCreditsLimit = 100
)

// clipFilePattern is the only shape a clip file name may take: a
// lowercase SHA-256 and a stored extension. Anything else is a 404, so a
// request can never name a path.
var clipFilePattern = regexp.MustCompile(`^([0-9a-f]{64})\.(opus|ogg|mp3)$`)

type clipJSON struct {
	URL         string `json:"url"`
	PackID      string `json:"packId"`
	License     string `json:"license"`
	Attribution string `json:"attribution"`
	Source      string `json:"source"`
}

type resolutionJSON struct {
	Terms     []clipJSON   `json:"terms"`
	Syllables [][]clipJSON `json:"syllables"`
}

func toClipJSON(c audio.Clip) clipJSON {
	return clipJSON{URL: "/api/audio/clips/" + c.SHA + "." + c.Ext, PackID: c.PackID,
		License: c.License, Attribution: c.Attribution, Source: c.Source}
}

func toResolutionJSON(r audio.Resolution) resolutionJSON {
	out := resolutionJSON{Terms: []clipJSON{}}
	for _, c := range r.Terms {
		out.Terms = append(out.Terms, toClipJSON(c))
	}
	if r.Syllables != nil {
		out.Syllables = make([][]clipJSON, len(r.Syllables))
		for i, seq := range r.Syllables {
			if seq == nil {
				continue // null: the reading has no complete sequence
			}
			out.Syllables[i] = make([]clipJSON, len(seq))
			for j, c := range seq {
				out.Syllables[i][j] = toClipJSON(c)
			}
		}
	}
	return out
}

// resolveEntry resolves one lexicon entry: its first written form and
// its pinyin readings (zh) or kana readings (everything else), in entry
// order — Syllables aligns with the pinyin readings.
func (s *server) resolveEntry(r *http.Request, e *lexicon.Entry) (resolutionJSON, error) {
	written := e.Key
	if len(e.Forms) > 0 {
		written = e.Forms[0].Text
	}
	want := "kana"
	if e.Language == "zh" {
		want = "pinyin"
	}
	var readings []string
	for _, rd := range e.Readings {
		if rd.Type == want {
			readings = append(readings, rd.Value)
		}
	}
	res, err := audio.Resolve(r.Context(), s.db, e.Language, written, readings)
	if err != nil {
		return resolutionJSON{}, err
	}
	return toResolutionJSON(res), nil
}

// handleAudioEntry serves GET /api/audio/entries/{id}: the clips of one
// entry. Signed-in users only.
func (s *server) handleAudioEntry(w http.ResponseWriter, r *http.Request) {
	if s.requireUser(w, r) == nil {
		return
	}
	e, ok := s.entryFromPath(w, r)
	if !ok {
		return
	}
	out, err := s.resolveEntry(r, e)
	if err != nil {
		writeInternal(w, r)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// handleAudioResolve serves POST /api/audio/resolve {"entryIds":[...]}:
// the resolutions of up to 200 entries keyed by id; unknown ids are left
// out. Body up to 16 KiB. Signed-in users only.
func (s *server) handleAudioResolve(w http.ResponseWriter, r *http.Request) {
	if s.requireUser(w, r) == nil {
		return
	}
	body, ok := readBody(w, r, maxAudioResolveBody)
	if !ok {
		return
	}
	var in struct {
		EntryIDs []int64 `json:"entryIds"`
	}
	if err := json.Unmarshal(body, &in); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Malformed request body.")
		return
	}
	if len(in.EntryIDs) > maxAudioResolveIDs {
		writeError(w, http.StatusUnprocessableEntity, "invalid_request", "Too many entryIds (at most 200).")
		return
	}
	store := lexicon.Store{DB: s.db}
	out := make(map[string]resolutionJSON, len(in.EntryIDs))
	for _, id := range in.EntryIDs {
		e, err := store.Get(r.Context(), id)
		if errors.Is(err, lexicon.ErrNotFound) {
			continue
		}
		if err != nil {
			writeInternal(w, r)
			return
		}
		res, err := s.resolveEntry(r, e)
		if err != nil {
			writeInternal(w, r)
			return
		}
		out[strconv.FormatInt(id, 10)] = res
	}
	writeJSON(w, http.StatusOK, out)
}

// handleAudioClip serves GET /api/audio/clips/{file}, file being
// <sha256>.<ext>: the stored clip, immutable and range-capable. A name
// that is not exactly that shape, or a clip no active pack references
// under that extension, is 404. Signed-in users only.
func (s *server) handleAudioClip(w http.ResponseWriter, r *http.Request) {
	if s.requireUser(w, r) == nil {
		return
	}
	m := clipFilePattern.FindStringSubmatch(r.PathValue("file"))
	if m == nil {
		writeError(w, http.StatusNotFound, "not_found", "No such audio clip.")
		return
	}
	sha, ext := m[1], m[2]
	active, err := audio.ClipActive(r.Context(), s.db, sha, ext)
	if err != nil {
		writeInternal(w, r)
		return
	}
	if !active {
		writeError(w, http.StatusNotFound, "not_found", "No such audio clip.")
		return
	}
	f, err := os.Open(audio.BlobPath(filepath.Join(s.dataDir, "audio"), sha, ext))
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "No such audio clip.")
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		writeInternal(w, r)
		return
	}
	h := w.Header()
	h.Set("Content-Type", audio.ContentType(ext))
	h.Set("Cache-Control", "private, max-age=31536000, immutable")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("ETag", `"`+sha+`"`)
	serveContent(w, r, info.ModTime(), f)
}

// handleListAudioPacks serves GET /api/audio-packs: the installed audio
// packs with their terms and clip counts, for the Sources page. Public.
func (s *server) handleListAudioPacks(w http.ResponseWriter, r *http.Request) {
	packs, err := audio.Packs(r.Context(), s.db)
	if err != nil {
		writeInternal(w, r)
		return
	}
	type packJSON struct {
		PackID      string `json:"packId"`
		Name        string `json:"name"`
		Version     string `json:"version"`
		Language    string `json:"language"`
		License     string `json:"license"`
		Attribution string `json:"attribution"`
		Notice      string `json:"notice"`
		ClipCount   int    `json:"clipCount"`
	}
	out := make([]packJSON, 0, len(packs))
	for _, p := range packs {
		out = append(out, packJSON{p.PackID, p.Name, p.Version, p.Language, p.License, p.Attribution, p.Notice, p.ClipCount})
	}
	writeJSON(w, http.StatusOK, out)
}

// handleAudioCredits serves GET /api/audio-packs/{id}/credits?offset=&limit=:
// the per-recording credits of one pack as text fields only (no clip
// URLs), limit at most 500 (audio.Credits). Public; an unknown pack is 404.
func (s *server) handleAudioCredits(w http.ResponseWriter, r *http.Request) {
	offset, limit := 0, defaultCreditsLimit
	q := r.URL.Query()
	if v := q.Get("offset"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 0 {
			writeError(w, http.StatusBadRequest, "bad_request", "Bad offset.")
			return
		}
		offset = n
	}
	if v := q.Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 {
			writeError(w, http.StatusBadRequest, "bad_request", "Bad limit.")
			return
		}
		limit = n
	}
	page, err := audio.Credits(r.Context(), s.db, r.PathValue("id"), offset, limit)
	if errors.Is(err, audio.ErrPackNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "No such audio pack.")
		return
	}
	if err != nil {
		writeInternal(w, r)
		return
	}
	type creditJSON struct {
		Kind        string `json:"kind"`
		Form        string `json:"form"`
		Reading     string `json:"reading"`
		License     string `json:"license"`
		Attribution string `json:"attribution"`
		Source      string `json:"source"`
	}
	resp := struct {
		Total  int          `json:"total"`
		Offset int          `json:"offset"`
		Limit  int          `json:"limit"`
		Clips  []creditJSON `json:"clips"`
	}{Total: page.Total, Offset: page.Offset, Limit: page.Limit, Clips: make([]creditJSON, 0, len(page.Credits))}
	for _, c := range page.Credits {
		resp.Clips = append(resp.Clips, creditJSON{c.Kind, c.Form, c.Reading, c.License, c.Attribution, c.Source})
	}
	writeJSON(w, http.StatusOK, resp)
}
