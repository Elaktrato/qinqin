package api

import (
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"qinqin/internal/auth"
	"qinqin/internal/backup"
)

type stageView struct {
	Status string         `json:"status"`
	Report *backup.Report `json:"report"`
	Error  *stageError    `json:"error"`
	Result *backup.Result `json:"result"`
}

// handleRestoreUpload serves POST /api/account/restore: the body is the zip
// (application/zip, at most 128 MiB). It is stored under <data>/tmp/restore
// and checked in the background; the answer is a token to poll.
func (s *server) handleRestoreUpload(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	if ct := strings.ToLower(strings.TrimSpace(strings.SplitN(r.Header.Get("Content-Type"), ";", 2)[0])); ct != "application/zip" && ct != "application/octet-stream" && ct != "application/x-zip-compressed" {
		writeError(w, http.StatusUnsupportedMediaType, "unsupported_media_type", "Send the backup file as application/zip.")
		return
	}
	if ok, retry := s.authLimiter("restore").Allow(int64Key(u.ID)); !ok {
		writeRateLimitedAs(w, retry, "restore uploads")
		return
	}
	if err := os.MkdirAll(s.restoreDir(), 0o700); err != nil {
		writeInternal(w, r)
		return
	}
	token, hash := newRestoreToken()
	path := filepath.Join(s.restoreDir(), token+".zip")
	// One stage per user, taken atomically: the new upload replaces the old
	// stage under the mutex, THEN the global cap is checked (the slot the user
	// already held is theirs), so two uploads of one user never both survive.
	st := &restoreStage{hash: hash, userID: u.ID, path: path, expires: s.now().Add(restoreStageTTL), status: rsValidating}
	s.restores.mu.Lock()
	old := s.restores.byUser[u.ID]
	if old != nil && old.status == rsRunning {
		s.restores.mu.Unlock()
		writeError(w, http.StatusConflict, "restore_running", "A restore of your data is already running.")
		return
	}
	if old != nil {
		s.restores.dropLocked(old)
	}
	if len(s.restores.byHash) >= maxRestoreStages {
		s.restores.mu.Unlock()
		writeBusy(w)
		return
	}
	s.restores.byHash[hash] = st
	s.restores.byUser[u.ID] = st
	s.restores.mu.Unlock()
	abandon := func() {
		s.restores.mu.Lock()
		if s.restores.byHash[hash] == st {
			s.restores.dropLocked(st)
		}
		s.restores.mu.Unlock()
		os.Remove(path)
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		abandon()
		writeInternal(w, r)
		return
	}
	limit := s.restoreCap
	if limit == 0 {
		limit = backup.MaxUpload
	}
	_, cerr := io.Copy(f, http.MaxBytesReader(w, r.Body, limit))
	if err := f.Close(); cerr == nil {
		cerr = err
	}
	if cerr != nil {
		abandon()
		var tooBig *http.MaxBytesError
		if errors.As(cerr, &tooBig) {
			writeError(w, http.StatusRequestEntityTooLarge, backup.CodeTooLarge, "This file is larger than 128 MiB, the most a backup upload may be.")
		} else if r.Context().Err() != nil {
			writeClientGone(w)
		} else {
			writeError(w, http.StatusBadRequest, "bad_request", "The upload did not arrive completely.")
		}
		return
	}
	s.restores.mu.Lock()
	still := s.restores.byHash[hash] == st
	s.restores.mu.Unlock()
	if !still { // a newer upload of this user took the slot meanwhile
		os.Remove(path)
		writeError(w, http.StatusConflict, "stage_not_ready", "A newer upload replaced this one.")
		return
	}
	s.goBackground(func() { s.validateStage(st) })
	writeJSON(w, http.StatusAccepted, map[string]string{"token": token})
}

func (s *server) ownStage(w http.ResponseWriter, r *http.Request, userID int64) *restoreStage {
	st := s.restores.get(r.PathValue("token"), userID, s.now())
	if st == nil {
		writeError(w, http.StatusNotFound, "not_found", "No such restore.")
	}
	return st
}

