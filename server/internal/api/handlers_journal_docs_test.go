package api_test

import (
	"encoding/json"
	"net/http"
	"strconv"
	"testing"

	"qinqin/internal/ai"
)

// The journal's document routes (#199): every one needs a user, is scoped to
// one of the caller's workspaces, and never reaches another user's journal.
func TestJournalDocumentRoutes(t *testing.T) {
	e := newJournalEnv(t, ai.Fake{}, false)
	bob := registerUser(t, e.url, "bob", e.token)
	bobWS := createWorkspace(t, e.url, bob, "zh", "")
	q := func(ws int64) string { return "?workspace=" + strconv.FormatInt(ws, 10) }

	for _, rt := range []struct{ method, path string }{
		{http.MethodGet, "/api/journal/entries"},
		{http.MethodGet, "/api/journal/entries/e1"},
		{http.MethodPut, "/api/journal/entries/e1"},
		{http.MethodDelete, "/api/journal/entries/e1"},
		{http.MethodGet, "/api/journal/entries/e1/review"},
		{http.MethodGet, "/api/journal/suggestions"},
		{http.MethodGet, "/api/journal/settings"},
		{http.MethodPut, "/api/journal/settings"},
	} {
		if r := doJSON(t, rt.method, e.url, rt.path+q(e.ws), "", map[string]any{}); r.StatusCode != 401 {
			t.Errorf("%s %s without a token: %d", rt.method, rt.path, r.StatusCode)
		}
		if r := doJSON(t, rt.method, e.url, rt.path+q(e.ws), bob, map[string]any{}); r.StatusCode != 404 {
			t.Errorf("%s %s in another user's workspace: %d, want 404", rt.method, rt.path, r.StatusCode)
		}
		if r := doJSON(t, rt.method, e.url, rt.path, e.token, map[string]any{}); r.StatusCode != 400 {
			t.Errorf("%s %s without a workspace: %d, want 400", rt.method, rt.path, r.StatusCode)
		}
	}

	entry := map[string]any{"date": "2026-11-19", "title": "T", "text": "你好", "source": "typed", "createdAt": "2026-11-19T08:00:00.5Z"}
	r := doJSON(t, http.MethodPut, e.url, "/api/journal/entries/e1"+q(e.ws), e.token, entry)
	var stored map[string]any
	decodeJSON(t, r, &stored)
	if r.StatusCode != 200 || stored["id"] != "e1" || stored["text"] != "你好" || stored["createdAt"] != "2026-11-19T08:00:00.5Z" || stored["updatedAt"] == "" {
		t.Fatalf("put entry: %d %v", r.StatusCode, stored)
	}
	if r := doJSON(t, http.MethodPut, e.url, "/api/journal/entries/e1"+q(bobWS), bob, map[string]any{"date": "2026-11-20", "text": "bob", "source": "typed"}); r.StatusCode != 200 {
		t.Fatalf("bob's entry: %d", r.StatusCode)
	}
	for name, body := range map[string]any{
		"bad source": map[string]any{"date": "2026-11-19", "text": "x", "source": "voice"},
		"bad date":   map[string]any{"date": "tomorrow", "text": "x", "source": "typed"},
		"not json":   "x",
	} {
		if r := doJSON(t, http.MethodPut, e.url, "/api/journal/entries/e2"+q(e.ws), e.token, body); r.StatusCode != 400 {
			t.Errorf("%s: %d, want 400", name, r.StatusCode)
		}
	}
	if r := doJSON(t, http.MethodPut, e.url, "/api/journal/entries/a.b"+q(e.ws), e.token, entry); r.StatusCode != 400 {
		t.Errorf("bad id: %d, want 400", r.StatusCode)
	}

	var list []map[string]any
	r = doJSON(t, http.MethodGet, e.url, "/api/journal/entries"+q(e.ws), e.token, nil)
	decodeJSON(t, r, &list)
	if r.StatusCode != 200 || len(list) != 1 || list[0]["text"] != "你好" {
		t.Errorf("alice's list: %d %v", r.StatusCode, list)
	}
	r = doJSON(t, http.MethodGet, e.url, "/api/journal/entries"+q(e.other), e.token, nil)
	decodeJSON(t, r, &list)
	if r.StatusCode != 200 || len(list) != 0 {
		t.Errorf("another workspace's list: %d %v, want []", r.StatusCode, list)
	}
	r = doJSON(t, http.MethodGet, e.url, "/api/journal/entries/e1"+q(bobWS), bob, nil)
	var bobs map[string]any
	decodeJSON(t, r, &bobs)
	if r.StatusCode != 200 || bobs["text"] != "bob" {
		t.Errorf("bob's e1: %d %v", r.StatusCode, bobs)
	}

	var review map[string]json.RawMessage
	r = doJSON(t, http.MethodGet, e.url, "/api/journal/entries/e1/review"+q(e.ws), e.token, nil)
	decodeJSON(t, r, &review)
	if r.StatusCode != 200 || string(review["review"]) != "null" {
		t.Errorf("no review: %d %s", r.StatusCode, review["review"])
	}
	var sugg map[string]json.RawMessage
	r = doJSON(t, http.MethodGet, e.url, "/api/journal/suggestions"+q(e.ws), e.token, nil)
	decodeJSON(t, r, &sugg)
	if r.StatusCode != 200 || string(sugg["suggestions"]) != "null" {
		t.Errorf("no suggestions: %d %s", r.StatusCode, sugg["suggestions"])
	}

	var st map[string]any
	r = doJSON(t, http.MethodGet, e.url, "/api/journal/settings"+q(e.ws), e.token, nil)
	decodeJSON(t, r, &st)
	if r.StatusCode != 200 || st["explanationLanguage"] != "en" || st["guidance"] != "" {
		t.Errorf("default settings: %d %v", r.StatusCode, st)
	}
	if r := doJSON(t, http.MethodPut, e.url, "/api/journal/settings"+q(e.ws), e.token, map[string]any{"guidance": "g", "explanationLanguage": "xx"}); r.StatusCode != 400 {
		t.Errorf("unknown explanation language: %d, want 400", r.StatusCode)
	}
	r = doJSON(t, http.MethodPut, e.url, "/api/journal/settings"+q(e.ws), e.token, map[string]any{"guidance": "g", "explanationLanguage": "de"})
	decodeJSON(t, r, &st)
	if r.StatusCode != 200 || st["explanationLanguage"] != "de" || st["guidance"] != "g" {
		t.Errorf("put settings: %d %v", r.StatusCode, st)
	}
	r = doJSON(t, http.MethodGet, e.url, "/api/journal/settings"+q(bobWS), bob, nil)
	decodeJSON(t, r, &st)
	if st["explanationLanguage"] != "en" {
		t.Errorf("bob sees alice's settings: %v", st)
	}

	if r := doJSON(t, http.MethodDelete, e.url, "/api/journal/entries/e1"+q(e.ws), e.token, nil); r.StatusCode != 204 {
		t.Errorf("delete: %d", r.StatusCode)
	}
	if r := doJSON(t, http.MethodDelete, e.url, "/api/journal/entries/e1"+q(e.ws), e.token, nil); r.StatusCode != 404 {
		t.Errorf("second delete: %d, want 404", r.StatusCode)
	}
	if r := doJSON(t, http.MethodGet, e.url, "/api/journal/entries/e1"+q(e.ws), e.token, nil); r.StatusCode != 404 {
		t.Errorf("deleted entry: %d, want 404", r.StatusCode)
	}
	if r := doJSON(t, http.MethodGet, e.url, "/api/journal/entries/e1"+q(bobWS), bob, nil); r.StatusCode != 200 {
		t.Errorf("alice's delete reached bob: %d", r.StatusCode)
	}
}
