package api_test

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/backup"
)

func untarBody(t *testing.T, data []byte) map[string][]byte {
	t.Helper()
	zr, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("not gzip: %v", err)
	}
	tr := tar.NewReader(zr)
	out := map[string][]byte{}
	for {
		h, err := tr.Next()
		if err == io.EOF {
			return out
		}
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(tr)
		out[h.Name] = b
	}
}

func TestAdminServerBackup(t *testing.T) {
	t.Setenv("QINQIN_SECRET", "SUPER-SECRET-VALUE-0123456789")
	e := newBackupEnv(t)
	owner := registerUser(t, e.ts.URL, "owner", "")
	bob := registerUser(t, e.ts.URL, "bobby", owner)
	os.MkdirAll(filepath.Join(e.data, "books", "1"), 0o755)
	os.WriteFile(filepath.Join(e.data, "books", "1", "1.json"), []byte("[]"), 0o644)
	os.MkdirAll(filepath.Join(e.data, "journal", "1"), 0o755)
	os.WriteFile(filepath.Join(e.data, "journal", "1", "p"), []byte("PHOTO"), 0o644)

	// authorization: anonymous, a normal user; the password is required and counted
	if r := doJSON(t, "POST", e.ts.URL, "/api/admin/backup", "", map[string]any{}); r.StatusCode != 403 {
		t.Errorf("anonymous = %d", r.StatusCode)
	}
	if r := doJSON(t, "POST", e.ts.URL, "/api/admin/backup", bob, map[string]any{"currentPassword": "secret-pass-bobby"}); r.StatusCode != 403 {
		t.Errorf("a normal user = %d", r.StatusCode)
	}
	var eb errBody
	r := doJSON(t, "POST", e.ts.URL, "/api/admin/backup", owner, map[string]any{})
	decodeJSON(t, r, &eb)
	if r.StatusCode != 422 || eb.Error != "password_required" {
		t.Errorf("no password = %d %+v", r.StatusCode, eb)
	}
	r = doJSON(t, "POST", e.ts.URL, "/api/admin/backup", owner, map[string]any{"currentPassword": "wrong-password-x"})
	decodeJSON(t, r, &eb)
	if r.StatusCode != 403 || eb.Error != "wrong_password" {
		t.Errorf("wrong password = %d %+v", r.StatusCode, eb)
	}
	if r := doJSON(t, "POST", e.ts.URL, "/api/admin/backup", owner, map[string]any{"currentPassword": "secret-pass-owner", "include": []string{"secrets"}}); r.StatusCode != 400 {
		t.Errorf("unknown include = %d", r.StatusCode)
	}
	var tk struct {
		URL     string   `json:"url"`
		Include []string `json:"include"`
	}
	r = doJSON(t, "POST", e.ts.URL, "/api/admin/backup", owner, map[string]any{"currentPassword": "secret-pass-owner", "include": []string{"db", "books"}})
	if r.StatusCode != 200 {
		t.Fatalf("start = %d", r.StatusCode)
	}
	decodeJSON(t, r, &tk)
	if !strings.HasPrefix(tk.URL, "/api/admin/backup/") {
		t.Fatalf("url %q", tk.URL)
	}
	// 1/minute: a second request right away is limited
	if r := doJSON(t, "POST", e.ts.URL, "/api/admin/backup", owner, map[string]any{"currentPassword": "secret-pass-owner"}); r.StatusCode != 429 || r.Header.Get("Retry-After") == "" {
		t.Errorf("second request = %d", r.StatusCode)
	}
	status, hdr, body := getRaw(t, e.ts.URL, tk.URL, "")
	if status != 200 || hdr.Get("Content-Type") != "application/gzip" || !strings.Contains(hdr.Get("Content-Disposition"), "qinqin-server-") {
		t.Fatalf("download = %d %v", status, hdr)
	}
	files := untarBody(t, body)
	if files["qinqin.db"] == nil || files["books/1/1.json"] == nil || files["BACKUP-INFO.json"] == nil {
		t.Errorf("entries: %v", tarNames(files))
	}
	for n := range files {
		if strings.Contains(n, "journal") || strings.Contains(n, "tmp") || strings.Contains(n, "audio") || strings.Contains(n, "packs") {
			t.Errorf("unexpected %s", n)
		}
	}
	if bytes.Contains(body, []byte("SUPER-SECRET-VALUE")) || bytes.Contains(files["qinqin.db"], []byte("SUPER-SECRET-VALUE")) {
		t.Error("the secret is in the archive")
	}
	if status, _, _ := getRaw(t, e.ts.URL, tk.URL, ""); status != 404 {
		t.Errorf("ticket reused = %d", status)
	}
	var n int
	e.db.QueryRow(`SELECT COUNT(*) FROM auth_audit WHERE action = 'server_backup_created'`).Scan(&n)
	if n != 1 {
		t.Errorf("audit rows %d", n)
	}
	if m, _ := filepath.Glob(filepath.Join(e.data, "tmp", "backup-*")); len(m) != 0 {
		t.Errorf("snapshot left: %v", m)
	}
}

func tarNames(m map[string][]byte) []string {
	var out []string
	for k := range m {
		out = append(out, k)
	}
	return out
}

func TestAdminServerBackupRefusesWithoutSpace(t *testing.T) {
	restore := backup.SetFreeBytesForTest(func(string) (uint64, error) { return 1 << 20, nil })
	t.Cleanup(restore)
	e := newBackupEnv(t)
	owner := registerUser(t, e.ts.URL, "owner", "")
	var eb errBody
	r := doJSON(t, "POST", e.ts.URL, "/api/admin/backup", owner, map[string]any{"currentPassword": "secret-pass-owner"})
	decodeJSON(t, r, &eb)
	if r.StatusCode != 507 || eb.Error != "insufficient_storage" {
		t.Errorf("low space = %d %+v", r.StatusCode, eb)
	}
	// without the database part no snapshot is needed
	if r := doJSON(t, "POST", e.ts.URL, "/api/admin/backup", owner, map[string]any{"currentPassword": "secret-pass-owner", "include": []string{"books"}}); r.StatusCode != 200 {
		t.Errorf("books only = %d", r.StatusCode)
	}
}

func TestAdminBackupTicketOfADemotedAdminIsDead(t *testing.T) {
	e := newBackupEnv(t)
	owner := registerUser(t, e.ts.URL, "owner", "")
	second := registerUser(t, e.ts.URL, "second", owner)
	e.db.Exec(`UPDATE users SET admin = 1 WHERE username = 'second'`)
	var tk ticketReply
	decodeJSON(t, doJSON(t, "POST", e.ts.URL, "/api/admin/backup", second, map[string]any{"currentPassword": "secret-pass-second"}), &tk)
	e.db.Exec(`UPDATE users SET admin = 0 WHERE username = 'second'`)
	if status, _, _ := getRaw(t, e.ts.URL, tk.URL, ""); status != 404 {
		t.Errorf("ticket of a demoted admin = %d, want 404", status)
	}
}
