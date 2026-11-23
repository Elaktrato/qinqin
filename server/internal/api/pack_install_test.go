package api_test

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"qinqin/internal/packs"
)

type statusBody struct {
	Status  string           `json:"status"`
	Pack    *packs.Installed `json:"pack"`
	Summary string           `json:"summary"`
	Error   string           `json:"error"`
	Warning string           `json:"warning"`
}

func (e *packEnv) status(t *testing.T, token string) (int, statusBody) {
	t.Helper()
	resp := doJSON(t, http.MethodGet, e.ts.URL, "/api/admin/packs/staged/"+token, e.admin, nil)
	defer resp.Body.Close()
	var b statusBody
	if resp.StatusCode == http.StatusOK {
		json.NewDecoder(resp.Body).Decode(&b)
	}
	return resp.StatusCode, b
}

func (e *packEnv) install(t *testing.T, token, license string) (int, string) {
	t.Helper()
	resp := doJSON(t, http.MethodPost, e.ts.URL, "/api/admin/packs/staged/"+token, e.admin, map[string]string{"license": license})
	defer resp.Body.Close()
	return resp.StatusCode, bodyText(resp)
}

func (e *packEnv) waitDone(t *testing.T, want int) []string {
	t.Helper()
	var got []string
	for i := 0; i < want; i++ {
		select {
		case tok := <-e.done:
			got = append(got, tok)
		case <-time.After(30 * time.Second):
			t.Fatal("import job did not finish")
		}
	}
	return got
}

func TestStagedInstallRequiresExactLicence(t *testing.T) {
	e := newPackEnv(t)
	s := stageZip(t, e, esPackZip(t, packTestDictManifest))
	for _, lic := range []string{"CC0-1.0 ", "", "cc0-1.0"} {
		code, text := e.install(t, s.Token, lic)
		if code != http.StatusConflict || !strings.Contains(text, "confirm the pack's licence") {
			t.Errorf("licence %q: %d %q", lic, code, text)
		}
	}
	// A missing licence field is the same as an empty one.
	resp := doJSON(t, http.MethodPost, e.ts.URL, "/api/admin/packs/staged/"+s.Token, e.admin, map[string]string{})
	resp.Body.Close()
	if resp.StatusCode != http.StatusConflict {
		t.Errorf("no licence field: %d", resp.StatusCode)
	}
	if _, b := e.status(t, s.Token); b.Status != "staged" {
		t.Errorf("status after refusals = %q, want staged", b.Status)
	}
	if code, text := e.install(t, s.Token, "CC0-1.0"); code != http.StatusAccepted || !strings.Contains(text, `"importing"`) {
		t.Fatalf("install = %d %q", code, text)
	}
	e.waitDone(t, 1)
	code, b := e.status(t, s.Token)
	if code != 200 || b.Status != "done" || b.Summary != "2 entries, 2 senses" || b.Pack == nil || b.Pack.PackID != "es-test" || b.Pack.License != "CC0-1.0" {
		t.Errorf("status = %d %+v", code, b)
	}
	list, _ := packs.List(context.Background(), e.db)
	if len(list) != 1 || list[0].PackID != "es-test" {
		t.Errorf("list = %+v", list)
	}
	if _, err := os.Stat(filepath.Join(e.dataDir, "packs", "dictionary", "es-test", "1.0", "manifest.json")); err != nil {
		t.Errorf("pack not moved into place: %v", err)
	}
	if d := stageDirs(t, e.dataDir); len(d) != 0 {
		t.Errorf("stage dirs left: %v", d)
	}
}

