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
	tables := []string{"keyed_rows"}
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
	ws := createWorkspace(t, ts.URL, alice, "zh", "")
	aliceID := userID(t, sqlDB, "alice")
	w := itoa(ws)

	// a typed card through the typed push
	card := map[string]any{"workspaceId": ws, "id": "c-vocab-1", "kind": "vocab", "entryId": 1, "written": nil, "entryKind": nil,
		"sentenceId": nil, "skipKinds": []string{}, "deckIds": []string{"general"}, "createdAt": "2026-11-10T08:00:00Z", "extra": map[string]any{},
		"updatedAt": "2026-11-10T08:00:00Z"}
	if r := doJSON(t, "POST", ts.URL, "/api/sync/push", alice, map[string]any{"cards": []any{card}}); r.StatusCode != 200 {
		t.Fatalf("typed push = %d", r.StatusCode)
	}

	// the legacy pull: every request without v=2
	for _, path := range []string{"/api/sync/pull", "/api/sync/pull?cursor=1970-01-01T00:00:00Z",
		"/api/sync/pull?cursor=1970-01-01T00:00:00Z&collections=rows,features", "/api/sync/pull?v=1"} {
		status, h, body := get(t, ts.URL, path, alice)
		wantCoded404(t, "GET "+path, status, body)
		if h.Get("Deprecation") != "" {
			t.Errorf("GET %s still carries Deprecation", path)
		}
	}

	// the legacy view: typed-family keys are no keyed rows
	for _, key := range typedKeys {
		path := "/api/rows/" + key + "?workspace=" + w
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
	for _, path := range []string{"/api/rows?workspace=" + w, "/api/rows?workspace=" + w + "&prefix=card:"} {
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

	// a push of any typed-family key as a keyed row is refused alone
	items := []any{map[string]any{"workspaceId": ws, "key": "known:2", "updatedAt": "2026-11-10T08:00:00Z",
		"data": map[string]any{"version": 1, "entryId": 2, "createdAt": "2026-11-10T08:00:00Z"}}}
	for _, key := range typedKeys {
		items = append(items, map[string]any{"workspaceId": ws, "key": key, "updatedAt": "2026-11-10T08:00:00Z",
			"data": map[string]any{"id": "x", "kind": "vocab", "entryId": 2, "deckIds": []string{"general"}, "createdAt": "2026-11-10T08:00:00Z"}})
	}
	r := doJSON(t, "POST", ts.URL, "/api/sync/push", alice, map[string]any{"rows": items})
	var res struct {
		DataAccepted, DataSkipped, DataRefused int
	}
	decodeJSON(t, r, &res)
	if res.DataAccepted != 1 || res.DataRefused != len(typedKeys) {
		t.Errorf("push result %+v, want 1 accepted (known:2) and %d refused (every typed key)", res, len(typedKeys))
	}
	for _, key := range typedKeys {
		var n int
		sqlDB.QueryRow(`SELECT COUNT(*) FROM keyed_rows WHERE key = ?`, key).Scan(&n)
		if n != 0 {
			t.Errorf("the refused %s was stored as a keyed row", key)
		}
	}
	var typedRows int
	sqlDB.QueryRow(`SELECT (SELECT COUNT(*) FROM study_cards) + (SELECT COUNT(*) FROM study_decks) + (SELECT COUNT(*) FROM study_deck_settings)
		+ (SELECT COUNT(*) FROM study_limits) + (SELECT COUNT(*) FROM study_fsrs_sets) + (SELECT COUNT(*) FROM study_fsrs_active)`).Scan(&typedRows)
	if typedRows != 1 {
		t.Errorf("typed rows = %d after the refused push, want the one card", typedRows)
	}

	// the paged pull never ships a typed-family key in rows
	backdate(t, sqlDB.Exec)
	status, _, body := get(t, ts.URL, "/api/sync/pull?v=2&collections=rows,cards", alice)
	var page v2Page
	if status != 200 || json.Unmarshal(body, &page) != nil {
		t.Fatalf("v2 pull = %d %s", status, body)
	}
	for _, raw := range page.Collections["rows"] {
		if strings.Contains(string(raw), `"key":"card:`) {
			t.Errorf("v2 pull ships the leftover %s", raw)
		}
	}
	if len(page.Collections["cards"]) != 1 {
		t.Errorf("v2 pull cards = %d, want 1", len(page.Collections["cards"]))
	}
}

// zipSample zips the committed sample archive (docs/contracts/backup/sample-v2,
// typed study rows in their keyed form).
func zipSample(t *testing.T) []byte {
	t.Helper()
	root := "../../../docs/contracts/backup/sample-v2"
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

// A backup carries typed study rows in their keyed form; they restore through
// the restore path only: they land in the typed tables, the paged pull ships
// them typed, and their keys are not served as keyed rows. (Format 1 archives
// are refused since #199.)
func TestKeyedFormBackupRestoresIntoTypedRows(t *testing.T) {
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

	code, rt, eb := e.upload(t, alice, zipSample(t))
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

	status, _, body := get(t, e.ts.URL, "/api/sync/pull?v=2&collections=cards,decks,limits,rows&workspace="+itoa(ws), alice)
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
	for _, raw := range page.Collections["rows"] {
		var d struct {
			Key string
		}
		json.Unmarshal(raw, &d)
		if strings.HasPrefix(d.Key, "card:") || strings.HasPrefix(d.Key, "deck:") || strings.HasPrefix(d.Key, "limits:") {
			t.Errorf("restored keyed study row %s left in the keyed rows", d.Key)
		}
	}
	status, _, body = get(t, e.ts.URL, "/api/rows/card:"+cardID+"?workspace="+itoa(ws), alice)
	wantCoded404(t, "GET card:"+cardID, status, body)
}

// The removed identifiers stay out of the server's code: a grep guard
// next to the behaviour tests above.
func TestLegacyCompatCodeStaysGone(t *testing.T) {
	banned := []string{"StreamLegacy", "LegacyGet(", "LegacyList(", "ApplyLegacy(", "legacyView", "mergeLegacyList", "legacyPut(",
		"legacyRows", "LegacyPluginRow", "sentencePlugins", "warnEntryIDUsers", "dataPlugin(",
		// #199: the code plugins, their registry, states and data store
		"plugin_data", "PluginData", "/api/plugins", "plugin_states", "plugin_registry", "PluginState", "PluginInfo",
		"isHiddenBuiltin", "RegisterBuiltin", "internal/plugins\"",
		// #277: grammar lesson progress is events; its table and routes are gone
		"grammar_progress", "/api/grammar/progress", "ListProgress(", "RecordRun("}
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
			// the frozen migration steps (038, 045, 056) still read the old tables
			if (s == "plugin_data" || s == "plugin_states" || s == "plugin_registry" || s == "grammar_progress") && strings.Contains(filepath.ToSlash(path), "internal/db/") {
				continue
			}
			if strings.Contains(string(b), s) {
				t.Errorf("%s contains %q (removed in #198 or #199)", path, s)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

// #277: the grammar progress routes are gone; a finished run is a `grammar`
// event of the events routes.
func TestGrammarProgressRoutesAreGone(t *testing.T) {
	ts, _ := newServer(t)
	alice := registerUser(t, ts.URL, "alice", "")
	ws := createWorkspace(t, ts.URL, alice, "zh", "")
	for _, m := range []string{http.MethodGet, http.MethodPost} {
		r := doJSON(t, m, ts.URL, "/api/grammar/progress?workspace="+itoa(ws), alice, map[string]any{"packId": "p", "lessonId": "l", "score": 1, "total": 1})
		r.Body.Close()
		if r.StatusCode != http.StatusNotFound {
			t.Errorf("%s /api/grammar/progress = %d, want 404", m, r.StatusCode)
		}
	}
}
