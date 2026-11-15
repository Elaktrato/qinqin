package api_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"testing"

	"qinqin/internal/lang"
)

// workspaceBody mirrors the JSON body of the /api/workspaces routes.
type workspaceBody struct {
	ID        int64           `json:"id"`
	Language  string          `json:"language"`
	Name      string          `json:"name"`
	Settings  json.RawMessage `json:"settings"`
	UpdatedAt string          `json:"updatedAt"`
}

// registerUser creates a user through the API — without a token for the
// first user (the instance admin), with an admin token afterwards — and
// returns the new user's bearer token.
func registerUser(t *testing.T, tsURL, username, adminToken string) string {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"username": username, "password": "pw-" + username})
	req, err := http.NewRequest(http.MethodPost, tsURL+"/api/auth/register", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("build register request: %v", err)
	}
	if adminToken != "" {
		req.Header.Set("Authorization", "Bearer "+adminToken)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("register %s: %v", username, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("register %s: status = %d, want %d", username, resp.StatusCode, http.StatusCreated)
	}
	return login(t, tsURL, username)
}

// login returns a fresh bearer token for username.
func login(t *testing.T, tsURL, username string) string {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"username": username, "password": "pw-" + username})
	resp, err := http.Post(tsURL+"/api/auth/login", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("login %s: %v", username, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("login %s: status = %d, want %d", username, resp.StatusCode, http.StatusOK)
	}
	var out struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("decode login response: %v", err)
	}
	return out.Token
}

