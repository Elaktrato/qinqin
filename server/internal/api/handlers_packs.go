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
	"qinqin/internal/fonts"
	"qinqin/internal/lemmapack"
	"qinqin/internal/packs"
	"qinqin/internal/themes"
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
	err := packs.Uninstall(r.Context(), s.db, r.PathValue("type"), r.PathValue("packId"),
		packs.WithAudioStore(filepath.Join(s.dataDir, "audio")), packs.WithFontStore(filepath.Join(s.dataDir, "fonts")),
		packs.WithOnChange(s.packChanged))
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
		msg = replacePathPrefix(msg, p)
	}
	if i := strings.Index(msg, "invalid pack: "); i >= 0 {
		msg = msg[i+len("invalid pack: "):]
	}
	return "invalid pack: " + msg
}

// replacePathPrefix replaces each occurrence of path in msg that is a
// whole path prefix (followed by a separator, space, colon or the end,
// and not the tail of a longer name) with "pack".
func replacePathPrefix(msg, path string) string {
	if path == "" {
		return msg
	}
	var out strings.Builder
	for {
		i := strings.Index(msg, path)
		if i < 0 {
			out.WriteString(msg)
			return out.String()
		}
		end := i + len(path)
		boundaryAfter := end == len(msg) || strings.ContainsRune("/ :;,)\"'", rune(msg[end]))
		if boundaryAfter {
			out.WriteString(msg[:i])
			out.WriteString("pack")
		} else {
			out.WriteString(msg[:end])
		}
		msg = msg[end:]
	}
}

// stagedManifest is the manifest as the server parsed it.
type stagedManifest struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Version     string   `json:"version"`
	Type        string   `json:"type"`
	Language    string   `json:"language"`
	Languages   []string `json:"languages,omitempty"` // a strokes pack's languages (it has no language)
	License     string   `json:"license"`
	Attribution string   `json:"attribution"`
	Notice      string   `json:"notice"`
	Format      string   `json:"format"`
}

// stagedReplaces is what installing a staged pack would replace.
type stagedReplaces struct {
	Version     string `json:"version"`
	License     string `json:"license"`
	Attribution string `json:"attribution"`
}

// stagedTheme is one theme of a staged theme pack with its measured
// contrast (docs/contracts/themes/README.md, Contrast): reported for the
// review, never a reason to refuse the pack.
type stagedTheme struct {
	ID      string         `json:"id"`
	Name    string         `json:"name"`
	Family  string         `json:"family"`
	Scheme  string         `json:"scheme"`
	Checks  []themes.Check `json:"checks"`
	Failing int            `json:"failing"`
}

// stagedResponse is the body of a successful POST /api/admin/packs.
// Themes is present for a theme pack only.
type stagedResponse struct {
	Token     string          `json:"token"`
	ExpiresAt string          `json:"expiresAt"`
	Manifest  stagedManifest  `json:"manifest"`
	Replaces  *stagedReplaces `json:"replaces"`
	Files     int             `json:"files"`
	Bytes     int64           `json:"bytes"`
	Themes    []stagedTheme   `json:"themes,omitempty"`
}

const tooLargeMessage = "pack zip larger than 128 MiB — use qinqin seed for larger packs"