func TestStagedInstallWhileImportingAndUnknownToken(t *testing.T) {
	e := newPackEnv(t)
	s := stageZip(t, e, esPackZip(t, packTestDictManifest))
	e.lock() // the job waits for the pack mutex
	if code, _ := e.install(t, s.Token, "CC0-1.0"); code != http.StatusAccepted {
		t.Fatalf("install = %d", code)
	}
	code, text := e.install(t, s.Token, "CC0-1.0")
	if code != http.StatusConflict || !strings.HasPrefix(text, "pack_import_running: ") {
		t.Errorf("second install = %d %q", code, text)
	}
	if _, b := e.status(t, s.Token); b.Status != "importing" {
		t.Errorf("status = %q", b.Status)
	}
	resp := doJSON(t, http.MethodDelete, e.ts.URL, "/api/admin/packs/staged/"+s.Token, e.admin, nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusConflict {
		t.Errorf("discard while importing = %d, want 409", resp.StatusCode)
	}
	e.unlock()
	e.waitDone(t, 1)
	if _, b := e.status(t, s.Token); b.Status != "done" {
		t.Errorf("status = %q", b.Status)
	}
	if code, _ := e.status(t, strings.Repeat("0", 32)); code != http.StatusNotFound {
		t.Errorf("unknown token GET = %d", code)
	}
	if code, _ := e.install(t, strings.Repeat("0", 32), "x"); code != http.StatusNotFound {
		t.Errorf("unknown token POST = %d", code)
	}
	// A finished result expires 30 minutes after it finished.
	e.advance(31 * time.Minute)
	if code, _ := e.status(t, s.Token); code != http.StatusNotFound {
		t.Errorf("expired result GET = %d", code)
	}
}

func TestStagedInstallOtherTypes(t *testing.T) {
	e := newPackEnv(t)
	installTestPacks(t, e.db) // entries for levels and sentences to attach to
	e.db.Exec(`UPDATE sentence_packs SET deleted_at = 't'`)
	cases := map[string]struct {
		manifest, file, data, want string
	}{
		"levels": {`{"id":"es-lv","name":"Levels","version":"1","type":"levels","language":"es","license":"MIT","attribution":"x","format":"json"}`,
			"levels.json", `{"unit":"word","levels":[{"name":"1","entries":["hola"]}]}`, "0 unknown forms skipped"},
		"sentences": {`{"id":"es-s2","name":"S2","version":"1","type":"sentences","language":"es","license":"MIT","attribution":"x","format":"json"}`,
			"sentences.json", packTestSentences, "0 unknown words skipped"},
		"frequency": {`{"id":"es-fq","name":"Freq","version":"1","type":"frequency","language":"es","license":"MIT","attribution":"x","format":"freq-csv"}`,
			"freq.csv", "term,reading,rank\nhola,,1\n", "1 rows"},
	}
	for typ, c := range cases {
		dir := t.TempDir()
		os.WriteFile(filepath.Join(dir, "manifest.json"), []byte(c.manifest), 0o644)
		os.WriteFile(filepath.Join(dir, c.file), []byte(c.data), 0o644)
		s := stageZip(t, e, zipDirToBytes(t, dir))
		if code, _ := e.install(t, s.Token, "MIT"); code != http.StatusAccepted {
			t.Fatalf("%s install = %d", typ, code)
		}
		e.waitDone(t, 1)
		if _, b := e.status(t, s.Token); b.Status != "done" || b.Summary != c.want {
			t.Errorf("%s status = %+v, want %q", typ, b, c.want)
		}
	}
}

func TestStagedInstallsSerialize(t *testing.T) {
	e := newPackEnv(t)
	a := stageZip(t, e, esPackZip(t, packTestDictManifest))
	b := stageZip(t, e, esPackZip(t, packTestDictManifest))
	var wg sync.WaitGroup
	for _, tok := range []string{a.Token, b.Token} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if code, text := e.install(t, tok, "CC0-1.0"); code != http.StatusAccepted {
				t.Errorf("install = %d %q", code, text)
			}
		}()
	}
	wg.Wait()
	e.waitDone(t, 2)
	for _, tok := range []string{a.Token, b.Token} {
		if _, s := e.status(t, tok); s.Status != "done" {
			t.Errorf("status = %+v", s)
		}
	}
	list, _ := packs.List(context.Background(), e.db)
	if len(list) != 1 {
		t.Errorf("list = %+v, want one row", list)
	}
	entries, _ := os.ReadDir(filepath.Join(e.dataDir, "packs", "dictionary", "es-test"))
	if len(entries) != 1 || entries[0].Name() != "1.0" {
		t.Errorf("pack dir = %v, want only 1.0", entries)
	}
}

func TestStagedInstallFailureReportsAndCleans(t *testing.T) {
	e := newPackEnv(t)
	dir := buildPackDir(t, packTestDictManifest, `{not json`)
	s := stageZip(t, e, zipDirToBytes(t, dir))
	if code, _ := e.install(t, s.Token, "CC0-1.0"); code != http.StatusAccepted {
		t.Fatal(code)
	}
	e.waitDone(t, 1)
	_, b := e.status(t, s.Token)
	if b.Status != "failed" || !strings.HasPrefix(b.Error, "invalid pack") || strings.Contains(b.Error, e.dataDir) {
		t.Errorf("status = %+v", b)
	}
	if list, _ := packs.List(context.Background(), e.db); len(list) != 0 {
		t.Errorf("list = %+v", list)
	}
	if d := stageDirs(t, e.dataDir); len(d) != 0 {
		t.Errorf("stage dirs left: %v", d)
	}
}

func TestStagedInstallSurvivesCancelledRequest(t *testing.T) {
	e := newPackEnv(t)
	s := stageZip(t, e, esPackZip(t, packTestDictManifest))
	e.lock()
	ctx, cancel := context.WithCancel(context.Background())
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, e.ts.URL+"/api/admin/packs/staged/"+s.Token,
		strings.NewReader(`{"license":"CC0-1.0"}`))
	req.Header.Set("Authorization", "Bearer "+e.admin)
	resp, err := http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != http.StatusAccepted {
		t.Fatalf("install: %v %v", resp, err)
	}
	resp.Body.Close()
	cancel() // the client gives up right after the 202
	e.unlock()
	e.waitDone(t, 1)
	if _, b := e.status(t, s.Token); b.Status != "done" {
		t.Errorf("status = %+v, want done despite the cancelled request", b)
	}
}

// Audio packs are installed by the fetch script and `qinqin seed`, not by
// upload: a 10,000-clip pack exceeds the upload's file and size limits, and its
// clips live under <data>/audio, not <data>/packs. The refusal is a clear 422.
func TestAudioPackUploadIsRefused(t *testing.T) {
	e := newPackEnv(t)
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "manifest.json"), []byte(`{"id":"a1","name":"A","version":"1","type":"audio","language":"ja","license":"CC0","attribution":"x","format":"audio-index"}`), 0o644)
	os.WriteFile(filepath.Join(dir, "index.tsv"), []byte("kind\tform\treading\tfile\tlicense\tattribution\tsource\n"), 0o644)
	resp := uploadZip(t, e, e.admin, zipDirToBytes(t, dir))
	body := bodyText(resp)
	if resp.StatusCode != http.StatusUnprocessableEntity || !strings.HasPrefix(body, "pack_type_unsupported: ") || !strings.Contains(body, "qinqin seed") {
		t.Errorf("audio upload = %d %q, want 422 naming the fetch script and seed", resp.StatusCode, body)
	}
}
