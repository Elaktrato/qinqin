package api

import (
	"errors"
	"log"
	"net/http"
	"strings"

	"qinqin/internal/auth"
	"qinqin/internal/backup"
)

// handleAdminBackupStart serves POST /api/admin/backup {currentPassword,
// include?}: an administrator asks for a whole-server backup. The archive
// holds password hashes, hashed session tokens and sealed secrets, so it
// asks for the administrator's own password like every destructive admin
// action. The answer is a 60 s single-use ticket URL.
func (s *server) handleAdminBackupStart(w http.ResponseWriter, r *http.Request) {
	admin := s.requireAdmin(w, r)
	if admin == nil {
		return
	}
	var req struct {
		CurrentPassword string   `json:"currentPassword"`
		Code            string   `json:"code"` // authenticator or recovery code, for admins who have one
		Include         []string `json:"include"`
	}
	if !readAccountBodyStrict(w, r, &req) {
		return
	}
	inc, err := backup.ParseInclude(req.Include)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", `include may name "db", "books", "packs" and "audio".`)
		return
	}
	if s.backups.isServerRunning() {
		writeError(w, http.StatusConflict, "backup_running", "A server backup is already running.")
		return
	}
	// The archive holds every password hash: password, and a code from an admin with an authenticator.
	if !s.requireAdminReauth(w, r, admin.ID, req.CurrentPassword, req.Code) {
		return
	}
	if inc.DB {
		if err := backup.CheckSpace(s.dataDir, 0); err != nil {
			s.writeSpaceError(w, r, err)
			return
		}
	}
	if ok, retry := s.authLimiter("server-backup").Allow("all"); !ok {
		writeRateLimitedAs(w, retry, "server backups")
		return
	}
	token := s.tickets.issueExtra(admin.ID, ticketServerBackup, ticketTTL, s.now(), strings.Join(inc.Names(), ","))
	writeJSON(w, http.StatusOK, map[string]any{"url": "/api/admin/backup/" + token, "expiresInSeconds": int(ticketTTL.Seconds()), "include": inc.Names()})
}

func (s *server) writeSpaceError(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, backup.ErrInsufficientStorage) {
		writeError(w, http.StatusInsufficientStorage, "insufficient_storage",
			"There is not enough free space on the data volume for a snapshot of the database. Free some space and try again.")
		return
	}
	writeInternal(w, r)
}

func (b *backupState) isServerRunning() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.server
}

// handleAdminBackupDownload serves GET /api/admin/backup/{ticket}: the live
// ticket (issued to an administrator, who must still be one) is the
// credential; anything else is a 404. The tar.gz is streamed.
func (s *server) handleAdminBackupDownload(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	uid, extra, ok := s.tickets.consumeExtra(r.PathValue("ticket"), ticketServerBackup, s.now())
	notFound := func() {
		writeError(w, http.StatusNotFound, "not_found", "This download link is not valid any more.")
	}
	if !ok {
		notFound()
		return
	}
	who, err := auth.ActiveUser(r.Context(), s.db, uid)
	if err != nil || !who.Admin {
		notFound()
		return
	}
	inc, err := backup.ParseInclude(strings.Split(extra, ","))
	if err != nil {
		notFound()
		return
	}
	s.backups.mu.Lock()
	if s.backups.server {
		s.backups.mu.Unlock()
		writeError(w, http.StatusConflict, "backup_running", "A server backup is already running.")
		return
	}
	s.backups.server = true
	s.backups.mu.Unlock()
	defer func() {
		s.backups.mu.Lock()
		s.backups.server = false
		s.backups.mu.Unlock()
	}()
	if inc.DB {
		if err := backup.CheckSpace(s.dataDir, 0); err != nil {
			s.writeSpaceError(w, r, err)
			return
		}
	}
	now := s.now()
	tw := &trackWriter{ResponseWriter: w}
	w.Header().Set("Content-Type", "application/gzip")
	w.Header().Set("Content-Disposition", `attachment; filename="`+downloadName("qinqin-server", "", now, "tar.gz")+`"`)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	err = backup.WriteServer(r.Context(), s.db, s.dataDir, inc, tw, backup.Meta{
		AppVersion: backup.AppVersion, SchemaVersion: backup.SchemaVersion(r.Context(), s.db), Now: now})
	if err != nil {
		log.Printf("backup: server backup failed: %v", err)
		if !tw.wrote {
			w.Header().Del("Content-Disposition")
			writeInternal(w, r)
			return
		}
		panic(http.ErrAbortHandler)
	}
	if err := auth.Audit(r.Context(), s.db, auth.AuditEvent{Action: "server_backup_created", ActorID: uid,
		Detail: map[string]any{"count": len(inc.Names())}}); err != nil {
		log.Printf("backup: audit of the server backup: %v", err)
	}
}
