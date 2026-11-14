package api

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"

	"qinqin/internal/dict"
)

// maxPackMemory bounds the bytes of an uploaded pack held in memory
// before the rest spills to a temp file.
const maxPackMemory = 32 << 20

// packSlug matches the manifest ids and versions usable as directory
// names under <data>/packs/: one path component, no separators, no
// leading dot.
var packSlug = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*$`)

// dictionaryBody is one installed dictionary as served by the
// /api/dictionaries routes: the body of the list and install responses.
type dictionaryBody struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	Version     string `json:"version"`
	License     string `json:"license"`
	Attribution string `json:"attribution"`
	Notice      string `json:"notice"`
}

// handleListDictionaries serves GET /api/dictionaries with every
// installed dictionary, in install order.
func (s *server) handleListDictionaries(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.QueryContext(r.Context(), `
		SELECT id, name, version, license, attribution, notice FROM dictionaries
		WHERE deleted_at IS NULL
		ORDER BY id`)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	list := make([]dictionaryBody, 0)
	for rows.Next() {
		d, err := scanDictionary(rows)
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		list = append(list, d)
	}
	if err := rows.Err(); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// handleInstallDictionary serves POST /api/admin/dictionaries: an admin
// uploads a dictionary pack as a zip in the multipart "pack" field. The
// pack is extracted, imported, and stored under
// <data>/packs/<id>-<version>/; a rejected upload never disturbs an
// installed pack's files. Packs of other types (levels, sentences)
// become installable through their own importers in later tasks.
func (s *server) handleInstallDictionary(w http.ResponseWriter, r *http.Request) {
	u := s.requireAdmin(w, r)
	if u == nil {
		return
	}
	if err := r.ParseMultipartForm(maxPackMemory); err != nil {
		http.Error(w, "multipart form with a pack zip required", http.StatusBadRequest)
		return
	}
	file, _, err := r.FormFile("pack")
	if err != nil {
		http.Error(w, `multipart field "pack" with the pack zip required`, http.StatusBadRequest)
		return
	}
	defer file.Close()

	packsDir := filepath.Join(s.dataDir, "packs")
	if err := os.MkdirAll(packsDir, 0o755); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	// The extraction stages inside packsDir, so moving the pack into its
	// installed place is a same-directory rename.
	stage, err := os.MkdirTemp(packsDir, ".stage-")
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	defer func() {
		if stage != "" {
			os.RemoveAll(stage)
		}
	}()
	if err := dict.ExtractZip(file, stage); err != nil {
		http.Error(w, "invalid pack zip", http.StatusBadRequest)
		return
	}
	pack, err := dict.LoadPack(stage)
	if err != nil {
		http.Error(w, "invalid pack", http.StatusBadRequest)
		return
	}
	if pack.Manifest.Type != dict.TypeDictionary {
		http.Error(w, "only dictionary packs install here", http.StatusBadRequest)
		return
	}
	dest, err := packDir(packsDir, pack.Manifest)
	if err != nil {
		http.Error(w, "invalid pack", http.StatusBadRequest)
		return
	}
	// One transaction: a failed import leaves nothing behind.
	if _, err := dict.ImportLexicon(r.Context(), s.db, &pack); err != nil {
		if errors.Is(err, dict.ErrInvalidPack) {
			http.Error(w, "invalid pack", http.StatusBadRequest)
			return
		}
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if err := os.RemoveAll(dest); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if err := os.Rename(stage, dest); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	stage = "" // renamed into place; nothing left to clean up

	d, err := scanDictionary(s.db.QueryRowContext(r.Context(), `
		SELECT id, name, version, license, attribution, notice FROM dictionaries
		WHERE pack_id = ? AND deleted_at IS NULL`, pack.Manifest.ID))
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusCreated, d)
}

// handleUninstallDictionary serves DELETE /api/admin/dictionaries/{id}:
// the dictionary and its senses are soft-deleted; entries survive.
func (s *server) handleUninstallDictionary(w http.ResponseWriter, r *http.Request) {
	u := s.requireAdmin(w, r)
	if u == nil {
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "dictionary not found", http.StatusNotFound)
		return
	}
	if err := dict.Uninstall(r.Context(), s.db, id); err != nil {
		if errors.Is(err, dict.ErrNotFound) {
			http.Error(w, "dictionary not found", http.StatusNotFound)
			return
		}
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// packDir returns the pack's install directory under packsDir,
// rejecting manifest ids and versions unusable as a path component.
func packDir(packsDir string, m dict.Manifest) (string, error) {
	if !packSlug.MatchString(m.ID) || !packSlug.MatchString(m.Version) {
		return "", fmt.Errorf("manifest id %q or version %q is not a safe directory name", m.ID, m.Version)
	}
	return filepath.Join(packsDir, m.ID+"-"+m.Version), nil
}

// scanDictionary reads one dictionary row into its response body.
func scanDictionary(row rowScanner) (dictionaryBody, error) {
	var d dictionaryBody
	if err := row.Scan(&d.ID, &d.Name, &d.Version, &d.License, &d.Attribution, &d.Notice); err != nil {
		return d, err
	}
	return d, nil
}
