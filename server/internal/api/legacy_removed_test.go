package api_test

import (
	"archive/zip"
	"bytes"
	"database/sql"
	"encoding/json"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/study"
	"qinqin/internal/study/rows"
)

// The v0.3 compatibility layer is gone (#198) and stays gone: the legacy
// pull, the legacy view of the typed study rows on the plugin-data routes
// and in a push, and the synthesized data-pack plugin rows. v0.3.x clients
// are not supported; old backups still restore (through the restore path
// only). docs/contracts/CHANGELOG.md.

// typedKeys are qinqin-flashcards keys of the typed study families: they
// exist only as typed rows, never as plugin data.
var typedKeys = []string{"card:c-vocab-1", "deck:d1", "deckcfg:d1", "limits:workspace", "limits:deck:d1", "fsrs:set:s1", "fsrs:active"}

func wantCoded404(t *testing.T, what string, status int, body []byte) {
	t.Helper()
	if status != http.StatusNotFound {
		t.Errorf("%s = %d %s, want 404", what, status, body)
		return
	}
	if code, _ := jsonError(t, body); code != "not_found" {
		t.Errorf("%s code = %q, want not_found", what, code)
	}
}

// backdate moves every study and plugin row a second or more into the past:
// a paged pull ships rows stamped before the current second only.
func backdate(t *testing.T, exec func(string, ...any) (sql.Result, error)) {
	t.Helper()
	tables := []string{"plugin_data"}
	for _, f := range rows.Families {
		tables = append(tables, study.TableOf(f))
	}
	for _, tb := range tables {
		if _, err := exec(`UPDATE ` + tb + ` SET updated_at = '2026-01-01T00:00:00Z'`); err != nil {
			t.Fatal(err)
		}
	}
}