// doJSON performs a JSON request with the given bearer token ("" for
// none) and returns the undecoded response.
func doJSON(t *testing.T, method, tsURL, path, token string, body any) *http.Response {
	t.Helper()
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal request body: %v", err)
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, tsURL+path, rdr)
	if err != nil {
		t.Fatalf("build %s %s: %v", method, path, err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}

// decodeJSON decodes resp into v, failing the test on error.
func decodeJSON(t *testing.T, resp *http.Response, v any) {
	t.Helper()
	if err := json.NewDecoder(resp.Body).Decode(v); err != nil {
		t.Fatalf("decode response: %v", err)
	}
}

func TestWorkspaceCrud(t *testing.T) {
	// zh registers as a code pack, exactly as main.go does for the server.
	lang.Register(lang.Zh{})

	ts, sqlDB := newServer(t)
	alice := registerUser(t, ts.URL, "alice", "")

	// Creating a workspace for a code-pack language needs no language row.
	zh := doJSON(t, http.MethodPost, ts.URL, "/api/workspaces", alice, map[string]string{"language": "zh"})
	if zh.StatusCode != http.StatusCreated {
		t.Fatalf("POST zh workspace: status = %d, want %d", zh.StatusCode, http.StatusCreated)
	}
	var zhWS workspaceBody
	decodeJSON(t, zh, &zhWS)
	if zhWS.ID == 0 || zhWS.Language != "zh" || string(zhWS.Settings) != "{}" {
		t.Errorf("created workspace = %+v, want zh with empty settings", zhWS)
	}
	if zhWS.UpdatedAt == "" {
		t.Error("created workspace has no updatedAt")
	}

	// One workspace per (user, language, name): the unnamed zh repeats.
	again := doJSON(t, http.MethodPost, ts.URL, "/api/workspaces", alice, map[string]string{"language": "zh"})
	if again.StatusCode != http.StatusConflict {
		t.Errorf("POST duplicate zh workspace: status = %d, want %d", again.StatusCode, http.StatusConflict)
	}

	// Unknown codes auto-register as data-only languages.
	es := doJSON(t, http.MethodPost, ts.URL, "/api/workspaces", alice, map[string]string{"language": "es"})
	if es.StatusCode != http.StatusCreated {
		t.Fatalf("POST es workspace: status = %d, want %d", es.StatusCode, http.StatusCreated)
	}
	var esWS workspaceBody
	decodeJSON(t, es, &esWS)
	if esWS.Language != "es" {
		t.Errorf("created workspace = %+v, want es", esWS)
	}
	var name string
	if err := sqlDB.QueryRow(`SELECT name FROM languages WHERE code = 'es'`).Scan(&name); err != nil {
		t.Fatalf("es language row: %v (want auto-registered)", err)
	}
	if name != "es" {
		t.Errorf("es language name = %q, want %q", name, "es")
	}
	var zhRows int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM languages WHERE code = 'zh'`).Scan(&zhRows); err != nil {
		t.Fatalf("zh language rows: %v (want none — zh is a code pack)", err)
	}
	if zhRows != 0 {
		t.Errorf("zh language rows = %d, want 0 (zh is a code pack, not data-only)", zhRows)
	}

	// A language is required.
	if resp := doJSON(t, http.MethodPost, ts.URL, "/api/workspaces", alice, map[string]string{"language": ""}); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("POST empty language: status = %d, want %d", resp.StatusCode, http.StatusBadRequest)
	}
	if resp := doJSON(t, http.MethodPost, ts.URL, "/api/workspaces", alice, "not-an-object"); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("POST malformed body: status = %d, want %d", resp.StatusCode, http.StatusBadRequest)
	}

	// The caller's workspaces list, in creation order.
	list := doJSON(t, http.MethodGet, ts.URL, "/api/workspaces", alice, nil)
	if list.StatusCode != http.StatusOK {
		t.Fatalf("GET workspaces: status = %d, want %d", list.StatusCode, http.StatusOK)
	}
	var ws []workspaceBody
	decodeJSON(t, list, &ws)
	if len(ws) != 2 || ws[0].ID != zhWS.ID || ws[1].ID != esWS.ID {
		t.Errorf("GET workspaces = %+v, want zh then es", ws)
	}

	// Settings updates merge into the stored object.
	put := doJSON(t, http.MethodPut, ts.URL, "/api/workspaces/"+strconv.FormatInt(zhWS.ID, 10), alice,
		map[string]any{"settings": map[string]string{"theme": "dark"}})
	if put.StatusCode != http.StatusOK {
		t.Fatalf("PUT settings: status = %d, want %d", put.StatusCode, http.StatusOK)
	}
	var updated workspaceBody
	decodeJSON(t, put, &updated)
	if got := parseSettings(t, updated.Settings); got["theme"] != "dark" {
		t.Errorf("settings after first PUT = %v, want theme dark", got)
	}

	// A second PUT merges: existing keys update, new keys are added.
	put = doJSON(t, http.MethodPut, ts.URL, "/api/workspaces/"+strconv.FormatInt(zhWS.ID, 10), alice,
		map[string]any{"settings": map[string]string{"theme": "light", "font": "serif"}})
	if put.StatusCode != http.StatusOK {
		t.Fatalf("PUT settings again: status = %d, want %d", put.StatusCode, http.StatusOK)
	}
	decodeJSON(t, put, &updated)
	got := parseSettings(t, updated.Settings)
	if got["theme"] != "light" || got["font"] != "serif" {
		t.Errorf("settings after merge = %v, want theme light and font serif", got)
	}
	if updated.ID != zhWS.ID || updated.Language != "zh" {
		t.Errorf("updated workspace = %+v, want the same zh workspace", updated)
	}

	// The body is an object of name and/or settings; settings must be a
	// JSON object; unknown and malformed ids are 404.
	zhPath := "/api/workspaces/" + strconv.FormatInt(zhWS.ID, 10)
	for _, bad := range []any{
		[]string{"no"},
		map[string]any{"settings": []string{"no"}},
		map[string]any{"settings": "dark"},
		map[string]any{"name": 5},
		map[string]any{},
		map[string]any{"theme": "dark"}, // a bare settings object is not the body
	} {
		if resp := doJSON(t, http.MethodPut, ts.URL, zhPath, alice, bad); resp.StatusCode != http.StatusBadRequest {
			t.Errorf("PUT %v: status = %d, want %d", bad, resp.StatusCode, http.StatusBadRequest)
		}
	}
	if resp := doJSON(t, http.MethodPut, ts.URL, "/api/workspaces/999999", alice, map[string]any{"name": "x"}); resp.StatusCode != http.StatusNotFound {
		t.Errorf("PUT unknown workspace: status = %d, want %d", resp.StatusCode, http.StatusNotFound)
	}
	if resp := doJSON(t, http.MethodPut, ts.URL, "/api/workspaces/NaN", alice, map[string]any{"name": "x"}); resp.StatusCode != http.StatusNotFound {
		t.Errorf("PUT malformed id: status = %d, want %d", resp.StatusCode, http.StatusNotFound)
	}

	// Other users' workspaces are invisible.
	bob := registerUser(t, ts.URL, "bob", alice)
	if resp := doJSON(t, http.MethodPut, ts.URL, "/api/workspaces/"+strconv.FormatInt(zhWS.ID, 10), bob, map[string]any{"name": "x"}); resp.StatusCode != http.StatusNotFound {
		t.Errorf("PUT another user's workspace: status = %d, want %d", resp.StatusCode, http.StatusNotFound)
	}
	bobList := doJSON(t, http.MethodGet, ts.URL, "/api/workspaces", bob, nil)
	if bobList.StatusCode != http.StatusOK {
		t.Fatalf("GET bob's workspaces: status = %d, want %d", bobList.StatusCode, http.StatusOK)
	}
	var bobWS []workspaceBody
	decodeJSON(t, bobList, &bobWS)
	if len(bobWS) != 0 {
		t.Errorf("bob's workspaces = %+v, want empty", bobWS)
	}

	// Another user may open their own workspace for the same language; a
	// repeated code does not double-register the language row.
	if resp := doJSON(t, http.MethodPost, ts.URL, "/api/workspaces", bob, map[string]string{"language": "ES"}); resp.StatusCode != http.StatusCreated {
		t.Errorf("POST bob's ES workspace: status = %d, want %d", resp.StatusCode, http.StatusCreated)
	}
	var count int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM languages WHERE code = 'es'`).Scan(&count); err != nil {
		t.Fatalf("count es language rows: %v", err)
	}
	if count != 1 {
		t.Errorf("es language rows = %d, want 1", count)
	}

	// All workspace routes require authentication.
	for _, tc := range []struct {
		method, path string
	}{
		{http.MethodGet, "/api/workspaces"},
		{http.MethodPost, "/api/workspaces"},
		{http.MethodPut, "/api/workspaces/1"},
	} {
		if resp := doJSON(t, tc.method, ts.URL, tc.path, "", nil); resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("%s %s without token: status = %d, want %d", tc.method, tc.path, resp.StatusCode, http.StatusUnauthorized)
		}
	}
}