// handleRestoreStatus serves GET /api/account/restore/{token}.
func (s *server) handleRestoreStatus(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	st := s.ownStage(w, r, u.ID)
	if st == nil {
		return
	}
	s.restores.mu.Lock()
	v := stageView{Status: st.status, Report: st.report, Error: st.err, Result: st.result}
	s.restores.mu.Unlock()
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, v)
}

// handleRestoreDiscard serves DELETE /api/account/restore/{token}.
func (s *server) handleRestoreDiscard(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	st := s.ownStage(w, r, u.ID)
	if st == nil {
		return
	}
	s.restores.mu.Lock()
	if st.status == rsRunning {
		s.restores.mu.Unlock()
		writeError(w, http.StatusConflict, "restore_running", "The restore is running and cannot be cancelled.")
		return
	}
	s.restores.dropLocked(st)
	s.restores.mu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}

// handleRestoreApply serves POST /api/account/restore/{token}
// {confirm, password, code?, unresolved?}: the restore replaces all of the
// user's data, so it needs the username typed, the password again and, for a
// user with an authenticator, a current code (like PUT /api/account/email).
func (s *server) handleRestoreApply(w http.ResponseWriter, r *http.Request) {
	p := s.requirePrincipal(w, r)
	if p == nil {
		return
	}
	u := &p.User
	var req struct {
		Confirm    string `json:"confirm"`
		Password   string `json:"password"`
		Code       string `json:"code"`
		Unresolved string `json:"unresolved"`
	}
	if !readAccountBodyStrict(w, r, &req) {
		return
	}
	st := s.ownStage(w, r, u.ID)
	if st == nil {
		return
	}
	s.restores.mu.Lock()
	status, rep := st.status, st.report
	s.restores.mu.Unlock()
	switch status {
	case rsRunning:
		writeError(w, http.StatusConflict, "restore_running", "A restore of your data is already running.")
		return
	case rsReady:
	default:
		writeError(w, http.StatusConflict, "stage_not_ready", "This upload is not ready to be restored.")
		return
	}
	if req.Confirm != u.Username {
		writeError(w, http.StatusUnprocessableEntity, "confirm_mismatch", "Type your username exactly to confirm.")
		return
	}
	if req.Unresolved != "" && req.Unresolved != "drop" {
		writeError(w, http.StatusBadRequest, "bad_request", `unresolved must be "drop" or absent.`)
		return
	}
	if rep != nil && (rep.Unresolved.EntryCount > 0 || rep.Unresolved.Sentences > 0) && req.Unresolved != "drop" {
		writeError(w, http.StatusConflict, "unresolved_entries", "The backup refers to words this server does not have. Confirm that they are dropped to continue.")
		return
	}
	if s.backups.applyBusy() {
		writeRestoreBusy(w)
		return
	}
	if !s.verifyOwnPassword(w, r, u.ID, req.Password) {
		return
	}
	if has, herr := auth.HasTOTP(r.Context(), s.db, u.ID); herr != nil {
		writeInternal(w, r)
		return
	} else if has && !s.secondFactorOK(w, r, u.ID, req.Code) {
		return
	}
	// One restore per user, never beside an export of that user, and only one
	// apply server-wide: a restore holds the database write lock.
	if !s.backups.tryApply() {
		writeRestoreBusy(w)
		return
	}
	s.backups.mu.Lock()
	if s.backups.restoring[u.ID] {
		s.backups.mu.Unlock()
		s.backups.endApply()
		writeError(w, http.StatusConflict, "restore_running", "A restore of your data is already running.")
		return
	}
	if s.backups.exporting[u.ID] {
		s.backups.mu.Unlock()
		s.backups.endApply()
		writeError(w, http.StatusConflict, "export_running", "An export of your data is running. Wait until it has finished.")
		return
	}
	s.backups.restoring[u.ID] = true
	s.backups.mu.Unlock()
	s.restores.mu.Lock()
	if st.status != rsReady { // lost a race with a second apply or a discard
		s.restores.mu.Unlock()
		s.backups.mu.Lock()
		delete(s.backups.restoring, u.ID)
		s.backups.mu.Unlock()
		s.backups.endApply()
		writeError(w, http.StatusConflict, "restore_running", "A restore of your data is already running.")
		return
	}
	st.status = rsRunning
	s.restores.mu.Unlock()
	s.goBackground(func() { s.runRestore(st, p.SessionID, req.Unresolved == "drop") })
	writeJSON(w, http.StatusAccepted, map[string]string{"status": rsRunning})
}

