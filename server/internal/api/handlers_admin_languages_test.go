package api_test

import (
	"database/sql"
	"encoding/json"
	"io"
	"maps"
	"net/http"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"testing"

	"qinqin/internal/lang"
)

type usageBody struct {
	Code       string `json:"code"`
	Workspaces int    `json:"workspaces"`
}

func adminLang(t *testing.T, method, tsURL, path, token string, body any) (int, string) {
	t.Helper()
	resp := doJSON(t, method, tsURL, path, token, body)
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, errorText(b)
}

func mustExec(t *testing.T, sqlDB *sql.DB, stmts ...string) {
	t.Helper()
	for _, s := range stmts {
		if _, err := sqlDB.Exec(s); err != nil {
			t.Fatalf("%s: %v", s, err)
		}
	}
}

func TestAdminLanguageRoutes(t *testing.T) {
	lang.Register(lang.Zh{})
	ts, _ := newServer(t)
	admin := registerUser(t, ts.URL, "admin", "")
	bob := registerUser(t, ts.URL, "bob", admin)

	for _, c := range []struct{ method, path string }{
		{http.MethodPost, "/api/admin/languages"},
		{http.MethodDelete, "/api/admin/languages/es"},
		{http.MethodGet, "/api/admin/languages/usage"},
	} {
		if st, _ := adminLang(t, c.method, ts.URL, c.path, bob, map[string]string{"code": "es"}); st != http.StatusForbidden {
			t.Errorf("%s %s as non-admin = %d, want 403", c.method, c.path, st)
		}
	}

	resp := doJSON(t, http.MethodPost, ts.URL, "/api/admin/languages", admin, map[string]string{"code": "PT_br"})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("POST PT_br = %d, want 201", resp.StatusCode)
	}
	var li languageBody
	decodeJSON(t, resp, &li)
	if li.Code != "pt-br" || li.Kind != "data" || li.Installed {
		t.Errorf("registered = %+v, want pt-br data not installed", li)
	}
	if st, _ := adminLang(t, http.MethodPost, ts.URL, "/api/admin/languages", admin, map[string]string{"code": "pt-br"}); st != http.StatusOK {
		t.Errorf("POST again = %d, want 200", st)
	}
	if st, msg := adminLang(t, http.MethodPost, ts.URL, "/api/admin/languages", admin, map[string]string{"code": "zh"}); st != http.StatusConflict || msg != "language_built_in: zh is built in." {
		t.Errorf("POST zh = %d %q", st, msg)
	}
	if st, _ := adminLang(t, http.MethodPost, ts.URL, "/api/admin/languages", admin, map[string]string{"code": "x"}); st != http.StatusUnprocessableEntity {
		t.Errorf("POST x = %d, want 422", st)
	}
	if st, msg := adminLang(t, http.MethodDelete, ts.URL, "/api/admin/languages/zh", admin, nil); st != http.StatusConflict || msg != "language_built_in: zh is built in." {
		t.Errorf("DELETE zh = %d %q", st, msg)
	}
	if st, _ := adminLang(t, http.MethodDelete, ts.URL, "/api/admin/languages/nope", admin, nil); st != http.StatusNotFound {
		t.Errorf("DELETE unknown = %d, want 404", st)
	}
	if st, _ := adminLang(t, http.MethodDelete, ts.URL, "/api/admin/languages/pt-br", admin, nil); st != http.StatusNoContent {
		t.Errorf("DELETE unused = %d, want 204", st)
	}
}