func TestLegacyPullAndViewAreGone(t *testing.T) {
	ts, sqlDB := newServer(t)
	alice := registerUser(t, ts.URL, "alice", "")
	seedBuiltin(t, sqlDB, validManifest("qinqin-flashcards", ""))
	ws := createWorkspace(t, ts.URL, alice, "zh", "")
	aliceID := userID(t, sqlDB, "alice")
	w := itoa(ws)

	// a typed card through the typed push, and a leftover plugin row of a
	// typed family (what an old binary could leave behind)
	card := map[string]any{"workspaceId": ws, "id": "c-vocab-1", "kind": "vocab", "entryId": 1, "written": nil, "entryKind": nil,
		"sentenceId": nil, "skipKinds": []string{}, "deckIds": []string{"general"}, "createdAt": "2026-11-10T08:00:00Z", "extra": map[string]any{},
		"updatedAt": "2026-11-10T08:00:00Z"}
	if r := doJSON(t, "POST", ts.URL, "/api/sync/push", alice, map[string]any{"cards": []any{card}}); r.StatusCode != 200 {
		t.Fatalf("typed push = %d", r.StatusCode)
	}
	if _, err := sqlDB.Exec(`INSERT INTO plugin_data (pack_id, user_id, workspace_id, key, data, version, updated_at, modified_at)
		VALUES ('qinqin-flashcards', ?, ?, 'card:left', '{"id":"other"}', 1, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z')`, aliceID, ws); err != nil {
		t.Fatal(err)
	}

	// the legacy pull: every request without v=2
	for _, path := range []string{"/api/sync/pull", "/api/sync/pull?cursor=1970-01-01T00:00:00Z",
		"/api/sync/pull?cursor=1970-01-01T00:00:00Z&collections=pluginData,pluginStates", "/api/sync/pull?v=1"} {
		status, h, body := get(t, ts.URL, path, alice)
		wantCoded404(t, "GET "+path, status, body)
		if h.Get("Deprecation") != "" {
			t.Errorf("GET %s still carries Deprecation", path)
		}
	}

	// the legacy view: typed-family keys are not plugin data
	for _, key := range append([]string{"card:left"}, typedKeys...) {
		path := "/api/plugins/qinqin-flashcards/data/" + key + "?workspace=" + w
		status, _, body := get(t, ts.URL, path, alice)
		wantCoded404(t, "GET "+key, status, body)
		r := doRaw(t, "PUT", ts.URL, path, alice, `{"id":"c-vocab-1","kind":"vocab","entryId":1,"deckIds":["general"],"createdAt":"2026-11-10T08:00:00Z"}`)
		var b bytes.Buffer
		b.ReadFrom(r.Body)
		wantCoded404(t, "PUT "+key, r.StatusCode, b.Bytes())
		r = doRaw(t, "DELETE", ts.URL, path, alice, "")
		b.Reset()
		b.ReadFrom(r.Body)
		wantCoded404(t, "DELETE "+key, r.StatusCode, b.Bytes())
	}
	var live int
	sqlDB.QueryRow(`SELECT COUNT(*) FROM study_cards WHERE user_id = ? AND deleted_at IS NULL`, aliceID).Scan(&live)
	if live != 1 {
		t.Errorf("live typed cards = %d, want 1 (a legacy DELETE or PUT changed them)", live)
	}
	for _, path := range []string{"/api/plugins/qinqin-flashcards/data?workspace=" + w, "/api/plugins/qinqin-flashcards/data?workspace=" + w + "&prefix=card:"} {
		status, _, body := get(t, ts.URL, path, alice)
		var list []struct {
			Key string `json:"key"`
		}
		if status != 200 || json.Unmarshal(body, &list) != nil {
			t.Fatalf("GET %s = %d %s", path, status, body)
		}
		for _, d := range list {
			if strings.HasPrefix(d.Key, "card:") {
				t.Errorf("GET %s lists %s", path, d.Key)
			}
		}
	}

	// a push of a typed-family key as plugin data is refused alone
	r := doJSON(t, "POST", ts.URL, "/api/sync/push", alice, map[string]any{"pluginData": []any{
		map[string]any{"pluginId": "qinqin-flashcards", "workspaceId": ws, "key": "card:c-vocab-2", "updatedAt": "2026-11-10T08:00:00Z",
			"data": map[string]any{"id": "c-vocab-2", "kind": "vocab", "entryId": 2, "deckIds": []string{"general"}, "createdAt": "2026-11-10T08:00:00Z"}},
		map[string]any{"pluginId": "qinqin-flashcards", "workspaceId": ws, "key": "known:2", "updatedAt": "2026-11-10T08:00:00Z",
			"data": map[string]any{"version": 1, "entryId": 2, "createdAt": "2026-11-10T08:00:00Z"}},
	}})
	var res struct {
		DataAccepted, DataSkipped, DataRefused int
	}
	decodeJSON(t, r, &res)
	if res.DataAccepted != 1 || res.DataRefused != 1 {
		t.Errorf("push result %+v, want 1 accepted (known:2) and 1 refused (card:c-vocab-2)", res)
	}
	var n int
	sqlDB.QueryRow(`SELECT (SELECT COUNT(*) FROM study_cards WHERE id = 'c-vocab-2') + (SELECT COUNT(*) FROM plugin_data WHERE key = 'card:c-vocab-2')`).Scan(&n)
	if n != 0 {
		t.Errorf("the refused card was stored (%d rows)", n)
	}

	// the paged pull never ships a typed-family leftover in pluginData
	backdate(t, sqlDB.Exec)
	status, _, body := get(t, ts.URL, "/api/sync/pull?v=2&collections=pluginData,cards", alice)
	var page v2Page
	if status != 200 || json.Unmarshal(body, &page) != nil {
		t.Fatalf("v2 pull = %d %s", status, body)
	}
	for _, raw := range page.Collections["pluginData"] {
		if strings.Contains(string(raw), `"key":"card:`) {
			t.Errorf("v2 pull ships the leftover %s", raw)
		}
	}
	if len(page.Collections["cards"]) != 1 {
		t.Errorf("v2 pull cards = %d, want 1", len(page.Collections["cards"]))
	}
}