func TestWorkspaceNames(t *testing.T) {
	lang.Register(lang.Zh{})
	ts, _ := newServer(t)
	alice := registerUser(t, ts.URL, "alice", "")

	create := func(body map[string]string) (int, workspaceBody) {
		t.Helper()
		resp := doJSON(t, http.MethodPost, ts.URL, "/api/workspaces", alice, body)
		var ws workspaceBody
		if resp.StatusCode == http.StatusCreated {
			decodeJSON(t, resp, &ws)
		}
		return resp.StatusCode, ws
	}

	// Two zh workspaces with different names; the name is trimmed.
	status, plain := create(map[string]string{"language": "zh"})
	if status != http.StatusCreated || plain.Name != "" {
		t.Fatalf("POST unnamed zh: status = %d, ws = %+v", status, plain)
	}
	status, graded := create(map[string]string{"language": "zh", "name": "  Graded readers \t"})
	if status != http.StatusCreated || graded.Name != "Graded readers" || graded.Language != "zh" {
		t.Fatalf("POST named zh: status = %d, ws = %+v, want name trimmed", status, graded)
	}

	// The same (language, name) again is a conflict; a whitespace-only
	// name is the unnamed workspace.
	if status, _ := create(map[string]string{"language": "zh", "name": "Graded readers"}); status != http.StatusConflict {
		t.Errorf("POST duplicate named zh: status = %d, want %d", status, http.StatusConflict)
	}
	if status, _ := create(map[string]string{"language": "zh", "name": "   "}); status != http.StatusConflict {
		t.Errorf("POST blank-named zh: status = %d, want %d", status, http.StatusConflict)
	}

	// Names hold at most 40 characters (code points, not bytes).
	if status, ws := create(map[string]string{"language": "zh", "name": strings.Repeat("字", 40)}); status != http.StatusCreated || ws.Name != strings.Repeat("字", 40) {
		t.Errorf("POST 40-character name: status = %d, ws = %+v, want created", status, ws)
	}
	if status, _ := create(map[string]string{"language": "zh", "name": strings.Repeat("a", 41)}); status != http.StatusUnprocessableEntity {
		t.Errorf("POST 41-character name: status = %d, want %d", status, http.StatusUnprocessableEntity)
	}

	// Rename: trimmed, length-checked, unique per language; settings
	// merge alongside.
	path := "/api/workspaces/" + strconv.FormatInt(plain.ID, 10)
	resp := doJSON(t, http.MethodPut, ts.URL, path, alice, map[string]any{"name": " HSK ", "settings": map[string]string{"theme": "dark"}})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("PUT rename: status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	var renamed workspaceBody
	decodeJSON(t, resp, &renamed)
	if renamed.ID != plain.ID || renamed.Name != "HSK" || parseSettings(t, renamed.Settings)["theme"] != "dark" {
		t.Errorf("renamed workspace = %+v, want HSK with theme dark", renamed)
	}
	// A settings-only PUT keeps the name; a name-only PUT keeps settings.
	resp = doJSON(t, http.MethodPut, ts.URL, path, alice, map[string]any{"settings": map[string]string{"font": "serif"}})
	decodeJSON(t, resp, &renamed)
	if renamed.Name != "HSK" {
		t.Errorf("settings-only PUT name = %q, want HSK", renamed.Name)
	}
	resp = doJSON(t, http.MethodPut, ts.URL, path, alice, map[string]any{"name": "HSK 1"})
	decodeJSON(t, resp, &renamed)
	if got := parseSettings(t, renamed.Settings); renamed.Name != "HSK 1" || got["theme"] != "dark" || got["font"] != "serif" {
		t.Errorf("name-only PUT = %+v, want HSK 1 keeping settings", renamed)
	}
	if resp := doJSON(t, http.MethodPut, ts.URL, path, alice, map[string]any{"name": "Graded readers"}); resp.StatusCode != http.StatusConflict {
		t.Errorf("PUT rename onto an existing name: status = %d, want %d", resp.StatusCode, http.StatusConflict)
	}
	// Renaming to the current name is not a conflict with itself.
	resp = doJSON(t, http.MethodPut, ts.URL, path, alice, map[string]any{"name": "HSK 1"})
	if resp.StatusCode != http.StatusOK {
		t.Errorf("PUT rename to the current name: status = %d, want %d", resp.StatusCode, http.StatusOK)
	} else if decodeJSON(t, resp, &renamed); renamed.Name != "HSK 1" {
		t.Errorf("PUT rename to the current name = %+v", renamed)
	}
	if resp := doJSON(t, http.MethodPut, ts.URL, path, alice, map[string]any{"name": strings.Repeat("a", 41)}); resp.StatusCode != http.StatusUnprocessableEntity {
		t.Errorf("PUT 41-character name: status = %d, want %d", resp.StatusCode, http.StatusUnprocessableEntity)
	}
	// Back to unnamed works now that no other zh is unnamed.
	resp = doJSON(t, http.MethodPut, ts.URL, path, alice, map[string]any{"name": ""})
	decodeJSON(t, resp, &renamed)
	if resp.StatusCode != http.StatusOK || renamed.Name != "" {
		t.Errorf("PUT clear name: status = %d, ws = %+v", resp.StatusCode, renamed)
	}

	// Names with control or format characters are refused on create and
	// rename: bidi controls, ZWSP, word joiner, BOM, soft hyphen; ZWNJ,
	// ZWJ and tag characters are allowed (see below). Surrounding
	// whitespace is trimmed.
	r := func(cs ...rune) string { return string(cs) }
	for _, bad := range []string{
		"a\x00b", "a\nb", "a\tb", "a\x7fb", "a\u0085b", // Cc
		r('a', 0x200b, 'b'), r('a', 0x2060, 'b'), r(0xfeff, 'a'), r('a', 0xad, 'b'), // ZWSP, WJ, BOM, SHY
		r('a', 0x200e, 'b'), r('a', 0x200f, 'b'), r('a', 0x061c, 'b'), // LRM, RLM, ALM
		r('a', 0x202a, 'b'), r('a', 0x202e, 'b'), r('a', 0x2066, 'b'), r('a', 0x2069, 'b'), // embeddings, overrides, isolates
		r('a', 0xe0001, 'b'), // LANGUAGE TAG, outside the allowed tag range
	} {
		if status, _ := create(map[string]string{"language": "zh", "name": bad}); status != http.StatusUnprocessableEntity {
			t.Errorf("POST name %q: status = %d, want %d", bad, status, http.StatusUnprocessableEntity)
		}
		if resp := doJSON(t, http.MethodPut, ts.URL, path, alice, map[string]any{"name": bad}); resp.StatusCode != http.StatusUnprocessableEntity {
			t.Errorf("PUT name %q: status = %d, want %d", bad, resp.StatusCode, http.StatusUnprocessableEntity)
		}
	}
	if status, ws := create(map[string]string{"language": "zh", "name": "\n Novels \t"}); status != http.StatusCreated || ws.Name != "Novels" {
		t.Errorf("POST name with surrounding whitespace: status = %d, ws = %+v", status, ws)
	}
	// ZWJ emoji, ZWNJ in words and tag-sequence subdivision flags.
	for _, good := range []string{
		r(0x1f469, 0x200d, 0x1f4bb),                                      // 👩‍💻
		r('m', 0x06cc, 0x200c, 'x'),                                      // ZWNJ
		r(0x1f3f4, 0xe0067, 0xe0062, 0xe0073, 0xe0063, 0xe0074, 0xe007f), // Scotland flag
	} {
		if status, ws := create(map[string]string{"language": "zh", "name": good}); status != http.StatusCreated || ws.Name != good {
			t.Errorf("POST name %q: status = %d, ws = %+v, want created", good, status, ws)
		}
	}
	if resp := doJSON(t, http.MethodPut, ts.URL, path, alice, map[string]any{"name": "dev " + r(0x1f469, 0x200d, 0x1f4bb)}); resp.StatusCode != http.StatusOK {
		t.Errorf("PUT ZWJ emoji name: status = %d, want 200", resp.StatusCode)
	}

	// The list carries the names.
	list := doJSON(t, http.MethodGet, ts.URL, "/api/workspaces", alice, nil)
	var all []workspaceBody
	decodeJSON(t, list, &all)
	if len(all) != 7 || all[1].Name != "Graded readers" || all[3].Name != "Novels" {
		t.Errorf("GET workspaces = %+v, want 7 with names", all)
	}
}

// parseSettings decodes a workspace settings blob into a string map.
func parseSettings(t *testing.T, raw json.RawMessage) map[string]string {
	t.Helper()
	var m map[string]string
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("parse settings %s: %v", raw, err)
	}
	return m
}

