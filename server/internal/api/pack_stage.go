package api

import (
	"crypto/rand"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"qinqin/internal/dict"
	"qinqin/internal/packs"
)

// Staged pack uploads: an uploaded zip is extracted and validated into
// <data>/packs/.stage-<token>/ and waits there for the admin to confirm
// its licence; only then is it imported.
const (
	maxPackUpload = 128 << 20 // zip bytes accepted by POST /api/admin/packs
	stageTTL      = 30 * time.Minute
	maxStages     = 3
	staleStageAge = time.Hour // unknown .stage-* directories older than this are swept
)

// Stage states.
const (
	stageStaged    = "staged"
	stageImporting = "importing"
	stageDone      = "done"
	stageFailed    = "failed"
)

// stagedPack is one uploaded pack waiting for, running, or finished with
// its import. The stage store's mutex guards the mutable fields.
type stagedPack struct {
	token   string
	dir     string // <data>/packs/.stage-<token>
	root    string // directory holding manifest.json, dir or one folder inside it
	userID  int64
	pack    dict.Pack
	expires time.Time

	status  string
	result  *packs.Installed
	summary string
	errMsg  string
}

// stageStore is the in-memory registry of staged packs, keyed by token.
type stageStore struct {
	mu sync.Mutex
	m  map[string]*stagedPack
}

func newStageStore() *stageStore { return &stageStore{m: map[string]*stagedPack{}} }

// newToken returns a 128-bit random hex token.
func newToken() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}

// put registers st unless maxStages are already live at now.
func (ss *stageStore) put(st *stagedPack, now time.Time) bool {
	ss.mu.Lock()
	defer ss.mu.Unlock()
	if ss.liveLocked(now) >= maxStages {
		return false
	}
	ss.m[st.token] = st
	return true
}

func (ss *stageStore) liveLocked(now time.Time) int {
	n := 0
	for _, st := range ss.m {
		if st.status == stageImporting || st.expires.After(now) {
			n++
		}
	}
	return n
}

// live reports how many stages are live at now.
func (ss *stageStore) live(now time.Time) int {
	ss.mu.Lock()
	defer ss.mu.Unlock()
	return ss.liveLocked(now)
}

// with runs f on the live stage token belongs to userID, under the store's
// lock, and reports whether there was one. A stage of another admin, an
// unknown token and an expired stage are all "none".
func (ss *stageStore) with(token string, userID int64, now time.Time, f func(*stagedPack)) bool {
	ss.mu.Lock()
	defer ss.mu.Unlock()
	st, ok := ss.m[token]
	if !ok || st.userID != userID || (st.status != stageImporting && !st.expires.After(now)) {
		return false
	}
	f(st)
	return true
}

// discard removes a stage that is not importing; busy reports an import
// in flight, which cannot be discarded.
func (ss *stageStore) discard(token string, userID int64, now time.Time) (dir string, found, busy bool) {
	found = ss.with(token, userID, now, func(st *stagedPack) {
		if st.status == stageImporting {
			busy = true
			return
		}
		dir = st.dir
		delete(ss.m, token)
	})
	return dir, found, busy
}

// sweep drops expired stages that are not importing and returns their
// directories, which the caller removes.
func (ss *stageStore) sweep(now time.Time) []string {
	ss.mu.Lock()
	defer ss.mu.Unlock()
	var dirs []string
	for token, st := range ss.m {
		if st.status != stageImporting && !st.expires.After(now) {
			dirs = append(dirs, st.dir)
			delete(ss.m, token)
		}
	}
	return dirs
}

// known reports whether dir belongs to a tracked stage.
func (ss *stageStore) known(dir string) bool {
	ss.mu.Lock()
	defer ss.mu.Unlock()
	for _, st := range ss.m {
		if st.dir == dir {
			return true
		}
	}
	return false
}

// stages returns the server's stage store.
func (s *server) stages() *stageStore {
	s.stageOnce.Do(func() { s.stageStore = newStageStore() })
	return s.stageStore
}

// now is the server's clock.
func (s *server) now() time.Time {
	if s.clock != nil {
		return s.clock()
	}
	return time.Now()
}

// sweepStages drops expired stages and removes .stage-* directories of
// older than an hour that no tracked stage owns (left by a restart).
func (s *server) sweepStages(packsDir string) {
	ss := s.stages()
	for _, dir := range ss.sweep(s.now()) {
		os.RemoveAll(dir)
	}
	entries, err := os.ReadDir(packsDir)
	if err != nil {
		return
	}
	for _, en := range entries {
		if !en.IsDir() || !strings.HasPrefix(en.Name(), ".stage-") {
			continue
		}
		dir := filepath.Join(packsDir, en.Name())
		info, err := en.Info()
		if err != nil || ss.known(dir) || s.now().Sub(info.ModTime()) < staleStageAge {
			continue
		}
		os.RemoveAll(dir)
	}
}
