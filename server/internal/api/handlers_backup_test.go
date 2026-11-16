package api_test

import (
	"archive/zip"
	"bytes"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"net/http/httptest"
	"qinqin/internal/api"
	"qinqin/internal/db"
	"qinqin/internal/lang"
	"qinqin/internal/library"
)

type ticketReply struct {
	URL              string `json:"url"`
	ExpiresInSeconds int    `json:"expiresInSeconds"`
}

func getRaw(t *testing.T, tsURL, path, token string) (int, http.Header, []byte) {
	t.Helper()
	req, _ := http.NewRequest("GET", tsURL+path, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, resp.Header, b
}

func zipEntries(t *testing.T, data []byte) map[string][]byte {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("not a zip: %v", err)
	}
	out := map[string][]byte{}
	for _, f := range zr.File {
		rc, _ := f.Open()
		b, _ := io.ReadAll(rc)
		rc.Close()
		out[f.Name] = b
	}
	return out
}

func TestExportRequiresASessionAndServesOwnDataOnce(t *testing.T) {
	lang.Register(lang.Zh{})
	var logs bytes.Buffer
	log.SetOutput(&logs)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })
	ts, sqlDB, dataDir := newServerWithDir(t)
	alice := registerUser(t, ts.URL, "alice", "")
	bob := registerUser(t, ts.URL, "bobby", alice)
	aliceID, bobID := userID(t, sqlDB, "alice"), userID(t, sqlDB, "bobby")
	seedBuiltin(t, sqlDB, deleteTestPlugin)
	store := library.Store{DB: sqlDB, Dir: filepath.Join(dataDir, "books")}
	wsA := createWorkspace(t, ts.URL, alice, "zh", "")
	wsB := createWorkspace(t, ts.URL, bob, "zh", "")
	populateWorkspace(t, ts.URL, alice, store, aliceID, wsA, 1)
	populateWorkspace(t, ts.URL, bob, store, bobID, wsB, 2)

	if r := doJSON(t, "POST", ts.URL, "/api/account/export", "", nil); r.StatusCode != 401 {
		t.Errorf("anonymous export = %d, want 401", r.StatusCode)
	}
	var tk ticketReply
	r := doJSON(t, "POST", ts.URL, "/api/account/export", alice, nil)
	if r.StatusCode != 200 {
		t.Fatalf("export = %d", r.StatusCode)
	}
	decodeJSON(t, r, &tk)
	if !strings.HasPrefix(tk.URL, "/api/account/export/") || tk.ExpiresInSeconds != 60 {
		t.Fatalf("reply %+v", tk)
	}
	// the ticket URL works WITHOUT a bearer token, once
	status, hdr, body := getRaw(t, ts.URL, tk.URL, "")
	if status != 200 {
		t.Fatalf("download = %d %s", status, body)
	}
	if hdr.Get("Content-Type") != "application/zip" || hdr.Get("Cache-Control") != "no-store" ||
		!strings.HasPrefix(hdr.Get("Content-Disposition"), `attachment; filename="qinqin-alice-`) ||
		!strings.HasSuffix(hdr.Get("Content-Disposition"), `.zip"`) {
		t.Errorf("headers %v", hdr)
	}
	files := zipEntries(t, body)
	if files["manifest.json"] == nil || !strings.Contains(string(files["workspaces.json"]), `"id": `+itoa(wsA)) && !strings.Contains(string(files["workspaces.json"]), `"id":`+itoa(wsA)) {
		t.Errorf("archive lacks alice's workspace %d: %s", wsA, files["workspaces.json"])
	}
	for name, b := range files {
		if strings.Contains(string(b), "bobby") {
			t.Errorf("%s names the other user", name)
		}
	}
	if status, _, _ := getRaw(t, ts.URL, tk.URL, ""); status != 404 {
		t.Errorf("second use = %d, want 404", status)
	}
	// somebody else's token cannot use alice's new ticket either (it needs none, but a ticket of
	// another kind or garbage is 404)
	if status, _, _ := getRaw(t, ts.URL, "/api/account/export/not-a-ticket", bob); status != 404 {
		t.Errorf("garbage ticket = %d", status)
	}
	// the ticket token never reaches the log
	token := tk.URL[strings.LastIndex(tk.URL, "/")+1:]
	if strings.Contains(logs.String(), token) {
		t.Error("the ticket token was logged")
	}
	// audit: allowlisted keys only
	var action, detail string
	if err := sqlDB.QueryRow(`SELECT action, detail FROM auth_audit WHERE action = 'data_exported'`).Scan(&action, &detail); err != nil {
		t.Fatalf("audit row: %v", err)
	}
	if strings.Contains(detail, token) || strings.Contains(detail, "password") {
		t.Errorf("audit detail %s", detail)
	}
}

func TestExportTicketExpires(t *testing.T) {
	now := time.Date(2026, 11, 15, 12, 0, 0, 0, time.UTC)
	var mu sync.Mutex
	clock := func() time.Time { mu.Lock(); defer mu.Unlock(); return now }
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	ts := httptest.NewServer(api.New(sqlDB, t.TempDir(), nil, api.WithClock(clock)))
	t.Cleanup(ts.Close)
	alice := registerUser(t, ts.URL, "alice", "")
	var tk ticketReply
	decodeJSON(t, doJSON(t, "POST", ts.URL, "/api/account/export", alice, nil), &tk)
	mu.Lock()
	now = now.Add(61 * time.Second)
	mu.Unlock()
	if status, _, _ := getRaw(t, ts.URL, tk.URL, ""); status != 404 {
		t.Errorf("expired ticket = %d, want 404", status)
	}
}

func TestExportIsRateLimitedPerUser(t *testing.T) {
	ts, _ := newLooseServer(t)
	alice := registerUser(t, ts.URL, "alice", "")
	bob := registerUser(t, ts.URL, "bobby", alice)
	for i := 0; i < 6; i++ {
		if r := doJSON(t, "POST", ts.URL, "/api/account/export", alice, nil); r.StatusCode != 200 {
			t.Fatalf("export %d = %d", i, r.StatusCode)
		}
	}
	r := doJSON(t, "POST", ts.URL, "/api/account/export", alice, nil)
	if r.StatusCode != 429 || r.Header.Get("Retry-After") == "" {
		t.Errorf("seventh = %d retry-after %q", r.StatusCode, r.Header.Get("Retry-After"))
	}
	if r := doJSON(t, "POST", ts.URL, "/api/account/export", bob, nil); r.StatusCode != 200 {
		t.Errorf("another user shares the bucket: %d", r.StatusCode)
	}
}