func TestDeleteLanguageBlockers(t *testing.T) {
	lang.Register(lang.Zh{})
	const blocked = "language_in_use: The language is still used by:"
	cases := []struct {
		name string
		stmt []string
	}{
		{"scheme", []string{`INSERT INTO schemes (id, pack_id, name, unit, version, language, license, attribution, updated_at) VALUES (1, 's', 'n', 'word', '1', 'es', 'l', 'a', 't')`}},
		{"frequency pack", []string{`INSERT INTO frequency_packs (id, pack_id, name, version, language, license, attribution, ord, updated_at) VALUES (1, 'f', 'n', '1', 'es', 'l', 'a', 1, 't')`}},
		{"sentence pack", []string{`INSERT INTO sentence_packs (pack_id, name, version, language, license, attribution, updated_at) VALUES ('sp', 'n', '1', 'es', 'l', 'a', 't')`}},
		{"grammar pack", []string{`INSERT INTO grammar_packs (pack_id, name, version, language, license, attribution, levels_json, updated_at) VALUES ('g', 'n', '1', 'es', 'l', 'a', '[]', 't')`}},
		{"audio pack", []string{`INSERT INTO audio_packs (pack_id, language, name, version, license, attribution, created_at, updated_at) VALUES ('a', 'es', 'n', '1', 'l', 'a', 't', 't')`}},
		{"legacy sentence", []string{
			`INSERT INTO entries (id, language, kind, ext_key, updated_at) VALUES (7001, 'es', 'word', 'hola', 't')`,
			`INSERT INTO sentences (entry_id, source_pack, hanzi, pinyin, translation, updated_at) VALUES (7001, 'legacy', 'h', 'h', 'h', 't')`,
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ts, sqlDB := newServer(t)
			admin := registerUser(t, ts.URL, "admin", "")
			mustExec(t, sqlDB, `INSERT INTO languages (code, name, updated_at) VALUES ('es', 'es', 't')`)
			mustExec(t, sqlDB, c.stmt...)
			if st, msg := adminLang(t, http.MethodDelete, ts.URL, "/api/admin/languages/es", admin, nil); st != http.StatusConflict || !strings.HasPrefix(msg, blocked) {
				t.Errorf("DELETE = %d %q, want 409 %q", st, msg, blocked)
			}
		})
	}

	// #198 review: own sentences (source_pack '') are no pack.
	t.Run("own sentences do not block", func(t *testing.T) {
		ts, sqlDB := newServer(t)
		admin := registerUser(t, ts.URL, "admin", "")
		mustExec(t, sqlDB,
			`INSERT INTO languages (code, name, updated_at) VALUES ('es', 'es', 't')`,
			`INSERT INTO entries (id, language, kind, ext_key, updated_at) VALUES (7001, 'es', 'word', 'hola', 't')`,
			`INSERT INTO sentences (entry_id, source_pack, user_id, hanzi, pinyin, translation, updated_at) VALUES (7001, '', (SELECT id FROM users WHERE username = 'admin'), 'h', 'h', 'h', 't')`)
		if st, msg := adminLang(t, http.MethodDelete, ts.URL, "/api/admin/languages/es", admin, nil); st != http.StatusNoContent {
			t.Errorf("DELETE = %d %q, want 204", st, msg)
		}
	})

	// #198 review: GET /api/admin/packs no longer lists sentences without a
	// registry row, so the 409 names such a pack and its removal route.
	t.Run("an older sentence pack is named with its removal route", func(t *testing.T) {
		ts, sqlDB := newServer(t)
		admin := registerUser(t, ts.URL, "admin", "")
		mustExec(t, sqlDB,
			`INSERT INTO languages (code, name, updated_at) VALUES ('es', 'es', 't')`,
			`INSERT INTO entries (id, language, kind, ext_key, updated_at) VALUES (7001, 'es', 'word', 'hola', 't')`,
			`INSERT INTO sentences (entry_id, source_pack, hanzi, pinyin, translation, updated_at) VALUES (7001, 'es-old', 'h', 'h', 'h', 't')`)
		st, msg := adminLang(t, http.MethodDelete, ts.URL, "/api/admin/languages/es", admin, nil)
		if st != http.StatusConflict || !strings.Contains(msg, "DELETE /api/admin/sentences/es-old") {
			t.Fatalf("DELETE = %d %q, want 409 naming DELETE /api/admin/sentences/es-old", st, msg)
		}
		if r := doRaw(t, http.MethodDelete, ts.URL, "/api/admin/sentences/es-old", admin, ""); r.StatusCode != http.StatusNoContent {
			t.Fatalf("remove the older pack = %d, want 204", r.StatusCode)
		}
		if st, msg := adminLang(t, http.MethodDelete, ts.URL, "/api/admin/languages/es", admin, nil); st != http.StatusNoContent {
			t.Errorf("DELETE after the removal = %d %q, want 204", st, msg)
		}
	})

	t.Run("dead rows do not block", func(t *testing.T) {
		ts, sqlDB := newServer(t)
		admin := registerUser(t, ts.URL, "admin", "")
		mustExec(t, sqlDB,
			`INSERT INTO languages (code, name, updated_at) VALUES ('es', 'es', 't')`,
			`INSERT INTO schemes (id, pack_id, name, unit, version, language, license, attribution, updated_at, deleted_at) VALUES (1, 's', 'n', 'word', '1', 'es', 'l', 'a', 't', 't')`,
			`INSERT INTO sentence_packs (pack_id, name, version, language, license, attribution, updated_at, deleted_at) VALUES ('sp', 'n', '1', 'es', 'l', 'a', 't', 't')`)
		if st, _ := adminLang(t, http.MethodDelete, ts.URL, "/api/admin/languages/es", admin, nil); st != http.StatusNoContent {
			t.Errorf("DELETE = %d, want 204", st)
		}
	})

	t.Run("installed dictionary then uninstalled", func(t *testing.T) {
		ts, sqlDB := newServer(t)
		admin := registerUser(t, ts.URL, "admin", "")
		seedSpanish(t, sqlDB)
		if st, msg := adminLang(t, http.MethodDelete, ts.URL, "/api/admin/languages/es", admin, nil); st != http.StatusConflict || !strings.HasPrefix(msg, blocked) {
			t.Errorf("DELETE installed = %d %q, want 409", st, msg)
		}
		// Uninstall: senses soft-deleted, entries stay.
		mustExec(t, sqlDB,
			`UPDATE senses SET deleted_at = 't' WHERE dictionary_id = 903`,
			`UPDATE dictionaries SET deleted_at = 't' WHERE id = 903`)
		if st, _ := adminLang(t, http.MethodDelete, ts.URL, "/api/admin/languages/es", admin, nil); st != http.StatusNoContent {
			t.Errorf("DELETE after uninstall = %d, want 204", st)
		}
	})

	t.Run("another user's workspace", func(t *testing.T) {
		ts, sqlDB := newServer(t)
		admin := registerUser(t, ts.URL, "admin", "")
		bob := registerUser(t, ts.URL, "bob", admin)
		mustExec(t, sqlDB, `INSERT INTO languages (code, name, updated_at) VALUES ('es', 'es', 't')`)
		if st, _ := adminLang(t, http.MethodPost, ts.URL, "/api/workspaces", bob, map[string]string{"language": "es"}); st != http.StatusCreated {
			t.Fatalf("bob workspace = %d", st)
		}
		if st, msg := adminLang(t, http.MethodDelete, ts.URL, "/api/admin/languages/es", admin, nil); st != http.StatusConflict || !strings.HasPrefix(msg, blocked) {
			t.Errorf("DELETE = %d %q, want 409", st, msg)
		}
	})
}

