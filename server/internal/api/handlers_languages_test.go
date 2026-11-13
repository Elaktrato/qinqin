package api_test

import (
	"database/sql"
	"net/http"
	"reflect"
	"sync"
	"testing"
)

// languageBody mirrors one element of GET /api/languages.
type languageBody struct {
	Code      string `json:"code"`
	Name      string `json:"name"`
	Installed bool   `json:"installed"`
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
	ts, sqlDB := newServer(t)

	// No dictionaries: no installed language, an empty array.
	resp := doJSON(t, http.MethodGet, ts.URL, "/api/languages", "", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /api/languages: status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	var empty []languageBody
	decodeJSON(t, resp, &empty)
	if empty == nil || len(empty) != 0 {
		t.Errorf("languages on an empty database = %#v, want []", empty)
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
		{Code: "es", Name: "Spanish", Installed: true},
		{Code: "ja", Name: "ja", Installed: true},
		{Code: "zh", Name: "zh", Installed: true},
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
	if !reflect.DeepEqual(got, []string{"es", "ja", "zh"}) {
		t.Errorf("workspaces after concurrent first GETs = %v, want one each of [es ja zh]", got)
	}
}

func TestNoDefaultsWithoutInstalledLanguages(t *testing.T) {
	ts, _ := newServer(t)
	alice := registerUser(t, ts.URL, "alice", "")
	if ws := listWorkspaces(t, ts.URL, alice); len(ws) != 0 {
		t.Errorf("workspaces without installed languages = %+v, want none", ws)
	}
}
