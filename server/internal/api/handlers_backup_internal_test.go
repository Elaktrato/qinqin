package api

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestExportRefusesAConcurrentExportAndARestore(t *testing.T) {
	s, h, a, sqlDB := newGateServer(t)
	var uid int64
	sqlDB.QueryRow(`SELECT id FROM users WHERE username = 'gate-user'`).Scan(&uid)
	post := func() (int, string) {
		r := httptest.NewRequest(http.MethodPost, "/api/account/export", strings.NewReader(""))
		r.Header.Set("Authorization", "Bearer "+a.user)
		r.RemoteAddr = "192.0.2.10:1"
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code, w.Body.String()
	}
	if ok, _ := s.backups.beginExport(uid); !ok {
		t.Fatal("could not begin")
	}
	if code, body := post(); code != 409 || !strings.Contains(body, "export_running") {
		t.Errorf("second export = %d %s", code, body)
	}
	s.backups.endExport(uid)
	s.backups.mu.Lock()
	s.backups.restoring[uid] = true
	s.backups.mu.Unlock()
	if code, body := post(); code != 409 || !strings.Contains(body, "restore_running") {
		t.Errorf("export during restore = %d %s", code, body)
	}
}

func TestServerBackupAllowsOneAtATime(t *testing.T) {
	s, h, a, sqlDB := newGateServer(t)
	var adminID int64
	sqlDB.QueryRow(`SELECT id FROM users WHERE username = 'gate-admin'`).Scan(&adminID)
	s.backups.mu.Lock()
	s.backups.server = true
	s.backups.mu.Unlock()
	do := func(method, path, token, body string) (int, string) {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		r.RemoteAddr = "192.0.2.10:1"
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code, w.Body.String()
	}
	if code, body := do("POST", "/api/admin/backup", a.admin, `{"currentPassword":"x"}`); code != 409 || !strings.Contains(body, "backup_running") {
		t.Errorf("start while running = %d %s", code, body)
	}
	tok := s.tickets.issueExtra(adminID, ticketServerBackup, ticketTTL, s.now(), "books")
	if code, body := do("GET", "/api/admin/backup/"+tok, "", ""); code != 409 || !strings.Contains(body, "backup_running") {
		t.Errorf("download while running = %d %s", code, body)
	}
}

func TestOnlyOneRestoreIsAppliedAtATime(t *testing.T) {
	s, h, a, sqlDB := newGateServer(t)
	var uid int64
	sqlDB.QueryRow(`SELECT id FROM users WHERE username = 'gate-user'`).Scan(&uid)
	token, hash := newRestoreToken()
	s.restores.mu.Lock()
	st := &restoreStage{hash: hash, userID: uid, expires: s.now().Add(restoreStageTTL), status: rsReady}
	s.restores.byHash[hash], s.restores.byUser[uid] = st, st
	s.restores.mu.Unlock()
	if !s.backups.tryApply() { // somebody else's restore is running
		t.Fatal("could not take the slot")
	}
	r := httptest.NewRequest(http.MethodPost, "/api/account/restore/"+token, strings.NewReader(`{"confirm":"gate-user","password":"x"}`))
	r.Header.Set("Authorization", "Bearer "+a.user)
	r.Header.Set("Content-Type", "application/json")
	r.RemoteAddr = "192.0.2.10:1"
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 409 || !strings.Contains(w.Body.String(), "restore_busy") || w.Header().Get("Retry-After") != "30" {
		t.Errorf("second apply = %d %s retry-after %q", w.Code, w.Body.String(), w.Header().Get("Retry-After"))
	}
	s.restores.mu.Lock()
	status := st.status
	s.restores.mu.Unlock()
	if status != rsReady {
		t.Errorf("a refused apply changed the stage to %s", status)
	}
}

func TestCleanBackupTempLeavesAFreshSnapshotAlone(t *testing.T) {
	dir := t.TempDir()
	tmp := filepath.Join(dir, "tmp")
	os.MkdirAll(filepath.Join(tmp, "restore"), 0o755)
	os.WriteFile(filepath.Join(tmp, "restore", "x.zip"), []byte("z"), 0o600)
	fresh := filepath.Join(tmp, "backup-fresh.db")
	stale := filepath.Join(tmp, "backup-stale.db")
	os.WriteFile(fresh, []byte("z"), 0o600)
	os.WriteFile(stale, []byte("z"), 0o600)
	old := time.Now().Add(-2 * time.Hour)
	os.Chtimes(stale, old, old)
	CleanBackupTemp(dir)
	if _, err := os.Stat(fresh); err != nil {
		t.Error("a snapshot younger than an hour (a CLI backup in progress) was deleted")
	}
	if _, err := os.Stat(stale); !os.IsNotExist(err) {
		t.Error("a stale snapshot was kept")
	}
	if _, err := os.Stat(filepath.Join(tmp, "restore")); !os.IsNotExist(err) {
		t.Error("staged restores survived a restart")
	}
}