func (s *server) runRestore(st *restoreStage, keepSession int64, drop bool) {
	var res backup.Result
	var serr *stageError
	defer func() {
		if r := recover(); r != nil {
			log.Printf("restore of user %d panicked: %v", st.userID, r)
			serr = &stageError{Code: "internal", Message: "The restore failed. Nothing was changed."}
		}
		s.restores.mu.Lock()
		if serr != nil {
			st.status, st.err = rsFailed, serr
		} else {
			st.status, st.result = rsDone, &res
		}
		st.expires = s.now().Add(restoreStageTTL)
		path := st.path
		st.path = ""
		s.restores.mu.Unlock()
		os.Remove(path)
		s.backups.mu.Lock()
		delete(s.backups.restoring, st.userID)
		s.backups.mu.Unlock()
		s.backups.endApply()
		if s.stageDone != nil {
			select {
			case s.stageDone <- st.userID:
			default:
			}
		}
	}()
	a, err := backup.Open(st.path)
	if err != nil {
		serr = stageErrorFor(err)
		return
	}
	defer a.Close()
	res, _, err = backup.Restore(s.bg, backup.RestoreDeps{DB: s.db, DataDir: s.dataDir, Users: s.users, Now: s.clock}, st.userID, keepSession, a,
		backup.Options{DropUnresolved: drop})
	switch {
	case err == nil:
	case errors.Is(err, backup.ErrUnresolved):
		serr = &stageError{Code: "unresolved_entries", Message: "The backup refers to words this server does not have. Nothing was changed."}
	case errors.Is(err, backup.ErrBlocked):
		serr = &stageError{Code: backup.CodeInvalid, Message: "This backup cannot be restored on this server. Nothing was changed."}
	case errors.Is(err, backup.ErrUserGone):
		serr = &stageError{Code: "not_found", Message: "The account no longer exists."}
	default:
		log.Printf("restore of user %d failed: %v", st.userID, err)
		serr = &stageError{Code: "internal", Message: "The restore failed. Nothing was changed."}
	}
}

// handleSafetyExportTicket serves POST /api/account/restore/safety-export:
// a fresh 60 s ticket for the newest pre-restore export of the caller.
func (s *server) handleSafetyExportTicket(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	if _, ok := backup.LatestSafetyExport(s.dataDir, u.ID); !ok {
		writeError(w, http.StatusNotFound, "not_found", "There is no earlier backup of your data on this server.")
		return
	}
	token := s.tickets.issue(u.ID, ticketSafety, ticketTTL, s.now())
	writeJSON(w, http.StatusOK, map[string]any{"url": "/api/account/restore/safety-export/" + token, "expiresInSeconds": int(ticketTTL.Seconds())})
}

// handleSafetyExportDownload serves GET /api/account/restore/safety-export/{ticket}.
func (s *server) handleSafetyExportDownload(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	uid, ok := s.tickets.consume(r.PathValue("ticket"), ticketSafety, s.now())
	if !ok {
		writeError(w, http.StatusNotFound, "not_found", "This download link is not valid any more.")
		return
	}
	path, ok := backup.LatestSafetyExport(s.dataDir, uid)
	if !ok {
		writeError(w, http.StatusNotFound, "not_found", "There is no earlier backup of your data on this server.")
		return
	}
	f, err := os.Open(path)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "There is no earlier backup of your data on this server.")
		return
	}
	defer f.Close()
	var username string
	s.db.QueryRowContext(r.Context(), `SELECT username FROM users WHERE id = ?`, uid).Scan(&username)
	info, _ := f.Stat()
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="`+downloadName("qinqin-before-restore", username, info.ModTime(), "zip")+`"`)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	serveContent(w, r, info.ModTime(), f)
}

func writeRestoreBusy(w http.ResponseWriter) {
	w.Header().Set("Retry-After", "30")
	writeError(w, http.StatusConflict, "restore_busy", "Another restore is running on this server. Try again in a minute.")
}