// TestDeleteLanguageExactStoredCode: a legacy row that fails the code
// pattern stays removable under its stored spelling.
func TestDeleteLanguageExactStoredCode(t *testing.T) {
	ts, sqlDB := newServer(t)
	admin := registerUser(t, ts.URL, "admin", "")
	mustExec(t, sqlDB, `INSERT INTO languages (code, name, updated_at) VALUES ('pt_br', 'pt_br', 't')`)
	if st, _ := adminLang(t, http.MethodDelete, ts.URL, "/api/admin/languages/pt_br", admin, nil); st != http.StatusNoContent {
		t.Fatalf("DELETE pt_br = %d, want 204", st)
	}
	var n int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM languages WHERE code = 'pt_br'`).Scan(&n); err != nil || n != 0 {
		t.Errorf("rows left = %d (%v), want 0", n, err)
	}
}

func TestLanguageUsage(t *testing.T) {
	lang.Register(lang.Zh{})
	ts, sqlDB := newServer(t)
	admin := registerUser(t, ts.URL, "admin", "")
	bob := registerUser(t, ts.URL, "bob", admin)
	mustExec(t, sqlDB, `INSERT INTO languages (code, name, updated_at) VALUES ('es', 'es', 't')`)
	for _, c := range []struct{ tok, code string }{{admin, "es"}, {bob, "es"}, {bob, "zh"}} {
		if st, _ := adminLang(t, http.MethodPost, ts.URL, "/api/workspaces", c.tok, map[string]string{"language": c.code}); st != http.StatusCreated {
			t.Fatalf("workspace %s = %d", c.code, st)
		}
	}
	resp := doJSON(t, http.MethodGet, ts.URL, "/api/admin/languages/usage", admin, nil)
	var got []usageBody
	decodeJSON(t, resp, &got)
	want := []usageBody{{"es", 2}, {"zh", 1}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("usage = %+v, want %+v", got, want)
	}
}

func TestDeleteLanguageBodyNamesBlockers(t *testing.T) {
	ts, sqlDB := newServer(t)
	admin := registerUser(t, ts.URL, "admin", "")
	bob := registerUser(t, ts.URL, "bob", admin)
	mustExec(t, sqlDB,
		`INSERT INTO languages (code, name, updated_at) VALUES ('es', 'es', 't')`,
		`INSERT INTO sentence_packs (pack_id, name, version, language, license, attribution, updated_at) VALUES ('sp', 'n', '1', 'es', 'l', 'a', 't')`)
	for _, n := range []string{"a", "b"} {
		if st, _ := adminLang(t, http.MethodPost, ts.URL, "/api/workspaces", bob, map[string]string{"language": "es", "name": n}); st != http.StatusCreated {
			t.Fatalf("workspace = %d", st)
		}
	}
	st, msg := adminLang(t, http.MethodDelete, ts.URL, "/api/admin/languages/es", admin, nil)
	want := "language_in_use: The language is still used by: 2 workspaces, a sentence pack."
	if st != http.StatusConflict || msg != want {
		t.Errorf("DELETE = %d %q, want 409 %q", st, msg, want)
	}
	if strings.Contains(msg, "bob") {
		t.Errorf("body names a user: %q", msg)
	}
	// The counts ride beside the code (errors.json language_in_use).
	resp := doJSON(t, http.MethodDelete, ts.URL, "/api/admin/languages/es", admin, nil)
	defer resp.Body.Close()
	var body struct {
		Error string         `json:"error"`
		Usage map[string]int `json:"usage"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	wantUsage := map[string]int{"workspaces": 2, "dictionaries": 0, "levelLists": 0, "frequencyPacks": 0,
		"sentencePacks": 1, "grammarPacks": 0, "audioPacks": 0, "legacySentences": 0}
	if body.Error != "language_in_use" || !maps.Equal(body.Usage, wantUsage) {
		t.Errorf("usage = %v, want %v", body.Usage, wantUsage)
	}
}