// handleStagePack serves POST /api/admin/packs: the multipart "pack" zip
// is streamed to disk, extracted and validated into a stage directory and
// described back (manifest as parsed, what it would replace) so the admin
// can review the licence before anything is imported. A stage slot is
// reserved before the body is read, so concurrent uploads cannot each
// spool a full-size pack.
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
	if !ss.reserve(s.now()) {
		http.Error(w, "finish or discard a staged pack first", http.StatusTooManyRequests)
		return
	}
	reserved := true
	defer func() {
		if reserved {
			ss.release()
		}
	}()

	token, err := newToken()
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	dir := filepath.Join(packsDir, ".stage-"+token)
	zipPath := dir + ".zip"
	staged := false
	defer func() {
		os.Remove(zipPath)
		if !staged {
			os.RemoveAll(dir)
		}
	}()

	r.Body = http.MaxBytesReader(w, r.Body, maxPackUpload+1<<20)
	size, ok := s.receivePackZip(w, r, zipPath)
	if !ok {
		return
	}
	if err := os.Mkdir(dir, 0o755); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	zf, err := os.Open(zipPath)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	defer zf.Close()
	if err := dict.ExtractZipAt(zf, size, dir, dict.DefaultZipLimits); err != nil {
		if !errors.Is(err, dict.ErrInvalidPack) {
			log.Printf("pack: unpack upload: %v", err)
			http.Error(w, "could not unpack the pack — see the server log", http.StatusInternalServerError)
			return
		}
		http.Error(w, packErrorText(err, dir, s.dataDir), http.StatusBadRequest)
		return
	}
	if r.Context().Err() != nil {
		return // the client went away: do not hold a slot for nobody
	}
	pack, err := dict.LoadExtracted(dir)
	if err != nil {
		http.Error(w, packErrorText(err, dir, s.dataDir), http.StatusBadRequest)
		return
	}
	m := pack.Manifest
	if m.Type == dict.TypeAudio {
		http.Error(w, "audio packs cannot be uploaded: install them with scripts/fetch-audio-kanjialive.sh (or the Commons tool) and `qinqin seed`", http.StatusUnprocessableEntity)
		return
	}
	if !packs.Installable(m.Type) {
		http.Error(w, "unsupported pack type: "+m.Type, http.StatusUnprocessableEntity)
		return
	}
	if _, err := packDir(packsDir, m); err != nil {
		http.Error(w, "invalid pack: the id and version must be plain names", http.StatusBadRequest)
		return
	}
	// A theme pack's themes.json is validated now and every theme measured,
	// so the admin reviews the contrast with the licence.
	var review []stagedTheme
	if m.Type == dict.TypeTheme {
		list, err := themes.CheckPack(pack)
		if err != nil {
			http.Error(w, packErrorText(err, dir, s.dataDir), http.StatusBadRequest)
			return
		}
		for _, t := range list {
			checks := themes.Review(t)
			review = append(review, stagedTheme{ID: t.ID, Name: t.Name, Family: t.Family, Scheme: t.Scheme,
				Checks: checks, Failing: themes.Failing(checks)})
		}
	}
	// A font pack's faces.json and every slice file are checked now: a
	// broken pack is refused before the licence review, not after it.
	if m.Type == dict.TypeFont {
		if _, err := fonts.CheckPack(pack); err != nil {
			http.Error(w, packErrorText(err, dir, s.dataDir), http.StatusBadRequest)
			return
		}
	}
	// A lemma-rules pack's table is parsed and bounded now, and a language
	// keeps one live pack: a broken or conflicting table is refused before
	// the licence review.
	if m.Type == dict.TypeLemmaRules {
		_, _, err := lemmapack.CheckPack(pack)
		if err == nil {
			err = lemmapack.CheckLanguage(r.Context(), s.db, m.ID, m.Language)
		}
		if errors.Is(err, dict.ErrInvalidPack) {
			http.Error(w, packErrorText(err, dir, s.dataDir), http.StatusBadRequest)
			return
		}
		if err != nil {
			log.Printf("pack: review lemma-rules pack: %v", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
	}
	// The registry row a pack's import writes can differ from its manifest
	// (KANJIDIC2 stores its fixed terms under a fixed id): review and echo
	// what will actually be stored.
	registryID, license, attribution := m.ID, m.License, m.Attribution
	if m.Type == dict.TypeDictionary {
		registryID, license, attribution = dict.RegistryTerms(m)
	}
	resp := stagedResponse{Token: token, Manifest: stagedManifest{ID: m.ID, Name: m.Name, Version: m.Version,
		Type: m.Type, Language: m.Language, Languages: m.Languages, License: license, Attribution: attribution, Notice: m.Notice, Format: m.Format},
		Themes: review}
	switch old, err := packs.Find(r.Context(), s.db, m.Type, registryID); {
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
	st := &stagedPack{token: token, dir: dir, root: pack.Dir, userID: u.ID, pack: pack, expires: now.Add(stageTTL),
		status: stageStaged, license: license, registryID: registryID}
	ss.put(st) // converts the reservation into a stage
	reserved = false
	staged = true
	resp.ExpiresAt = st.expires.UTC().Format(time.RFC3339)
	writeJSON(w, http.StatusCreated, resp)
}

// receivePackZip streams the multipart "pack" part of the request into
// path and returns its size. It answers the error itself and reports
// false on any problem; the 413 covers both the body cap and the zip cap.
func (s *server) receivePackZip(w http.ResponseWriter, r *http.Request, path string) (int64, bool) {
	tooLarge := func() { http.Error(w, tooLargeMessage, http.StatusRequestEntityTooLarge) }
	mr, err := r.MultipartReader()
	if err != nil {
		http.Error(w, "multipart form with a pack zip required", http.StatusBadRequest)
		return 0, false
	}
	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			http.Error(w, `multipart field "pack" with the pack zip required`, http.StatusBadRequest)
			return 0, false
		}
		if err != nil {
			var big *http.MaxBytesError
			if errors.As(err, &big) {
				tooLarge()
			} else {
				http.Error(w, "multipart form with a pack zip required", http.StatusBadRequest)
			}
			return 0, false
		}
		if part.FormName() != "pack" || part.FileName() == "" {
			continue
		}
		f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return 0, false
		}
		n, err := io.Copy(f, io.LimitReader(part, maxPackUpload+1))
		cerr := f.Close()
		var big *http.MaxBytesError
		switch {
		case errors.As(err, &big) || n > maxPackUpload:
			tooLarge()
			return 0, false
		case err != nil:
			http.Error(w, "the upload was interrupted", http.StatusBadRequest)
			return 0, false
		case cerr != nil:
			http.Error(w, "internal error", http.StatusInternalServerError)
			return 0, false
		}
		return n, true
	}
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
