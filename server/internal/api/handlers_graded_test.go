package api_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"qinqin/internal/lang"
	"qinqin/internal/library/sources/graded"
)

// TestGradedCatalogue: GET /api/library/graded needs a signed-in session, answers every text or one language's, and
// its entries are those of docs/contracts/graded/catalogue.json.
func TestGradedCatalogue(t *testing.T) {
	ts, _, _ := newSourcesServer(t, graded.Source{})
	if resp := doJSON(t, http.MethodGet, ts.URL, "/api/library/graded", "", nil); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("no session: status = %d, want 401", resp.StatusCode)
	}
	alice := registerUser(t, ts.URL, "alice", "")
	get := func(query string) []map[string]any {
		t.Helper()
		resp := doJSON(t, http.MethodGet, ts.URL, "/api/library/graded"+query, alice, nil)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("%s: status = %d", query, resp.StatusCode)
		}
		var out struct {
			Texts []map[string]any `json:"texts"`
		}
		decodeJSON(t, resp, &out)
		return out.Texts
	}
	all, zh, ja, es := get(""), get("?language=zh"), get("?language=ja"), get("?language=es")
	if len(all) != 35 || len(zh) != 20 || len(ja) != 15 || es == nil || len(es) != 0 {
		t.Fatalf("all %d, zh %d, ja %d, es %v", len(all), len(zh), len(ja), es)
	}
	if resp := doJSON(t, http.MethodGet, ts.URL, "/api/library/graded?language=Z!", alice, nil); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad language: status = %d, want 400", resp.StatusCode)
	}

	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "docs", "contracts", "graded", "catalogue.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		Version int                               `json:"version"`
		Rule    string                            `json:"rule"`
		Doc     string                            `json:"doc"`
		Answer  struct{ Texts []json.RawMessage } `json:"answer"`
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&fx); err != nil || fx.Rule != "graded/catalogue" || len(fx.Answer.Texts) == 0 {
		t.Fatalf("catalogue.json: %v, rule %q, %d texts", err, fx.Rule, len(fx.Answer.Texts))
	}
	byID := map[string]map[string]any{}
	for _, e := range all {
		byID[e["id"].(string)] = e
	}
	for _, rawText := range fx.Answer.Texts {
		var want map[string]any
		if err := json.Unmarshal(rawText, &want); err != nil {
			t.Fatal(err)
		}
		got, ok := byID[want["id"].(string)]
		if !ok {
			t.Fatalf("fixture text %v is not in the catalogue", want["id"])
		}
		gj, _ := json.Marshal(got)
		wj, _ := json.Marshal(want)
		if !bytes.Equal(gj, wj) {
			t.Errorf("text %v:\n got  %s\n want %s", want["id"], gj, wj)
		}
	}
}

// TestGradedImport: a graded text is added to a workspace of its language as a one-chapter book, once; another
// language's workspace refuses it; another user's library does not see it.
func TestGradedImport(t *testing.T) {
	lang.Register(lang.Zh{})
	lang.Register(lang.Ja{})
	ts, _, _ := newSourcesServer(t, graded.Source{})
	alice := registerUser(t, ts.URL, "alice", "")
	bob := registerUser(t, ts.URL, "bob", alice)
	zh := newWorkspace(t, ts.URL, alice, "zh", "")
	ja := newWorkspace(t, ts.URL, alice, "ja", "")
	bobZh := newWorkspace(t, ts.URL, bob, "zh", "")
	id := graded.Catalogue("zh")[0].ID
	path := "/api/library/sources/graded/import"

	resp := doJSON(t, http.MethodPost, ts.URL, path, alice, importBody(id, zh))
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d: %s", resp.StatusCode, bodyOf(t, resp))
	}
	var b struct {
		libBook
		Attribution string `json:"attribution"`
		LicenseNote string `json:"licenseNote"`
	}
	decodeJSON(t, resp, &b)
	if b.Source != "graded" || b.SourceID != id || b.ChapterCount != 1 || b.Author != "qinqin" || b.LicenseNote != "CC BY 4.0, qinqin contributors" {
		t.Fatalf("book = %+v", b)
	}
	if resp := doJSON(t, http.MethodPost, ts.URL, path, alice, importBody(id, zh)); resp.StatusCode != http.StatusConflict {
		t.Fatalf("again: status = %d, want 409", resp.StatusCode)
	}
	if resp := doJSON(t, http.MethodPost, ts.URL, path, alice, importBody(id, ja)); resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("ja workspace: status = %d, want 422", resp.StatusCode)
	}
	if resp := doJSON(t, http.MethodPost, ts.URL, path, alice, importBody("zh-nope", zh)); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown text: status = %d, want 404", resp.StatusCode)
	}
	if books := listBooks(t, ts.URL, bob, bobZh); len(books) != 0 {
		t.Fatalf("bob sees %d books", len(books))
	}
	if resp := doJSON(t, http.MethodPost, ts.URL, path, bob, importBody(id, zh)); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("bob into alice's workspace: status = %d, want 404", resp.StatusCode)
	}
	if resp := doJSON(t, http.MethodPost, ts.URL, path, bob, importBody(id, bobZh)); resp.StatusCode != http.StatusCreated {
		t.Fatalf("bob's own copy: status = %d, want 201", resp.StatusCode)
	}
}