// TestWorkspaceSettingsNullDeletesKey pins the merge semantics of the
// settings PUT: RFC 7396 JSON Merge Patch, so a null value removes that key
// and an absent key is kept.
func TestWorkspaceSettingsNullDeletesKey(t *testing.T) {
	lang.Register(lang.Zh{})
	ts, _ := newServer(t)
	alice := registerUser(t, ts.URL, "alice", "")
	var ws workspaceBody
	decodeJSON(t, doJSON(t, http.MethodPost, ts.URL, "/api/workspaces", alice, map[string]string{"language": "zh"}), &ws)
	path := "/api/workspaces/" + strconv.FormatInt(ws.ID, 10)

	doJSON(t, http.MethodPut, ts.URL, path, alice, map[string]any{"settings": map[string]string{"theme": "dark", "font": "serif"}})
	resp := doJSON(t, http.MethodPut, ts.URL, path, alice, map[string]any{"settings": map[string]any{"theme": nil}})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("PUT null: status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	var updated workspaceBody
	decodeJSON(t, resp, &updated)
	got := parseSettings(t, updated.Settings)
	if _, has := got["theme"]; has || got["font"] != "serif" {
		t.Errorf("settings after null = %v, want theme removed and font kept", got)

func TestWorkspaceLanguageCodes(t *testing.T) {
	lang.Register(lang.Zh{})
	ts, sqlDB := newServer(t)
	admin := registerUser(t, ts.URL, "admin", "")
	user := registerUser(t, ts.URL, "learner", admin)
	create := func(token, code string) (int, string) {
		resp := doJSON(t, http.MethodPost, ts.URL, "/api/workspaces", token, map[string]string{"language": code})
		b, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return resp.StatusCode, strings.TrimSpace(string(b))
	}
	if st, _ := create(admin, "pt"); st != http.StatusCreated {
		t.Fatalf("admin pt = %d, want 201", st)
	}
	var n int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM languages WHERE code = 'pt'`).Scan(&n); err != nil || n != 1 {
		t.Errorf("languages row for pt: n=%d err=%v, want 1", n, err)
	}
	if st, msg := create(user, "de"); st != http.StatusUnprocessableEntity || msg != "unknown language — ask the administrator to add it" {
		t.Errorf("learner unknown = %d %q", st, msg)
	}
	if st, msg := create(user, "Hello!"); st != http.StatusUnprocessableEntity || msg != "language must be a code like es or pt-br" {
		t.Errorf("learner invalid = %d %q", st, msg)
	}
	if st, msg := create(admin, "Hello!"); st != http.StatusUnprocessableEntity || msg != "language must be a code like es or pt-br" {
		t.Errorf("admin invalid = %d %q", st, msg)
	}
	if st, _ := create(user, "pt"); st != http.StatusCreated {
		t.Errorf("learner known pt = %d, want 201", st)
	}
	if st, _ := create(user, "zh"); st != http.StatusCreated {
		t.Errorf("learner code pack zh = %d, want 201", st)
	}
}

// A legacy code stored with an underscore (or any odd shape) stays usable
// by its exact spelling: it must not be split into pt-br.
func TestWorkspaceLegacyStoredCodes(t *testing.T) {
	ts, sqlDB := newServer(t)
	admin := registerUser(t, ts.URL, "admin", "")
	bob := registerUser(t, ts.URL, "bob", admin)
	mustExec(t, sqlDB,
		`INSERT INTO languages (code, name, updated_at) VALUES ('pt_br', 'pt_br', 't'), ('klingon', 'k', 't')`,
		`INSERT INTO dictionaries (id, pack_id, name, version, license, attribution, language, updated_at) VALUES (904, 'pt-demo', 'pt', '1', 'l', 'a', 'pt_br', 't')`,
		`INSERT INTO entries (id, language, kind, ext_key, updated_at) VALUES (9004, 'pt_br', 'word', 'ola', 't')`,
		`INSERT INTO senses (entry_id, dictionary_id, ord, updated_at) VALUES (9004, 904, 0, 't')`)
	for _, tok := range []string{bob, admin} {
		for _, code := range []string{"pt_br", "PT_BR", "klingon"} {
			resp := doJSON(t, http.MethodPost, ts.URL, "/api/workspaces", tok, map[string]string{"language": code, "name": "n" + code})
			var ws workspaceBody
			if resp.StatusCode != http.StatusCreated {
				t.Fatalf("POST %q = %d, want 201", code, resp.StatusCode)
			}
			decodeJSON(t, resp, &ws)
			if want := strings.ToLower(code); ws.Language != want {
				t.Errorf("POST %q stored %q, want %q", code, ws.Language, want)
			}
		}
	}
	var n int
	_ = sqlDB.QueryRow(`SELECT COUNT(*) FROM languages WHERE code = 'pt-br'`).Scan(&n)
	if n != 0 {
		t.Errorf("pt-br row created = %d, want 0 (no split)", n)
	}
}

// A language known only through a live pack (a level list, no dictionary
// and no languages row) counts as known; dead packs do not.
func TestWorkspaceKnownThroughLivePacks(t *testing.T) {
	ts, sqlDB := newServer(t)
	admin := registerUser(t, ts.URL, "admin", "")
	bob := registerUser(t, ts.URL, "bob", admin)
	mustExec(t, sqlDB,
		`INSERT INTO schemes (id, pack_id, name, unit, version, language, license, attribution, updated_at) VALUES (1, 's', 'n', 'word', '1', 'ko', 'l', 'a', 't')`,
		`INSERT INTO schemes (id, pack_id, name, unit, version, language, license, attribution, updated_at, deleted_at) VALUES (2, 'd', 'n', 'word', '1', 'fr', 'l', 'a', 't', 't')`)
	if resp := doJSON(t, http.MethodPost, ts.URL, "/api/workspaces", bob, map[string]string{"language": "ko"}); resp.StatusCode != http.StatusCreated {
		t.Errorf("ko via live scheme = %d, want 201", resp.StatusCode)
	}
	if resp := doJSON(t, http.MethodPost, ts.URL, "/api/workspaces", bob, map[string]string{"language": "fr"}); resp.StatusCode != http.StatusUnprocessableEntity {
		t.Errorf("fr via dead scheme = %d, want 422", resp.StatusCode)
	}
}
