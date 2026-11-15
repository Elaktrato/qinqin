package api_test

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"

	"qinqin/internal/ai"
	"qinqin/internal/api"
	"qinqin/internal/journal"
)

type fakeOCR struct {
	avail bool
	langs map[string]bool
	text  string
	err   error
	calls atomic.Int32
}

func (f *fakeOCR) Available() bool { return f != nil && f.avail }
func (f *fakeOCR) HasLanguages(l string) bool {
	if !f.Available() || l == "" {
		return false
	}
	for _, m := range strings.Split(l, "+") {
		if !f.langs[m] {
			return false
		}
	}
	return true
}
func (f *fakeOCR) Recognize(_ context.Context, _ []byte, _ string) (string, error) {
	f.calls.Add(1)
	return f.text, f.err
}

func newOCR() *fakeOCR {
	return &fakeOCR{avail: true, langs: map[string]bool{"chi_sim": true, "chi_tra": true, "eng": true, "jpn": true}, text: "你好世界"}
}

func (e journalEnv) transcribe(t *testing.T, token string, ws int64, photo, engine string) (int, map[string]any) {
	t.Helper()
	resp := doJSON(t, http.MethodPost, e.url, "/api/journal/transcribe", token, map[string]any{"workspaceId": ws, "photoId": photo, "engine": engine})
	var out map[string]any
	json.NewDecoder(resp.Body).Decode(&out) // plain-text errors (404, 400) leave it nil
	return resp.StatusCode, out
}

func (e journalEnv) uploadOK(t *testing.T, token string, ws int64) string {
	t.Helper()
	resp := uploadPhoto(t, e, token, ws, testJPEG(t, 40, 30))
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("upload: %d", resp.StatusCode)
	}
	var c struct {
		PhotoID string `json:"photoId"`
	}
	decodeJSON(t, resp, &c)
	return c.PhotoID
}

