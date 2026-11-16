package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"qinqin/internal/backup"
)

// Staged restores: an uploaded personal backup is written to
// <data>/tmp/restore/<token>.zip and validated in the background; the
// user confirms with their password, and only then does the restore run.
// One stage per user, 30 minutes, tokens stored as SHA-256 and bound to the
// user (another user's token is a 404 on every verb).
const (
	restoreStageTTL  = 30 * time.Minute
	maxRestoreStages = 16
	safetyExportTTL  = 7 * 24 * time.Hour
)

// Stage states.
const (
	rsValidating = "validating"
	rsReady      = "ready"
	rsInvalid    = "invalid"
	rsRunning    = "running"
	rsDone       = "done"
	rsFailed     = "failed"
)

type stageError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Detail  string `json:"detail,omitempty"`
}

type restoreStage struct {
	hash    string
	userID  int64
	path    string
	expires time.Time

	status string
	report *backup.Report
	err    *stageError
	result *backup.Result
}

type restoreStore struct {
	mu     sync.Mutex
	byHash map[string]*restoreStage
	byUser map[int64]*restoreStage
}

func newRestoreStore() *restoreStore {
	return &restoreStore{byHash: map[string]*restoreStage{}, byUser: map[int64]*restoreStage{}}
}

func newRestoreToken() (token, hash string) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic("api: no randomness: " + err.Error())
	}
	token = hex.EncodeToString(b[:])
	return token, hashTicket(token)
}

// get returns the live stage of this user for the token, dropping an expired
// one (and its file) on the way. A token of another user is the same as an
// unknown one.
func (rs *restoreStore) get(token string, userID int64, now time.Time) *restoreStage {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	st := rs.byHash[hashTicket(token)]
	if st == nil || st.userID != userID {
		return nil
	}
	if st.status != rsRunning && !now.Before(st.expires) {
		rs.dropLocked(st)
		return nil
	}
	return st
}

func (rs *restoreStore) dropLocked(st *restoreStage) {
	delete(rs.byHash, st.hash)
	if rs.byUser[st.userID] == st {
		delete(rs.byUser, st.userID)
	}
	if st.path != "" {
		os.Remove(st.path)
	}
}

// discardUser removes the user's stage (account deletion), unless it runs.
func (rs *restoreStore) discardUser(userID int64) {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	if st := rs.byUser[userID]; st != nil {
		rs.dropLocked(st)
	}
}

// sweep drops expired stages that are not running.
func (rs *restoreStore) sweep(now time.Time) int {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	n := 0
	for _, st := range rs.byHash {
		if st.status != rsRunning && !now.Before(st.expires) {
			rs.dropLocked(st)
			n++
		}
	}
	return n
}

func (s *server) restoreDir() string { return filepath.Join(s.dataDir, "tmp", "restore") }

// CleanBackupTemp removes leftovers of an interrupted run: staged restores,
// server-backup snapshots and book staging directories. It runs at start-up.
func CleanBackupTemp(dataDir string) {
	os.RemoveAll(filepath.Join(dataDir, "tmp", "restore"))
	if matches, err := filepath.Glob(filepath.Join(dataDir, "tmp", "backup-*")); err == nil {
		for _, m := range matches {
			os.Remove(m)
		}
	}
	if dirs, err := filepath.Glob(filepath.Join(dataDir, "books", "*", ".restore-*")); err == nil {
		for _, d := range dirs {
			os.RemoveAll(d)
		}
	}
}

// sweepRestore is the janitor step: expired stages and old safety exports.
func (s *server) sweepRestore() {
	s.restores.sweep(s.now())
	backup.SweepSafetyExports(s.dataDir, safetyExportTTL, s.now())
	// stage files nobody tracks (a stage dropped while its file was open)
	entries, err := os.ReadDir(s.restoreDir())
	if err != nil {
		return
	}
	s.restores.mu.Lock()
	defer s.restores.mu.Unlock()
	known := map[string]bool{}
	for _, st := range s.restores.byHash {
		known[filepath.Base(st.path)] = true
	}
	for _, e := range entries {
		info, err := e.Info()
		if err != nil || known[e.Name()] || !strings.HasSuffix(e.Name(), ".zip") || s.now().Sub(info.ModTime()) < restoreStageTTL {
			continue
		}
		os.Remove(filepath.Join(s.restoreDir(), e.Name()))
	}
}

// stageErrorFor words a failed validation for the client (never with file contents).
func stageErrorFor(err error) *stageError {
	var ie *backup.InvalidError
	if errors.As(err, &ie) {
		msg := "This file is not a valid qinqin backup."
		switch ie.Code {
		case backup.CodeTooLarge:
			msg = "This backup is larger than the limits allow."
		case backup.CodeVersion:
			msg = "This backup has a format this server cannot read."
		}
		return &stageError{Code: ie.Code, Message: msg, Detail: ie.Detail}
	}
	return &stageError{Code: "internal", Message: "The backup could not be checked."}
}

// validateStage runs in the background: open (validate) and plan.
func (s *server) validateStage(st *restoreStage) {
	finish := func(status string, rep *backup.Report, serr *stageError) {
		s.restores.mu.Lock()
		st.status, st.report, st.err = status, rep, serr
		s.restores.mu.Unlock()
		if s.stageDone != nil {
			select {
			case s.stageDone <- st.userID:
			default:
			}
		}
	}
	defer func() {
		if r := recover(); r != nil {
			log.Printf("restore stage: validation panicked: %v", r)
			finish(rsInvalid, nil, &stageError{Code: "internal", Message: "The backup could not be checked."})
		}
	}()
	a, err := backup.Open(st.path)
	if err != nil {
		finish(rsInvalid, nil, stageErrorFor(err))
		return
	}
	defer a.Close()
	rep, _, err := backup.Plan(s.bg, s.db, a, st.userID)
	if err != nil {
		if !errors.Is(err, context.Canceled) {
			log.Printf("restore stage: plan failed: %v", err)
		}
		finish(rsInvalid, nil, &stageError{Code: "internal", Message: "The backup could not be checked."})
		return
	}
	if len(rep.Blocking) > 0 {
		finish(rsInvalid, &rep, &stageError{Code: backup.CodeInvalid, Message: "This backup cannot be restored on this server.", Detail: strings.Join(rep.Blocking, " ")})
		return
	}
	finish(rsReady, &rep, nil)
}
