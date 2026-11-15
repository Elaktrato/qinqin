package api

import (
	"database/sql"
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
	maxCreditsLimit     = 500
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
		http.Error(w, "internal error", http.StatusInternalServerError)
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
		http.Error(w, "malformed request body", http.StatusBadRequest)
		return
	}
	if len(in.EntryIDs) > maxAudioResolveIDs {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "too many entryIds (at most 200)"})
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
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		res, err := s.resolveEntry(r, e)
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
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
		http.NotFound(w, r)
		return
	}
	sha, ext := m[1], m[2]
	var one int
	err := s.db.QueryRowContext(r.Context(), `
		SELECT 1 FROM audio_clips c JOIN audio_packs p ON p.id = c.pack_id
		WHERE c.sha256 = ? AND c.ext = ? AND p.deleted_at IS NULL LIMIT 1`, sha, ext).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	f, err := os.Open(audio.BlobPath(filepath.Join(s.dataDir, "audio"), sha, ext))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	h := w.Header()
	h.Set("Content-Type", audio.ContentType(ext))
	h.Set("Cache-Control", "private, max-age=31536000, immutable")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("ETag", `"`+sha+`"`)
	http.ServeContent(w, r, "", info.ModTime(), f)
}

// handleListAudioPacks serves GET /api/audio-packs: the installed audio
// packs with their terms and clip counts, for the Sources page. Public.
func (s *server) handleListAudioPacks(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.QueryContext(r.Context(), `
		SELECT p.pack_id, p.name, p.version, p.language, p.license, p.attribution, p.notice,
			(SELECT COUNT(*) FROM audio_clips c WHERE c.pack_id = p.id)
		FROM audio_packs p WHERE p.deleted_at IS NULL ORDER BY p.id`)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()
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
	out := []packJSON{}
	for rows.Next() {
		var p packJSON
		if err := rows.Scan(&p.PackID, &p.Name, &p.Version, &p.Language, &p.License, &p.Attribution, &p.Notice, &p.ClipCount); err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		out = append(out, p)
	}
	if rows.Err() != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// handleAudioCredits serves GET /api/audio-packs/{id}/credits?offset=&limit=:
// the per-recording credits of one pack as text fields only (no clip
// URLs), limit at most 500. Public; an unknown pack is 404.
func (s *server) handleAudioCredits(w http.ResponseWriter, r *http.Request) {
	offset, limit := 0, defaultCreditsLimit
	q := r.URL.Query()
	if v := q.Get("offset"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 0 {
			http.Error(w, "bad offset", http.StatusBadRequest)
			return
		}
		offset = n
	}
	if v := q.Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 {
			http.Error(w, "bad limit", http.StatusBadRequest)
			return
		}
		limit = min(n, maxCreditsLimit)
	}
	var packRow int64
	err := s.db.QueryRowContext(r.Context(), `SELECT id FROM audio_packs WHERE pack_id = ? AND deleted_at IS NULL`, r.PathValue("id")).Scan(&packRow)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not_found"})
		return
	}
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
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
	}{Offset: offset, Limit: limit, Clips: []creditJSON{}}
	if err := s.db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM audio_clips WHERE pack_id = ?`, packRow).Scan(&resp.Total); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	rows, err := s.db.QueryContext(r.Context(), `
		SELECT kind, form, reading_key, license, attribution, source
		FROM audio_clips WHERE pack_id = ? ORDER BY id LIMIT ? OFFSET ?`, packRow, limit, offset)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var c creditJSON
		if err := rows.Scan(&c.Kind, &c.Form, &c.Reading, &c.License, &c.Attribution, &c.Source); err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		resp.Clips = append(resp.Clips, c)
	}
	if rows.Err() != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}