func (e journalEnv) userID(t *testing.T, name string) int64 {
	t.Helper()
	var id int64
	if err := e.db.QueryRow(`SELECT id FROM users WHERE username = ?`, name).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func TestTranscribeRoutes(t *testing.T) {
	ocr := newOCR()
	e := newJournalEnvOpts(t, ai.Fake{}, true, api.WithOCR(ocr))
	photo := e.uploadOK(t, e.token, e.ws)

	status, out := e.transcribe(t, e.token, e.ws, photo, "ai")
	if status != 200 || out["text"] != "fake transcription" || out["engine"] != "ai" || out["unreadable"] != false {
		t.Fatalf("ai: %d %v", status, out)
	}
	if ocr.calls.Load() != 0 {
		t.Fatal("the ai engine must not run offline OCR")
	}
	status, out = e.transcribe(t, e.token, e.ws, photo, "offline")
	if status != 200 || out["text"] != "你好世界" || out["engine"] != "offline" || out["unreadable"] != false {
		t.Fatalf("offline: %d %v", status, out)
	}
	ocr.text = ""
	if _, out = e.transcribe(t, e.token, e.ws, photo, "offline"); out["unreadable"] != true {
		t.Fatalf("empty page: %v", out)
	}

	// The unreadable flag of the AI passes through (the fake: image under 100 bytes).
	uid := e.userID(t, "root")
	tiny, err := journal.Photos{DB: e.db, Dir: filepath.Join(e.dataDir, "journal")}.Create(context.Background(), uid, e.ws, []byte("tiny"))
	if err != nil {
		t.Fatal(err)
	}
	if _, out = e.transcribe(t, e.token, e.ws, tiny.ID, "ai"); out["unreadable"] != true {
		t.Fatalf("ai unreadable: %v", out)
	}

	// Scoping.
	other := registerUser(t, e.url, "mallory", e.token)
	if status, _ = e.transcribe(t, other, e.ws, photo, "offline"); status != 404 {
		t.Errorf("foreign user: %d", status)
	}
	if status, _ = e.transcribe(t, e.token, e.other, photo, "offline"); status != 404 {
		t.Errorf("photo of another workspace: %d", status)
	}
	if status, _ = e.transcribe(t, e.token, e.ws, "01NOSUCHPHOTO", "ai"); status != 404 {
		t.Errorf("unknown photo: %d", status)
	}
	if status, _ = e.transcribe(t, e.token, e.ws, photo, "telepathy"); status != 400 {
		t.Errorf("unknown engine: %d", status)
	}
	if status, _ = e.transcribe(t, "", e.ws, photo, "ai"); status != 401 {
		t.Errorf("anonymous: %d", status)
	}
	// Neither engine writes plugin data.
	var n int
	e.db.QueryRow(`SELECT COUNT(*) FROM plugin_data WHERE plugin_id = 'qinqin-journal'`).Scan(&n)
	if n != 0 {
		t.Errorf("%d plugin data rows written by transcription", n)
	}
}

func TestTranscribeAIWithoutKeyDoesNotRunOffline(t *testing.T) {
	ocr := newOCR()
	e := newJournalEnvOpts(t, ai.Fake{}, false, api.WithOCR(ocr))
	photo := e.uploadOK(t, e.token, e.ws)
	status, out := e.transcribe(t, e.token, e.ws, photo, "ai")
	if status != 409 || out["error"] != "no_key" {
		t.Fatalf("%d %v", status, out)
	}
	if ocr.calls.Load() != 0 {
		t.Fatal("no silent fallback to offline OCR")
	}
}

func TestTranscribeOfflineErrors(t *testing.T) {
	e := newJournalEnv(t, ai.Fake{}, true) // no OCR configured
	photo := e.uploadOK(t, e.token, e.ws)
	status, out := e.transcribe(t, e.token, e.ws, photo, "offline")
	if status != 409 || out["error"] != "ocr_unavailable" || out["message"] != "Offline reading is not installed on this server." {
		t.Fatalf("no OCR: %d %v", status, out)
	}

	ocr := newOCR()
	e = newJournalEnvOpts(t, ai.Fake{}, true, api.WithOCR(ocr))
	ko := createWorkspace(t, e.url, e.token, "ko", "")
	kp := e.uploadOK(t, e.token, ko)
	status, out = e.transcribe(t, e.token, ko, kp, "offline")
	if status != 409 || out["error"] != "ocr_language_missing" || out["message"] != "Offline reading has no model for Korean." {
		t.Fatalf("language: %d %v", status, out)
	}
	delete(ocr.langs, "jpn")
	ja := createWorkspace(t, e.url, e.token, "ja", "")
	jp := e.uploadOK(t, e.token, ja)
	if status, out = e.transcribe(t, e.token, ja, jp, "offline"); status != 409 || out["error"] != "ocr_language_missing" {
		t.Fatalf("missing jpn model: %d %v", status, out)
	}

	ocr.err = journal.ErrOCRBusy
	photo = e.uploadOK(t, e.token, e.ws)
	resp := doJSON(t, http.MethodPost, e.url, "/api/journal/transcribe", e.token, map[string]any{"workspaceId": e.ws, "photoId": photo, "engine": "offline"})
	if resp.StatusCode != 503 || resp.Header.Get("Retry-After") == "" {
		t.Fatalf("busy: %d", resp.StatusCode)
	}
	ocr.err = nil
}

func TestTranscribeOfflineRateLimit(t *testing.T) {
	ocr := newOCR()
	e := newJournalEnvOpts(t, ai.Fake{}, false, api.WithOCR(ocr))
	photo := e.uploadOK(t, e.token, e.ws)
	for i := 0; i < 60; i++ {
		if status, _ := e.transcribe(t, e.token, e.ws, photo, "offline"); status != 200 {
			t.Fatalf("read %d: %d", i, status)
		}
	}
	resp := doJSON(t, http.MethodPost, e.url, "/api/journal/transcribe", e.token, map[string]any{"workspaceId": e.ws, "photoId": photo, "engine": "offline"})
	if resp.StatusCode != 429 || resp.Header.Get("Retry-After") == "" {
		t.Fatalf("61st read: %d", resp.StatusCode)
	}
	if ocr.calls.Load() != 60 {
		t.Fatalf("OCR ran %d times", ocr.calls.Load())
	}
}

func TestCapabilitiesOCR(t *testing.T) {
	type caps struct {
		OCR struct {
			Available     bool   `json:"available"`
			LanguageReady bool   `json:"languageReady"`
			Language      string `json:"language"`
		} `json:"ocr"`
	}
	get := func(e journalEnv, ws int64) caps {
		var c caps
		decodeJSON(t, doJSON(t, http.MethodGet, e.url, "/api/journal/capabilities?workspace="+strconv.FormatInt(ws, 10), e.token, nil), &c)
		return c
	}
	e := newJournalEnvOpts(t, ai.Fake{}, true, api.WithOCR(newOCR()))
	ko := createWorkspace(t, e.url, e.token, "ko", "")
	if c := get(e, e.ws); !c.OCR.Available || !c.OCR.LanguageReady || c.OCR.Language != "zh" {
		t.Errorf("zh: %+v", c)
	}
	if c := get(e, ko); !c.OCR.Available || c.OCR.LanguageReady || c.OCR.Language != "ko" {
		t.Errorf("ko: %+v", c)
	}
	e = newJournalEnv(t, ai.Fake{}, true)
	if c := get(e, e.ws); c.OCR.Available || c.OCR.LanguageReady {
		t.Errorf("no OCR: %+v", c)
	}
	_ = os.Stderr
}

func TestTranscribeOfflineBusyDoesNotCount(t *testing.T) {
	ocr := newOCR()
	ocr.err = journal.ErrOCRBusy
	e := newJournalEnvOpts(t, ai.Fake{}, false, api.WithOCR(ocr))
	photo := e.uploadOK(t, e.token, e.ws)
	for i := 0; i < 70; i++ {
		if status, _ := e.transcribe(t, e.token, e.ws, photo, "offline"); status != 503 {
			t.Fatalf("busy read %d: %d", i, status)
		}
	}
	ocr.err = nil
	if status, _ := e.transcribe(t, e.token, e.ws, photo, "offline"); status != 200 {
		t.Fatalf("read after busy answers: %d", status)
	}
}
