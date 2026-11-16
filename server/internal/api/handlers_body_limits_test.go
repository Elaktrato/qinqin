package api_test

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// padded returns a JSON object of about n bytes: the given fields plus a
// "pad" string, so the body is well-formed and only its size is wrong.
func padded(fields string, n int) string {
	if fields != "" {
		fields += ","
	}
	return `{` + fields + `"pad":"` + strings.Repeat("x", n) + `"}`
}

// wantTooLarge asserts a 413 with the JSON error body every limited
// handler answers.
func wantTooLarge(t *testing.T, what string, resp *http.Response) {
	t.Helper()
	if resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Errorf("%s: status = %d, want 413", what, resp.StatusCode)
		return
	}
	var body struct {
		Error string `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil || body.Error == "" {
		t.Errorf("%s: 413 body is not a JSON error (%v, %+v)", what, err, body)
	}
}

func TestAuthBodyLimit(t *testing.T) {
	ts, _ := newServer(t)
	admin := registerUser(t, ts.URL, "admin", "")
	big := padded(`"username":"admin","password":"secret-pass-admin"`, 4<<10)
	wantTooLarge(t, "login", doRaw(t, http.MethodPost, ts.URL, "/api/auth/login", "", big))
	wantTooLarge(t, "register", doRaw(t, http.MethodPost, ts.URL, "/api/auth/register", admin, padded(`"username":"bob","password":"secret-pass"`, 4<<10)))
	// An ordinary body still works.
	login(t, ts.URL, "admin")
}

// countingReader counts how much of an endless body the client sent.
type countingReader struct{ n atomic.Int64 }

func (c *countingReader) Read(p []byte) (int, error) {
	if c.n.Load() >= 30<<20 {
		return 0, io.EOF
	}
	for i := range p {
		p[i] = 'x'
	}
	c.n.Add(int64(len(p)))
	return len(p), nil
}

// A 30 MB anonymous login is refused without the server reading it.
func TestHugeLoginRejectedQuickly(t *testing.T) {
	ts, _ := newServer(t)
	body := &countingReader{}
	req, err := http.NewRequest(http.MethodPost, ts.URL+"/api/auth/login",
		io.MultiReader(strings.NewReader(`{"username":"a","password":"`), body))
	if err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	resp, err := http.DefaultClient.Do(req)
	elapsed := time.Since(start)
	if err != nil {
		// The server may close the connection before the client finishes
		// writing; what matters is that it did not read 30 MB.
		t.Logf("client error after the server stopped reading: %v", err)
	} else {
		defer resp.Body.Close()
		wantTooLarge(t, "30 MB login", resp)
	}
	if sent := body.n.Load(); sent >= 30<<20 {
		t.Errorf("client wrote the whole 30 MB body (%d bytes): the server read it all", sent)
	}
	if elapsed > 5*time.Second {
		t.Errorf("30 MB login took %v", elapsed)
	}
}

func TestWorkspaceBodyLimits(t *testing.T) {
	ts, _ := newServer(t)
	token := registerUser(t, ts.URL, "owner", "")
	wantTooLarge(t, "POST workspace", doRaw(t, http.MethodPost, ts.URL, "/api/workspaces", token, padded(`"language":"zh"`, 16<<10)))

	id := createWorkspace(t, ts.URL, token, "zh", "")
	path := "/api/workspaces/" + strconv.FormatInt(id, 10)
	wantTooLarge(t, "PUT workspace", doRaw(t, http.MethodPut, ts.URL, path, token,
		`{"settings":{"a":"`+strings.Repeat("x", 16<<10)+`"}}`))

	// Each patch fits, but the stored settings object may not outgrow 64 KiB.
	value := strings.Repeat("y", 15<<10)
	accepted := 0
	for i := 0; i < 6; i++ {
		resp := doRaw(t, http.MethodPut, ts.URL, path, token, fmt.Sprintf(`{"settings":{"k%d":%q}}`, i, value))
		if resp.StatusCode == http.StatusOK {
			accepted++
			continue
		}
		wantTooLarge(t, fmt.Sprintf("settings patch %d", i), resp)
		break
	}
	if accepted != 4 {
		t.Errorf("accepted %d settings patches of 15 KiB, want 4 (64 KiB total)", accepted)
	}
	var list []workspaceBody
	decodeJSON(t, doJSON(t, http.MethodGet, ts.URL, "/api/workspaces", token, nil), &list)
	for _, ws := range list {
		if ws.ID == id && len(ws.Settings) > 64<<10 {
			t.Errorf("stored settings are %d bytes, want <= 64 KiB", len(ws.Settings))
		}
	}
	// A rename still works on a full settings object, and a foreign id is 404, not 413.
	if resp := doJSON(t, http.MethodPut, ts.URL, path, token, map[string]string{"name": "full"}); resp.StatusCode != http.StatusOK {
		t.Errorf("rename with full settings: status = %d, want 200", resp.StatusCode)
	}
	if resp := doRaw(t, http.MethodPut, ts.URL, "/api/workspaces/999999", token, fmt.Sprintf(`{"settings":{"z":%q}}`, value)); resp.StatusCode != http.StatusNotFound {
		t.Errorf("unknown workspace: status = %d, want 404", resp.StatusCode)
	}
}

func TestPluginBodyLimits(t *testing.T) {
	ts, sqlDB := newServer(t)
	admin := registerUser(t, ts.URL, "admin", "")
	seedBuiltin(t, sqlDB, deleteTestPlugin)
	wantTooLarge(t, "register plugin", doRaw(t, http.MethodPost, ts.URL, "/api/admin/plugins", admin,
		padded(`"id":"big","name":"Big","version":"1","type":"feature"`, 64<<10)))
	wantTooLarge(t, "plugin state", doRaw(t, http.MethodPut, ts.URL, "/api/plugins/qinqin-flashcards/state", admin,
		padded(`"enabled":true,"order":1`, 64<<10)))

	ws := strconv.FormatInt(createWorkspace(t, ts.URL, admin, "zh", "w"), 10)
	data := "/api/plugins/qinqin-flashcards/data/card:x?workspace=" + ws
	if resp := doRaw(t, http.MethodPut, ts.URL, data, admin, padded("", 200<<10)); resp.StatusCode != http.StatusOK {
		t.Errorf("200 KiB plugin data: status = %d, want 200", resp.StatusCode)
	}
	wantTooLarge(t, "plugin data", doRaw(t, http.MethodPut, ts.URL, data, admin, padded("", 256<<10)))

	// Sync push carries plugin data too: one oversized value is refused
	// there as well, so the push cannot bypass the per-value cap.
	push := `{"events":[],"pluginData":[{"pluginId":"qinqin-flashcards","workspaceId":` + ws +
		`,"key":"card:y","data":` + padded("", 256<<10) + `,"updatedAt":"2026-11-14T10:00:00Z"}]}`
	wantTooLarge(t, "sync push plugin data", doRaw(t, http.MethodPost, ts.URL, "/api/sync/push", admin, push))

	// A typed study row has the same per-item cap.
	card := `{"workspaceId":` + ws + `,"id":"c1","kind":"vocab","entryId":1,"written":null,"entryKind":null,"sentenceId":null,` +
		`"skipKinds":[],"deckIds":[],"createdAt":"t","updatedAt":"2026-11-14T10:00:00Z","extra":`
	if resp := doRaw(t, http.MethodPost, ts.URL, "/api/sync/push", admin, `{"cards":[`+card+padded("", 200<<10)+`}]}`); resp.StatusCode != http.StatusOK {
		t.Errorf("200 KiB typed card: status = %d, want 200", resp.StatusCode)
	}
	wantTooLarge(t, "sync push typed card", doRaw(t, http.MethodPost, ts.URL, "/api/sync/push", admin, `{"cards":[`+card+padded("", 256<<10)+`}]}`))
}

func TestEntryBodyLimit(t *testing.T) {
	ts, sqlDB := newServer(t)
	seedEntries(t, sqlDB)
	token := registerUser(t, ts.URL, "owner", "")
	// The entry must exist: an unknown id is 404 before the body is read.
	id := strconv.FormatInt(lexID(t, sqlDB, "zh", "character", "发"), 10)
	wantTooLarge(t, "PUT entry", doRaw(t, http.MethodPut, ts.URL, "/api/entries/"+id, token, padded(`"written":"x"`, 64<<10)))
}
