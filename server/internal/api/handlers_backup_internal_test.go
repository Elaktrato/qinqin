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
