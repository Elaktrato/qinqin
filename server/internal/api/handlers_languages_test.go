package api_test

import (
	"database/sql"
	"net/http"
	"reflect"
	"sync"
	"testing"

	"qinqin/internal/lang"
)

// languageBody mirrors one element of GET /api/languages.
type languageBody struct {
	Code      string `json:"code"`
	Name      string `json:"name"`
	Installed bool   `json:"installed"`
	Kind      string `json:"kind"`
}

// seedDeadLanguage adds a data-only language (ko) whose only dictionary
// is soft-deleted, and one (fr) whose only sense is soft-deleted, so
// neither counts as installed.
func seedDeadLanguage(t *testing.T, sqlDB *sql.DB) {
	t.Helper()
	for _, stmt := range []string{
		`INSERT INTO languages (code, name, updated_at) VALUES ('ko', 'Korean', 't'), ('fr', 'French', 't')`,
		`INSERT INTO dictionaries (id, pack_id, name, version, license, attribution, updated_at, deleted_at)
			VALUES (901, 'ko-dead', 'ko', '1', 'l', 'a', 't', 't')`,
		`INSERT INTO dictionaries (id, pack_id, name, version, license, attribution, updated_at)
			VALUES (902, 'fr-live', 'fr', '1', 'l', 'a', 't')`,
		`INSERT INTO entries (id, language, kind, ext_key, updated_at) VALUES (9001, 'ko', 'word', 'k', 't'), (9002, 'fr', 'word', 'f', 't')`,
		`INSERT INTO senses (entry_id, dictionary_id, ord, updated_at) VALUES (9001, 901, 0, 't')`,
		`INSERT INTO senses (entry_id, dictionary_id, ord, updated_at, deleted_at) VALUES (9002, 902, 0, 't', 't')`,
	} {
		if _, err := sqlDB.Exec(stmt); err != nil {
			t.Fatalf("%s: %v", stmt, err)
		}
	}
}

// seedSpanish adds a live data-only es dictionary with one sense; its
// name comes from the languages row.
func seedSpanish(t *testing.T, sqlDB *sql.DB) {
	t.Helper()
	for _, stmt := range []string{
		`INSERT INTO languages (code, name, updated_at) VALUES ('es', 'Spanish', 't')`,
		`INSERT INTO dictionaries (id, pack_id, name, version, license, attribution, updated_at)
			VALUES (903, 'es-demo', 'es', '1', 'l', 'a', 't')`,
		`INSERT INTO entries (id, language, kind, ext_key, updated_at) VALUES (9003, 'es', 'word', 'hola', 't')`,
		`INSERT INTO senses (entry_id, dictionary_id, ord, updated_at) VALUES (9003, 903, 0, 't')`,
	} {
		if _, err := sqlDB.Exec(stmt); err != nil {
			t.Fatalf("%s: %v", stmt, err)
		}
	}
}