func TestDeleteLanguageStoredUppercase(t *testing.T) {
	ts, sqlDB := newServer(t)
	admin := registerUser(t, ts.URL, "admin", "")
	mustExec(t, sqlDB, `INSERT INTO languages (code, name, updated_at) VALUES ('pt_BR', 'x', 't')`)
	if st, _ := adminLang(t, http.MethodDelete, ts.URL, "/api/admin/languages/pt_BR", admin, nil); st != http.StatusNoContent {
		t.Errorf("DELETE pt_BR = %d, want 204", st)
	}
}

// Creating workspaces while the language is removed never leaves a
// workspace of a language without a languages row.
func TestDeleteLanguageRacesWorkspaceCreate(t *testing.T) {
	ts, sqlDB := newServer(t)
	admin := registerUser(t, ts.URL, "admin", "")
	bob := registerUser(t, ts.URL, "bob", admin)
	mustExec(t, sqlDB, `INSERT INTO languages (code, name, updated_at) VALUES ('es', 'es', 't')`)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(2)
		go func() {
			defer wg.Done()
			doJSON(t, http.MethodPost, ts.URL, "/api/workspaces", bob, map[string]string{"language": "es", "name": "n" + strconv.Itoa(i)}).Body.Close()
		}()
		go func() {
			defer wg.Done()
			doJSON(t, http.MethodDelete, ts.URL, "/api/admin/languages/es", admin, nil).Body.Close()
		}()
	}
	wg.Wait()
	var orphans int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM workspaces w WHERE w.language = 'es' AND NOT EXISTS (SELECT 1 FROM languages WHERE code = 'es')`).Scan(&orphans); err != nil || orphans != 0 {
		t.Errorf("workspaces without a languages row = %d (%v), want 0", orphans, err)
	}
}