// zipSampleV1 zips the committed v0.3.0 sample archive
// (docs/contracts/backup/sample-v1, keyed qinqin-flashcards study rows).
func zipSampleV1(t *testing.T) []byte {
	t.Helper()
	root := "../../../docs/contracts/backup/sample-v1"
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	var manifest []byte
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel, _ := filepath.Rel(root, path)
		b, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if rel == "manifest.json" {
			manifest = b // written last, like every archive
			return nil
		}
		f, err := zw.Create(filepath.ToSlash(rel))
		if err == nil {
			_, err = f.Write(b)
		}
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	f, _ := zw.Create("manifest.json")
	f.Write(manifest)
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// Ruling (plan 2026-11-23-remove-v03-compat): an old-format backup — keyed
// study rows, written by a v0.3.0 server — still restores, through the
// restore path only: its rows land in the typed tables, the paged pull ships
// them typed, and their old keys are not served as plugin data.
func TestOldFormatBackupRestoresIntoTypedRows(t *testing.T) {
	e := newBackupEnv(t)
	alice := registerUser(t, e.ts.URL, "alice", "")
	createWorkspace(t, e.ts.URL, alice, "zh", "")
	res, err := e.db.Exec(`INSERT INTO entries (language, kind, ext_key, updated_at) VALUES ('zh', 'word', 'cc-1201', 't')`)
	if err != nil {
		t.Fatal(err)
	}
	entry, _ := res.LastInsertId()
	// the sample's second workspace is Japanese, a language this test server has no pack for
	if _, err := e.db.Exec(`INSERT OR IGNORE INTO languages (code, name, updated_at) VALUES ('ja', 'Japanese', 't')`); err != nil {
		t.Fatal(err)
	}
	if _, err := e.db.Exec(`INSERT INTO forms (entry_id, text, ord, updated_at) VALUES (?, '你好', 0, 't')`, entry); err != nil {
		t.Fatal(err)
	}

	code, rt, eb := e.upload(t, alice, zipSampleV1(t))
	if code != 202 {
		t.Fatalf("upload = %d %+v", code, eb)
	}
	e.wait(t)
	if _, st := e.status(t, alice, rt); st.Status != "ready" {
		t.Fatalf("stage: %+v %+v", st, st.Error)
	}
	if c, eb := e.apply(t, alice, rt, map[string]any{"confirm": "alice", "password": "secret-pass-alice"}); c != 202 {
		t.Fatalf("apply = %d %+v", c, eb)
	}
	e.wait(t)
	if _, st := e.status(t, alice, rt); st.Status != "done" {
		t.Fatalf("restore: %+v %+v", st, st.Error)
	}
	var ws int64
	e.db.QueryRow(`SELECT w.id FROM workspaces w JOIN users u ON u.id = w.user_id WHERE u.username = 'alice' AND w.language = 'zh'`).Scan(&ws)
	cardID := "c-vocab-" + itoa(entry)
	backdate(t, e.db.Exec)

	status, _, body := get(t, e.ts.URL, "/api/sync/pull?v=2&collections=cards,decks,limits,pluginData&workspace="+itoa(ws), alice)
	var page v2Page
	if status != 200 || json.Unmarshal(body, &page) != nil {
		t.Fatalf("v2 pull = %d %s", status, body)
	}
	found := false
	for _, raw := range page.Collections["cards"] {
		var c struct {
			ID string `json:"id"`
		}
		json.Unmarshal(raw, &c)
		found = found || c.ID == cardID
	}
	if !found || len(page.Collections["decks"]) != 1 || len(page.Collections["limits"]) != 2 {
		t.Errorf("restored typed rows: %s cards %d (want %s), decks %d, limits %d", body, len(page.Collections["cards"]), cardID,
			len(page.Collections["decks"]), len(page.Collections["limits"]))
	}
	for _, raw := range page.Collections["pluginData"] {
		var d struct {
			PluginID, Key string
		}
		json.Unmarshal(raw, &d)
		if d.PluginID == "qinqin-flashcards" && (strings.HasPrefix(d.Key, "card:") || strings.HasPrefix(d.Key, "deck:") || strings.HasPrefix(d.Key, "limits:")) {
			t.Errorf("restored keyed study row %s left in plugin data", d.Key)
		}
	}
	status, _, body = get(t, e.ts.URL, "/api/plugins/qinqin-flashcards/data/card:"+cardID+"?workspace="+itoa(ws), alice)
	wantCoded404(t, "GET card:"+cardID, status, body)
}

// GET /api/plugins lists registry plugins only: no row per installed data
// pack (#169), and a data pack's id is no plugin for the state and data
// routes or a push.
func TestDataPackPluginRowsAreGone(t *testing.T) {
	ts, sqlDB := newServer(t)
	alice := registerUser(t, ts.URL, "alice", "")
	seedBuiltin(t, sqlDB, validManifest("qinqin-flashcards", ""))
	ws := createWorkspace(t, ts.URL, alice, "zh", "")
	for _, q := range []string{
		`INSERT INTO grammar_packs (pack_id, name, version, language, license, attribution, levels_json, updated_at) VALUES ('zh-grammar', 'n', '1', 'zh', 'l', 'a', '[]', 't')`,
		`INSERT INTO audio_packs (pack_id, language, name, version, license, attribution, created_at, updated_at) VALUES ('zh-audio', 'zh', 'n', '1', 'l', 'a', 't', 't')`,
		`INSERT INTO frequency_packs (id, pack_id, name, version, language, license, attribution, ord, updated_at) VALUES (1, 'zh-freq', 'n', '1', 'zh', 'l', 'a', 1, 't')`,
	} {
		if _, err := sqlDB.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	status, _, body := get(t, ts.URL, "/api/plugins", alice)
	var list []struct {
		ID string `json:"id"`
	}
	if status != 200 || json.Unmarshal(body, &list) != nil {
		t.Fatalf("GET /api/plugins = %d %s", status, body)
	}
	for _, p := range list {
		if strings.HasPrefix(p.ID, "zh-") {
			t.Errorf("GET /api/plugins lists the data pack %s", p.ID)
		}
	}
	for _, id := range []string{"zh-grammar", "zh-audio", "zh-freq"} {
		r := doRaw(t, "PUT", ts.URL, "/api/plugins/"+id+"/state", alice, `{"enabled":false,"order":0}`)
		var b bytes.Buffer
		b.ReadFrom(r.Body)
		wantCoded404(t, "PUT state of "+id, r.StatusCode, b.Bytes())
		status, _, body := get(t, ts.URL, "/api/plugins/"+id+"/data?workspace="+itoa(ws), alice)
		wantCoded404(t, "GET data of "+id, status, body)
		r = doRaw(t, "PUT", ts.URL, "/api/plugins/"+id+"/data/k?workspace="+itoa(ws), alice, `{}`)
		b.Reset()
		b.ReadFrom(r.Body)
		wantCoded404(t, "PUT data of "+id, r.StatusCode, b.Bytes())
		r = doJSON(t, "POST", ts.URL, "/api/sync/push", alice, map[string]any{"pluginData": []any{
			map[string]any{"pluginId": id, "key": "k", "workspaceId": ws, "data": map[string]any{}, "updatedAt": "2026-11-10T08:00:00Z"}}})
		if r.StatusCode != http.StatusNotFound {
			t.Errorf("push of %s data = %d, want 404 (an unknown plugin)", id, r.StatusCode)
		}
	}
}

// The removed identifiers stay out of the server's code: a grep guard
// next to the behaviour tests above.
func TestLegacyCompatCodeStaysGone(t *testing.T) {
	banned := []string{"StreamLegacy", "LegacyGet(", "LegacyList(", "ApplyLegacy(", "legacyView", "mergeLegacyList", "legacyPut(",
		"legacyRows", "LegacyPluginRow", "sentencePlugins", "warnEntryIDUsers", "dataPlugin("}
	err := filepath.WalkDir("../..", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		b, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		for _, s := range banned {
			if strings.Contains(string(b), s) {
				t.Errorf("%s contains %q (removed in #198)", path, s)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