func TestListLanguages(t *testing.T) {
	lang.Register(lang.Ja{})
	lang.Register(lang.Zh{})
	ts, sqlDB := newServer(t)

	// No dictionaries: only the code packs, not installed.
	resp := doJSON(t, http.MethodGet, ts.URL, "/api/languages", "", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /api/languages: status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	var empty []languageBody
	decodeJSON(t, resp, &empty)
	wantEmpty := []languageBody{
		{Code: "ja", Name: "ja", Kind: "code"},
		{Code: "zh", Name: "zh", Kind: "code"},
	}
	if !reflect.DeepEqual(empty, wantEmpty) {
		t.Errorf("languages on an empty database = %#v, want %#v", empty, wantEmpty)
	}

	seedEntries(t, sqlDB)
	seedSpanish(t, sqlDB)
	seedDeadLanguage(t, sqlDB)

	resp = doJSON(t, http.MethodGet, ts.URL, "/api/languages", "", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /api/languages: status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	var got []languageBody
	decodeJSON(t, resp, &got)
	want := []languageBody{
		{Code: "es", Name: "Spanish", Installed: true, Kind: "data"},
		{Code: "fr", Name: "French", Kind: "data"},
		{Code: "ja", Name: "ja", Installed: true, Kind: "code"},
		{Code: "ko", Name: "Korean", Kind: "data"},
		{Code: "zh", Name: "zh", Installed: true, Kind: "code"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("languages = %+v, want %+v", got, want)
	}
}

// workspaceLanguages returns the languages of a workspace list, in order.
func workspaceLanguages(ws []workspaceBody) []string {
	out := make([]string, 0, len(ws))
	for _, w := range ws {
		out = append(out, w.Language)
	}
	return out
}

// listWorkspaces fetches the caller's workspaces.
func listWorkspaces(t *testing.T, tsURL, token string) []workspaceBody {
	t.Helper()
	resp := doJSON(t, http.MethodGet, tsURL, "/api/workspaces", token, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /api/workspaces: status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	var ws []workspaceBody
	decodeJSON(t, resp, &ws)
	return ws
}

// TestDefaultWorkspacesCodePacksFirst pins the order of a new user's
// defaults: the code-pack languages (ja, zh) get the lowest ids, in code
// order, and data-only languages (the es demo) come after, even though
// "es" sorts first. The web app selects the first workspace.
func TestDefaultWorkspacesCodePacksFirst(t *testing.T) {
	ts, sqlDB := newServer(t)
	seedEntries(t, sqlDB) // registers the ja and zh code packs
	seedSpanish(t, sqlDB)
	alice := registerUser(t, ts.URL, "alice", "")

	ws := listWorkspaces(t, ts.URL, alice)
	if got := workspaceLanguages(ws); !reflect.DeepEqual(got, []string{"ja", "zh", "es"}) {
		t.Fatalf("default workspaces = %v, want [ja zh es]", got)
	}
	ids := map[string]int64{}
	for _, w := range ws {
		ids[w.Language] = w.ID
	}
	if !(ids["ja"] < ids["zh"] && ids["zh"] < ids["es"]) {
		t.Errorf("default workspace ids = %v, want ja < zh < es", ids)
	}
}

func TestDefaultWorkspaces(t *testing.T) {
	ts, sqlDB := newServer(t)
	seedEntries(t, sqlDB)
	seedDeadLanguage(t, sqlDB)
	alice := registerUser(t, ts.URL, "alice", "")

	// A user with no workspace gets one per installed language, unnamed,
	// with empty settings.
	first := listWorkspaces(t, ts.URL, alice)
	if got := workspaceLanguages(first); !reflect.DeepEqual(got, []string{"ja", "zh"}) {
		t.Fatalf("first GET languages = %v, want [ja zh]", got)
	}
	for _, w := range first {
		if w.Name != "" || string(w.Settings) != "{}" || w.ID == 0 {
			t.Errorf("default workspace = %+v, want unnamed with empty settings", w)
		}
	}

	// A second GET adds nothing.
	second := listWorkspaces(t, ts.URL, alice)
	if !reflect.DeepEqual(second, first) {
		t.Errorf("second GET = %+v, want unchanged %+v", second, first)
	}

	// A user who already has a workspace gets nothing added.
	bob := registerUser(t, ts.URL, "bob", alice)
	if resp := doJSON(t, http.MethodPost, ts.URL, "/api/workspaces", bob, map[string]string{"language": "zh", "name": "mine"}); resp.StatusCode != http.StatusCreated {
		t.Fatalf("POST bob's zh workspace: status = %d", resp.StatusCode)
	}
	bobList := listWorkspaces(t, ts.URL, bob)
	if len(bobList) != 1 || bobList[0].Name != "mine" {
		t.Errorf("bob's workspaces = %+v, want only his named zh", bobList)
	}

	// Alice's defaults are hers alone.
	var total int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM workspaces`).Scan(&total); err != nil {
		t.Fatal(err)
	}
	if total != 3 {
		t.Errorf("workspaces in the database = %d, want 3 (alice 2, bob 1)", total)
	}
}

func TestDefaultWorkspacesConcurrentFirstGet(t *testing.T) {
	ts, sqlDB := newServer(t)
	seedEntries(t, sqlDB)
	seedSpanish(t, sqlDB)
	alice := registerUser(t, ts.URL, "alice", "")

	const n = 8
	var wg sync.WaitGroup
	statuses := make([]int, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			req, err := http.NewRequest(http.MethodGet, ts.URL+"/api/workspaces", nil)
			if err != nil {
				t.Error(err)
				return
			}
			req.Header.Set("Authorization", "Bearer "+alice)
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Error(err)
				return
			}
			resp.Body.Close()
			statuses[i] = resp.StatusCode
		}(i)
	}
	wg.Wait()
	for i, s := range statuses {
		if s != http.StatusOK {
			t.Errorf("concurrent GET %d: status = %d, want %d", i, s, http.StatusOK)
		}
	}
	got := workspaceLanguages(listWorkspaces(t, ts.URL, alice))
	if !reflect.DeepEqual(got, []string{"ja", "zh", "es"}) {
		t.Errorf("workspaces after concurrent first GETs = %v, want one each of [ja zh es]", got)
	}
}

func TestNoDefaultsWithoutInstalledLanguages(t *testing.T) {
	ts, _ := newServer(t)
	alice := registerUser(t, ts.URL, "alice", "")
	if ws := listWorkspaces(t, ts.URL, alice); len(ws) != 0 {
		t.Errorf("workspaces without installed languages = %+v, want none", ws)
	}
}

func TestListLanguagesBareRowAndUninstall(t *testing.T) {
	lang.Register(lang.Ja{})
	lang.Register(lang.Zh{})
	ts, sqlDB := newServer(t)
	if _, err := sqlDB.Exec(`INSERT INTO languages (code, name, updated_at) VALUES ('pt', 'pt', 't')`); err != nil {
		t.Fatal(err)
	}
	find := func(code string) (languageBody, bool) {
		resp := doJSON(t, http.MethodGet, ts.URL, "/api/languages", "", nil)
		var got []languageBody
		decodeJSON(t, resp, &got)
		for _, l := range got {
			if l.Code == code {
				return l, true
			}
		}
		return languageBody{}, false
	}
	if l, ok := find("pt"); !ok || l.Installed || l.Kind != "data" {
		t.Errorf("bare pt = %+v (%v), want data, not installed", l, ok)
	}
	seedSpanish(t, sqlDB)
	if l, ok := find("es"); !ok || !l.Installed || l.Kind != "data" {
		t.Errorf("es = %+v (%v), want data, installed", l, ok)
	}
	if _, err := sqlDB.Exec(`UPDATE dictionaries SET deleted_at = 't' WHERE id = 903`); err != nil {
		t.Fatal(err)
	}
	if l, ok := find("es"); !ok || l.Installed {
		t.Errorf("es after uninstall = %+v (%v), want listed, not installed", l, ok)
	}
}
