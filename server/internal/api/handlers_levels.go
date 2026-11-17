package api

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"qinqin/internal/dict"
	"qinqin/internal/levels"
	"qinqin/internal/lexicon"
)

// handleSchemeEntries serves GET /api/schemes/{id}/entries: the scheme's
// member entries — words and derived characters — across all its active
// levels, or only one level's when ?level names it. It is public; an
// unknown scheme or level name is 404.
func (s *server) handleSchemeEntries(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "scheme not found", http.StatusNotFound)
		return
	}
	var ids []int64
	if q := r.URL.Query(); q.Has("level") {
		ids, err = levels.EntryIDs(r.Context(), s.db, id, q.Get("level"))
	} else {
		ids, err = levels.SchemeEntryIDs(r.Context(), s.db, id)
	}
	if errors.Is(err, levels.ErrNotFound) {
		http.Error(w, "scheme or level not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	store := lexicon.Store{DB: s.db}
	es, err := store.GetMany(r.Context(), ids)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	list, err := entryBases(r.Context(), store, es)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// handleListSchemes serves GET /api/schemes with every installed scheme,
// in install order, each with its ordered levels.
func (s *server) handleListSchemes(w http.ResponseWriter, r *http.Request) {
	list, err := levels.List(r.Context(), s.db)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// handleUninstallScheme serves DELETE /api/admin/schemes/{id}: the
// scheme, its levels, and its memberships are soft-deleted; entries
// survive. Admin upload routes dispatch packs by manifest type, so
// levels packs install through their own importer — the seed CLI wires
// it.
func (s *server) handleUninstallScheme(w http.ResponseWriter, r *http.Request) {
	u := s.requireAdmin(w, r)
	if u == nil {
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "scheme not found", http.StatusNotFound)
		return
	}
	s.packMu.Lock()
	defer s.packMu.Unlock()
	var packID, language string
	s.db.QueryRowContext(r.Context(), `SELECT pack_id, language FROM schemes WHERE id = ?`, id).Scan(&packID, &language)
	if err := levels.Uninstall(r.Context(), s.db, id); err != nil {
		if errors.Is(err, levels.ErrNotFound) {
			http.Error(w, "scheme not found", http.StatusNotFound)
			return
		}
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	s.packChanged(dict.TypeLevels, packID, language)
	w.WriteHeader(http.StatusNoContent)
}

// schemeCharsFormat versions the body of GET /api/schemes/{id}/characters
// inside its ETag, so a shape change never earns a 304.
const schemeCharsFormat = 1

// handleSchemeCharacters serves GET /api/schemes/{id}/characters: the
// scheme's active levels in order, each with its Han characters as one
// string (see levels.SchemeCharacters), for the mastery map's scheme
// grouping. It is public like GET /api/schemes; an unknown, uninstalled
// or malformed scheme id is 404. The body carries a weak ETag over the
// scheme's level and membership stamps and counts, revalidates each visit
// (a match is a bodyless 304) and is gzip-compressed when accepted.
func (s *server) handleSchemeCharacters(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "scheme not found", http.StatusNotFound)
		return
	}
	version, err := levels.SchemeVersion(r.Context(), s.db, id)
	if errors.Is(err, levels.ErrNotFound) {
		http.Error(w, "scheme not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	sum := sha256.Sum256([]byte(version))
	etag := fmt.Sprintf(`W/"schemechars%d-%d-%s"`, schemeCharsFormat, id, hex.EncodeToString(sum[:8]))
	h := w.Header()
	h.Set("Cache-Control", "private, max-age=0, must-revalidate")
	h.Set("Vary", "Accept-Encoding")
	h.Set("ETag", etag)
	if etagMatches(r.Header.Get("If-None-Match"), etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}

	list, err := levels.SchemeCharacters(r.Context(), s.db, id)
	if errors.Is(err, levels.ErrNotFound) {
		http.Error(w, "scheme not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	var raw bytes.Buffer
	enc := json.NewEncoder(&raw)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(struct {
		Levels []levels.LevelChars `json:"levels"`
	}{list}); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	body := bytes.TrimSuffix(raw.Bytes(), []byte("\n"))
	if acceptsGzip(r.Header.Get("Accept-Encoding")) {
		var gz bytes.Buffer
		zw := gzip.NewWriter(&gz)
		if _, err := zw.Write(body); err != nil || zw.Close() != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		h.Set("Content-Encoding", "gzip")
		body = gz.Bytes()
	}
	h.Set("Content-Type", "application/json")
	h.Set("Content-Length", strconv.Itoa(len(body)))
	w.WriteHeader(http.StatusOK)
	w.Write(body)
}
