package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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
