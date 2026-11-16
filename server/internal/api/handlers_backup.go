package api

import (
	"errors"
	"io"
	"log"
	"net/http"
	"regexp"
	"sync"
	"time"

	"qinqin/internal/auth"
	"qinqin/internal/backup"
)

// Ticket kinds.
const (
	ticketExport       = "export"
	ticketSafety       = "safety-export"
	ticketServerBackup = "server-backup"
)

// backupState tracks work that must not overlap: one export, one restore
// per user, one server backup.
type backupState struct {
	mu        sync.Mutex
	exporting map[int64]bool
	restoring map[int64]bool
	server    bool
}

func newBackupState() backupState {
	return backupState{exporting: map[int64]bool{}, restoring: map[int64]bool{}}
}

// begin marks userID's export running; false when one already is, or a
// restore of that user is.
func (b *backupState) beginExport(userID int64) (ok bool, restoring bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.restoring[userID] {
		return false, true
	}
	if b.exporting[userID] {
		return false, false
	}
	b.exporting[userID] = true
	return true, false
}

func (b *backupState) endExport(userID int64) {
	b.mu.Lock()
	delete(b.exporting, userID)
	b.mu.Unlock()
}

func (b *backupState) isExporting(userID int64) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.exporting[userID]
}

func (b *backupState) isRestoring(userID int64) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.restoring[userID]
}

// handleExportStart serves POST /api/account/export: it issues a 60 s
// single-use download ticket for the caller's own data. Six per hour.
func (s *server) handleExportStart(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	if s.backups.isExporting(u.ID) {
		writeAuthError(w, http.StatusConflict, "export_running", "An export of your data is already running.")
		return
	}
	if s.backups.isRestoring(u.ID) {
		writeAuthError(w, http.StatusConflict, "restore_running", "A restore of your data is running. Wait until it has finished.")
		return
	}
	if ok, retry := s.authLimiter("export").Allow(int64Key(u.ID)); !ok {
		writeRateLimitedAs(w, retry, "exports")
		return
	}
	// A dry run first: never hand out a link to an archive this server would
	// refuse to restore (upload, expanded-size or book-size cap).
	started, _ := s.backups.beginExport(u.ID)
	if !started {
		writeAuthError(w, http.StatusConflict, "export_running", "An export of your data is already running.")
		return
	}
	_, err := backup.WriteUser(r.Context(), s.db, s.dataDir, u.ID, io.Discard, backup.Meta{
		AppVersion: backup.AppVersion, Now: s.now(), MaxBytes: s.exportLimit()})
	s.backups.endExport(u.ID)
	switch {
	case errors.Is(err, backup.ErrTooLargeToRestore):
		writeAuthError(w, http.StatusUnprocessableEntity, "backup_too_large_to_restore",
			"Your data is larger than a restore can take (128 MiB as a download, 2 GiB expanded, 64 MiB per book). Delete large books or old material first, or ask the administrator for a server backup.")
		return
	case err != nil && r.Context().Err() != nil:
		writeClientGone(w)
		return
	case err != nil:
		log.Printf("backup: export check of user %d failed: %v", u.ID, err)
		writeInternal(w, r)
		return
	}
	token := s.tickets.issue(u.ID, ticketExport, ticketTTL, s.now())
	writeJSON(w, http.StatusOK, map[string]any{"url": "/api/account/export/" + token, "expiresInSeconds": int(ticketTTL.Seconds())})
}

// exportLimit is the largest compressed export: what a restore accepts.
func (s *server) exportLimit() int64 {
	if s.exportCap > 0 {
		return s.exportCap
	}
	return backup.MaxUpload
}

var unsafeNameChars = regexp.MustCompile(`[^A-Za-z0-9._-]`)

// downloadName builds qinqin-<username>-<YYYYMMDD-HHMMSS>.<ext>.
func downloadName(prefix, username string, at time.Time, ext string) string {
	name := prefix
	if username != "" {
		name += "-" + unsafeNameChars.ReplaceAllString(username, "_")
	}
	return name + "-" + at.UTC().Format("20060102-150405") + "." + ext
}

// trackWriter notes whether anything reached the client yet.
type trackWriter struct {
	http.ResponseWriter
	wrote bool
}

func (t *trackWriter) Write(p []byte) (int, error) {
	t.wrote = true
	return t.ResponseWriter.Write(p)
}

func (t *trackWriter) Flush() {
	if f, ok := t.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// handleExportDownload serves GET /api/account/export/{ticket}: the live
// ticket is the credential; everything else is 404. The zip is streamed.
func (s *server) handleExportDownload(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	uid, ok := s.tickets.consume(r.PathValue("ticket"), ticketExport, s.now())
	if !ok {
		writeAuthError(w, http.StatusNotFound, "not_found", "This download link is not valid any more.")
		return
	}
	started, restoring := s.backups.beginExport(uid)
	if !started {
		code, msg := "export_running", "An export of your data is already running."
		if restoring {
			code, msg = "restore_running", "A restore of your data is running. Wait until it has finished."
		}
		writeAuthError(w, http.StatusConflict, code, msg)
		return
	}
	defer s.backups.endExport(uid)
	var username string
	if err := s.db.QueryRowContext(r.Context(), `SELECT username FROM users WHERE id = ? AND disabled_at IS NULL`, uid).Scan(&username); err != nil {
		writeAuthError(w, http.StatusNotFound, "not_found", "This download link is not valid any more.")
		return
	}
	now := s.now()
	tw := &trackWriter{ResponseWriter: w}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="`+downloadName("qinqin", username, now, "zip")+`"`)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	man, err := backup.WriteUser(r.Context(), s.db, s.dataDir, uid, tw, backup.Meta{
		AppVersion: backup.AppVersion, SchemaVersion: backup.SchemaVersion(r.Context(), s.db), Now: now, MaxBytes: s.exportLimit()})
	if err != nil {
		if !errors.Is(err, r.Context().Err()) || r.Context().Err() == nil {
			log.Printf("backup: export of user %d failed: %v", uid, err)
		}
		if !tw.wrote {
			w.Header().Del("Content-Disposition")
			writeInternal(w, r)
			return
		}
		// Part of the file is out: end the connection so the download fails
		// instead of looking complete.
		panic(http.ErrAbortHandler)
	}
	if err := auth.Audit(r.Context(), s.db, auth.AuditEvent{Action: "data_exported", ActorID: uid, TargetID: &uid,
		Detail: map[string]any{"count": man.Counts["events"]}}); err != nil {
		log.Printf("backup: audit of export of user %d: %v", uid, err)
	}
}
