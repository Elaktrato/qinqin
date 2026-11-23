package api

import (
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

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
	PackID      string `json:"packId"`
	Language    string `json:"language"`
}

// handleListDictionaries serves GET /api/dictionaries with every
// installed dictionary, in install order.
func (s *server) handleListDictionaries(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.QueryContext(r.Context(), `
		SELECT id, name, version, license, attribution, notice, pack_id, language FROM dictionaries
		WHERE deleted_at IS NULL
		ORDER BY id`)
	if err != nil {
		writeInternal(w, r)
		return
	}
	defer rows.Close()
	list := make([]dictionaryBody, 0)
	for rows.Next() {
		d, err := scanDictionary(rows)
		if err != nil {
			writeInternal(w, r)
			return
		}
		list = append(list, d)
	}
	if err := rows.Err(); err != nil {
		writeInternal(w, r)
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
	r.Body = http.MaxBytesReader(w, r.Body, maxPackUpload+1<<20)
	if err := r.ParseMultipartForm(maxPackMemory); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeError(w, http.StatusRequestEntityTooLarge, "too_large", tooLargeMessage)
			return
		}
		writeError(w, http.StatusBadRequest, "bad_request", "Multipart form with a pack zip required.")
		return
	}
	defer r.MultipartForm.RemoveAll()
	file, header, err := r.FormFile("pack")
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Multipart field \"pack\" with the pack zip required.")
		return
	}
	defer file.Close()

	packsDir := filepath.Join(s.dataDir, "packs")
	if err := os.MkdirAll(packsDir, 0o755); err != nil {
		writeInternal(w, r)
		return
	}
	// The extraction stages inside packsDir, so moving the pack into its
	// installed place is a same-directory rename.
	stage, err := os.MkdirTemp(packsDir, ".stage-")
	if err != nil {
		writeInternal(w, r)
		return
	}
	defer func() {
		if stage != "" {
			os.RemoveAll(stage)
		}
	}()
	ra, ok := file.(io.ReaderAt)
	if !ok || header.Size > maxPackUpload {
		writeError(w, http.StatusRequestEntityTooLarge, "too_large", tooLargeMessage)
		return
	}
	// A failure that is not the pack's (a full disk) is 500 internal.
	if err := dict.ExtractZipAt(ra, header.Size, stage, dict.DefaultZipLimits); err != nil {
		writePackError(w, r, err, stage, s.dataDir)
		return
	}
	pack, err := dict.LoadExtracted(stage)
	if err != nil {
		writePackError(w, r, err, stage, s.dataDir)
		return
	}
	if pack.Manifest.Type != dict.TypeDictionary {
		writeError(w, http.StatusBadRequest, "pack_invalid", "Only dictionary packs install here.")
		return
	}
	if _, err := packDir(packsDir, pack.Manifest); err != nil {
		writeError(w, http.StatusBadRequest, "pack_invalid", "Invalid pack.")
		return
	}
	s.packMu.Lock()
	defer s.packMu.Unlock()
	// One transaction: a failed import leaves nothing behind.
	if _, err := dict.ImportLexicon(r.Context(), s.db, &pack); err != nil {
		if errors.Is(err, dict.ErrInvalidPack) {
			writeError(w, http.StatusBadRequest, "pack_invalid", "Invalid pack.")
			return
		}
		writeInternal(w, r)
		return
	}
	registryID, _, _ := dict.RegistryTerms(pack.Manifest)
	s.packChanged(dict.TypeDictionary, registryID, pack.Manifest.Language)
	legacyToken, _ := newToken()
	if err := placePack(packsDir, pack.Manifest, pack.Dir, legacyToken); err != nil {
		// The import is committed: the dictionary is installed. The files
		// are only a re-install copy, so a failed move is logged, not a 500.
		log.Printf("dictionary %s: move files into place: %v", pack.Manifest.ID, err)
	}
	// pack.Dir is the stage itself or the one folder inside it; the
	// deferred cleanup removes what is left of the stage.

	d, err := scanDictionary(s.db.QueryRowContext(r.Context(), `
		SELECT id, name, version, license, attribution, notice, pack_id, language FROM dictionaries
		WHERE pack_id = ? AND deleted_at IS NULL`, pack.Manifest.ID))
	if err != nil {
		writeInternal(w, r)
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
		writeError(w, http.StatusNotFound, "not_found", "Dictionary not found.")
		return
	}
	s.packMu.Lock()
	defer s.packMu.Unlock()
	// Read before the uninstall: the data packages hang off pack id and language.
	var packID, language string
	s.db.QueryRowContext(r.Context(), `SELECT pack_id, language FROM dictionaries WHERE id = ?`, id).Scan(&packID, &language)
	if err := dict.Uninstall(r.Context(), s.db, id); err != nil {
		if errors.Is(err, dict.ErrNotFound) {
			writeError(w, http.StatusNotFound, "not_found", "Dictionary not found.")
			return
		}
		writeInternal(w, r)
		return
	}
	s.packChanged(dict.TypeDictionary, packID, language)
	w.WriteHeader(http.StatusNoContent)
}

// packDir returns the pack's install directory: <packs>/<type>/<id>/<version>.
// Nesting by type and id means no two packs can share a directory whatever
// characters their ids and versions contain (a flat <id>-<version> name made
// es-test/1.0 and es/test-1.0 the same directory). Ids and versions must be
// plain names, and the result is checked to lie inside packsDir.
func packDir(packsDir string, m dict.Manifest) (string, error) {
	if !packSlug.MatchString(m.ID) || !packSlug.MatchString(m.Version) || !packSlug.MatchString(m.Type) {
		return "", fmt.Errorf("manifest id %q or version %q is not a safe directory name", m.ID, m.Version)
	}
	dest := filepath.Join(packsDir, m.Type, m.ID, m.Version)
	rel, err := filepath.Rel(packsDir, dest)
	if err != nil || rel == "." || strings.HasPrefix(rel, "..") || strings.Count(rel, string(filepath.Separator)) != 2 {
		return "", fmt.Errorf("pack directory for %q escapes the packs directory", m.ID)
	}
	return dest, nil
}

// placePack moves the extracted pack at src into its install directory.
// An installed copy is renamed aside first and removed only once the new
// files are in place, so a failed move leaves the old files as they were.
func placePack(packsDir string, m dict.Manifest, src, token string) error {
	dest, err := packDir(packsDir, m)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return err
	}
	aside := ""
	if _, err := os.Lstat(dest); err == nil {
		aside = dest + ".old-" + token
		if err := os.Rename(dest, aside); err != nil {
			return err
		}
	}
	if err := os.Rename(src, dest); err != nil {
		if aside != "" {
			os.Rename(aside, dest)
		}
		return err
	}
	if aside != "" {
		os.RemoveAll(aside)
	}
	return nil
}

// scanDictionary reads one dictionary row into its response body.
func scanDictionary(row rowScanner) (dictionaryBody, error) {
	var d dictionaryBody
	if err := row.Scan(&d.ID, &d.Name, &d.Version, &d.License, &d.Attribution, &d.Notice, &d.PackID, &d.Language); err != nil {
		return d, err
	}
	return d, nil
}
