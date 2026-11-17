package api

import (
	"errors"
	"net/http"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"qinqin/internal/datapkg"
)

// Data packages (docs/contracts/packages/): the catalogue and the files.

// maxDownloadsPerUser caps the package downloads one user runs at once
// (sessions and tokens together); a further one is 429 download_busy.
const maxDownloadsPerUser = 2

// maxCatalogueLanguages caps the ?languages= list of the catalogue.
const maxCatalogueLanguages = 32

var catalogueLanguage = regexp.MustCompile(`^[a-z]{2,3}(-[a-z0-9]+)*$`)

// packageRevision is a revision path segment: a positive decimal integer
// without sign or leading zero, short enough to fit an int.
var packageRevision = regexp.MustCompile(`^[1-9][0-9]{0,8}$`)

// downloadSlots counts the running package downloads per user.
type downloadSlots struct {
	mu sync.Mutex
	n  map[int64]int
}

func (d *downloadSlots) acquire(user int64) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.n[user] >= maxDownloadsPerUser {
		return false
	}
	if d.n == nil {
		d.n = map[int64]int{}
	}
	d.n[user]++
	return true
}

func (d *downloadSlots) release(user int64) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.n[user] <= 1 {
		delete(d.n, user)
		return
	}
	d.n[user]--
}

func (d *downloadSlots) count(user int64) int {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.n[user]
}

// packageRegistry is the builder's registry, or (without WithPackages) a
// registry over <data>/packages that only reads.
func (s *server) packageRegistry() datapkg.Registry {
	if s.packages != nil {
		return s.packages.Registry()
	}
	return datapkg.Registry{DB: s.db, Dir: filepath.Join(s.dataDir, "packages"), AudioDir: filepath.Join(s.dataDir, "audio")}
}

// handlePackageCatalogue serves GET /api/packages[?languages=zh,ja|all]:
// the packages of the caller's workspace languages (or of the listed ones),
// tombstones included. It holds no user data; the build error of a row is
// shown to an administrator's own session only. ETag and If-None-Match
// make a poll cheap.
func (s *server) handlePackageCatalogue(w http.ResponseWriter, r *http.Request) {
	p := s.requirePrincipal(w, r)
	if p == nil {
		return
	}
	var languages []string
	if r.URL.Query().Has("languages") {
		var ok bool
		if languages, ok = parseCatalogueLanguages(r.URL.Query().Get("languages")); !ok {
			writeAuthError(w, http.StatusBadRequest, "bad_request", "languages must be all or a comma-separated list of language codes.")
			return
		}
	} else {
		var err error
		if languages, err = s.workspaceLanguages(r, p.User.ID); err != nil {
			writeInternal(w, r)
			return
		}
	}
	cat, err := s.packageRegistry().Catalogue(r.Context(), languages, p.User.Admin && !p.ViaToken())
	if err != nil {
		writeInternal(w, r)
		return
	}
	h := w.Header()
	h.Set("ETag", cat.ETag)
	h.Set("Cache-Control", "no-cache")
	if etagListed(r.Header.Get("If-None-Match"), cat.ETag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	writeJSON(w, http.StatusOK, cat)
}

// parseCatalogueLanguages reads ?languages=: "all", or 1 to 32 distinct
// lowercase language codes separated by commas.
func parseCatalogueLanguages(v string) ([]string, bool) {
	if v == datapkg.AllLanguages {
		return []string{datapkg.AllLanguages}, true
	}
	parts := strings.Split(v, ",")
	if len(parts) > maxCatalogueLanguages {
		return nil, false
	}
	for _, l := range parts {
		if len(l) > 35 || !catalogueLanguage.MatchString(l) {
			return nil, false
		}
	}
	return parts, true
}

// workspaceLanguages lists the distinct languages of the user's workspaces.
func (s *server) workspaceLanguages(r *http.Request, userID int64) ([]string, error) {
	rows, err := s.db.QueryContext(r.Context(), `SELECT DISTINCT language FROM workspaces WHERE user_id = ? ORDER BY language`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	langs := []string{}
	for rows.Next() {
		var l string
		if err := rows.Scan(&l); err != nil {
			return nil, err
		}
		langs = append(langs, l)
	}
	return langs, rows.Err()
}

// etagListed reports whether an If-None-Match header names etag (or *).
func etagListed(header, etag string) bool {
	for _, t := range strings.Split(header, ",") {
		t = strings.TrimPrefix(strings.TrimSpace(t), "W/")
		if t == "*" || (t != "" && t == etag) {
			return true
		}
	}
	return false
}

// handlePackageDownload serves GET /api/packages/{id}/{revision}: the
// package file, resumable (Range, If-Range) through http.ServeContent on
// the open file. The path is built by the registry from the validated id
// and the integer revision only. At most two downloads per user run at once.
func (s *server) handlePackageDownload(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	notFound := func() {
		writeAuthError(w, http.StatusNotFound, "package_not_found", "No data package with that id and revision.")
	}
	rev := r.PathValue("revision")
	if !packageRevision.MatchString(rev) {
		notFound()
		return
	}
	revision, err := strconv.Atoi(rev)
	if err != nil {
		notFound()
		return
	}
	f, info, err := s.packageRegistry().Open(r.Context(), r.PathValue("id"), revision)
	switch {
	case errors.Is(err, datapkg.ErrNotFound):
		notFound()
		return
	case errors.Is(err, datapkg.ErrGone):
		writeAuthError(w, http.StatusGone, "package_revision_gone", "That package revision was replaced. Read the catalogue and download the current one.")
		return
	case err != nil:
		writeInternal(w, r)
		return
	}
	defer f.Close()
	if !s.downloads.acquire(u.ID) {
		w.Header().Set("Retry-After", "5")
		writeAuthError(w, http.StatusTooManyRequests, "download_busy",
			"Two package downloads are already running for this account. Try again when one has finished.")
		return
	}
	defer s.downloads.release(u.ID)
	h := w.Header()
	h.Set("ETag", `"`+info.SHA256+`"`)
	h.Set("Cache-Control", "private, max-age=31536000, immutable")
	h.Set("Content-Type", "application/zip")
	// The zero modification time: the ETag alone validates (a rebuilt file
	// of the same revision after a restore has a new time, not new bytes
	// that matter to the client rule).
	http.ServeContent(w, r, "", time.Time{}, f)
}
