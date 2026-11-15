package api

import (
	"errors"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"qinqin/internal/dict"
	"qinqin/internal/packs"
)

// handleListPacks serves GET /api/admin/packs: every live pack of every
// type with the licence and attribution it was installed under, as the
// pack stated them. Packs without a recorded licence (sentence packs
// imported before the registry) list with empty fields; the web shows
// them as "Licence not recorded".
func (s *server) handleListPacks(w http.ResponseWriter, r *http.Request) {
	if u := s.requireAdmin(w, r); u == nil {
		return
	}
	list, err := packs.List(r.Context(), s.db)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if list == nil {
		list = []packs.Installed{}
	}
	writeJSON(w, http.StatusOK, list)
}

// handleUninstallPack serves DELETE /api/admin/packs/{type}/{packId}:
// uninstalls one pack of any type. Pack files under <data>/packs stay.
func (s *server) handleUninstallPack(w http.ResponseWriter, r *http.Request) {
	if u := s.requireAdmin(w, r); u == nil {
		return
	}
	s.packMu.Lock()
	defer s.packMu.Unlock()
	err := packs.Uninstall(r.Context(), s.db, r.PathValue("type"), r.PathValue("packId"))
	switch {
	case errors.Is(err, packs.ErrUnknownType):
		http.Error(w, "unknown pack type", http.StatusNotFound)
	case errors.Is(err, packs.ErrNotFound):
		http.Error(w, "pack not found", http.StatusNotFound)
	case err != nil:
		http.Error(w, "internal error", http.StatusInternalServerError)
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

// sentencePackBody is one registered sentence pack on the public list.
type sentencePackBody struct {
	PackID      string `json:"packId"`
	Name        string `json:"name"`
	Version     string `json:"version"`
	Language    string `json:"language"`
	License     string `json:"license"`
	Attribution string `json:"attribution"`
	Notice      string `json:"notice"`
}

// handleListSentencePacks serves GET /api/sentence-packs: the live
// registered sentence packs by name, public like the other pack lists so
// the Sources page can credit them. Legacy packs without a registry row
// have nothing to credit and are not listed.
func (s *server) handleListSentencePacks(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.QueryContext(r.Context(), `
		SELECT pack_id, name, version, language, license, attribution, notice
		FROM sentence_packs WHERE deleted_at IS NULL ORDER BY name, pack_id`)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	list := []sentencePackBody{}
	for rows.Next() {
		var p sentencePackBody
		if err := rows.Scan(&p.PackID, &p.Name, &p.Version, &p.Language, &p.License, &p.Attribution, &p.Notice); err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		list = append(list, p)
	}
	if err := rows.Err(); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// packErrorText turns an import or extraction error into text safe to
// show: validation and zip-limit reasons are kept, filesystem paths never
// are. Errors that are not the pack's fault read "import failed" and go
// to the server log.
func packErrorText(err error, paths ...string) string {
	if !errors.Is(err, dict.ErrInvalidPack) {
		log.Printf("pack: %v", err)
		return "import failed — see the server log"
	}
	msg := err.Error()
	for _, p := range paths {
		if p != "" {
			msg = strings.ReplaceAll(msg, p, "pack")
		}
	}
	if i := strings.Index(msg, "invalid pack: "); i >= 0 {
		msg = msg[i+len("invalid pack: "):]
	}
	return "invalid pack: " + msg
}

// stagedManifest is the manifest as the server parsed it.
type stagedManifest struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Version     string `json:"version"`
	Type        string `json:"type"`
	Language    string `json:"language"`
	License     string `json:"license"`
	Attribution string `json:"attribution"`
	Notice      string `json:"notice"`
	Format      string `json:"format"`
}

// stagedReplaces is what installing a staged pack would replace.
type stagedReplaces struct {
	Version     string `json:"version"`
	License     string `json:"license"`
	Attribution string `json:"attribution"`
}

// stagedResponse is the body of a successful POST /api/admin/packs.
type stagedResponse struct {
	Token     string          `json:"token"`
	ExpiresAt string          `json:"expiresAt"`
	Manifest  stagedManifest  `json:"manifest"`
	Replaces  *stagedReplaces `json:"replaces"`
	Files     int             `json:"files"`
	Bytes     int64           `json:"bytes"`
}

const tooLargeMessage = "pack zip larger than 128 MiB — use qinqin seed for larger packs"

// handleStagePack serves POST /api/admin/packs: the multipart "pack" zip
// is extracted and validated into a stage directory and described back
// (manifest as parsed, what it would replace) so the admin can review the
// licence before anything is imported.
func (s *server) handleStagePack(w http.ResponseWriter, r *http.Request) {
	u := s.requireAdmin(w, r)
	if u == nil {
		return
	}
	packsDir := filepath.Join(s.dataDir, "packs")
	if err := os.MkdirAll(packsDir, 0o755); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	s.sweepStages(packsDir)
	ss := s.stages()
	if ss.live(s.now()) >= maxStages {
		http.Error(w, "finish or discard a staged pack first", http.StatusTooManyRequests)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxPackUpload+1<<20)
	if err := r.ParseMultipartForm(maxPackMemory); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			http.Error(w, tooLargeMessage, http.StatusRequestEntityTooLarge)
			return
		}
		http.Error(w, "multipart form with a pack zip required", http.StatusBadRequest)
		return
	}
	defer r.MultipartForm.RemoveAll()
	file, header, err := r.FormFile("pack")
	if err != nil {
		http.Error(w, `multipart field "pack" with the pack zip required`, http.StatusBadRequest)
		return
	}
	defer file.Close()
	if header.Size > maxPackUpload {
		http.Error(w, tooLargeMessage, http.StatusRequestEntityTooLarge)
		return
	}
	ra, ok := file.(io.ReaderAt)
	if !ok {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	token, err := newToken()
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	dir := filepath.Join(packsDir, ".stage-"+token)
	if err := os.Mkdir(dir, 0o755); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	staged := false
	defer func() {
		if !staged {
			os.RemoveAll(dir)
		}
	}()
	if err := dict.ExtractZipAt(ra, header.Size, dir, dict.DefaultZipLimits); err != nil {
		http.Error(w, packErrorText(err, dir, s.dataDir), http.StatusBadRequest)
		return
	}
	pack, err := dict.LoadExtracted(dir)
	if err != nil {
		http.Error(w, packErrorText(err, dir, s.dataDir), http.StatusBadRequest)
		return
	}
	m := pack.Manifest
	if _, err := packDir(packsDir, m); err != nil {
		http.Error(w, "invalid pack: the id and version must be plain names", http.StatusBadRequest)
		return
	}
	resp := stagedResponse{Token: token, Manifest: stagedManifest{ID: m.ID, Name: m.Name, Version: m.Version,
		Type: m.Type, Language: m.Language, License: m.License, Attribution: m.Attribution, Notice: m.Notice, Format: m.Format}}
	switch old, err := packs.Find(r.Context(), s.db, m.Type, m.ID); {
	case err == nil:
		resp.Replaces = &stagedReplaces{Version: old.Version, License: old.License, Attribution: old.Attribution}
	case !errors.Is(err, packs.ErrNotFound):
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	filepath.WalkDir(pack.Dir, func(_ string, d fs.DirEntry, err error) error {
		if err == nil && d.Type().IsRegular() {
			resp.Files++
			if info, err := d.Info(); err == nil {
				resp.Bytes += info.Size()
			}
		}
		return nil
	})
	now := s.now()
	st := &stagedPack{token: token, dir: dir, root: pack.Dir, userID: u.ID, pack: pack, expires: now.Add(stageTTL), status: stageStaged}
	if !ss.put(st, now) {
		http.Error(w, "finish or discard a staged pack first", http.StatusTooManyRequests)
		return
	}
	staged = true
	resp.ExpiresAt = st.expires.UTC().Format(time.RFC3339)
	writeJSON(w, http.StatusCreated, resp)
}

// handleDiscardStaged serves DELETE /api/admin/packs/staged/{token}.
func (s *server) handleDiscardStaged(w http.ResponseWriter, r *http.Request) {
	u := s.requireAdmin(w, r)
	if u == nil {
		return
	}
	dir, found, busy := s.stages().discard(r.PathValue("token"), u.ID, s.now())
	switch {
	case !found:
		http.Error(w, "staged pack not found", http.StatusNotFound)
	case busy:
		http.Error(w, "already importing", http.StatusConflict)
	default:
		os.RemoveAll(dir)
		w.WriteHeader(http.StatusNoContent)
	}
}
