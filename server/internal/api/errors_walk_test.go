package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"
)

// The error contract, checked on the answers (spec 2026-11-23-error-
// contract-design.md, section 4): every route of routes() is called as an
// anonymous caller, a user and an admin with an empty body, an empty
// object, a malformed body, unknown and non-numeric path values and an
// unknown workspace; then unmatched paths and wrong methods. Every answer
// with an error status must be application/json with a catalogue code and
// a message.

// walkPending lists the patterns whose handlers are not migrated yet (the
// plan's migration tasks empty it; it is then removed).
var walkPending = map[string]bool{
	"DELETE /api/admin/dictionaries/{id}":             true,
	"DELETE /api/admin/languages/{code}":              true,
	"DELETE /api/admin/packs/staged/{token}":          true,
	"DELETE /api/admin/packs/{type}/{packId}":         true,
	"DELETE /api/admin/schemes/{id}":                  true,
	"DELETE /api/admin/sentences/{pack}":              true,
	"DELETE /api/events/lookups":                      true,
	"DELETE /api/journal/photos/{id}":                 true,
	"DELETE /api/library/books/{id}":                  true,
	"DELETE /api/library/books/{id}/bookmarks/{bid}":  true,
	"DELETE /api/library/books/{id}/highlights/{hid}": true,
	"DELETE /api/plugins/{id}/data/{key}":             true,
	"DELETE /api/workspaces/{id}":                     true,
	"GET /api/admin/packs/staged/{token}":             true,
	"GET /api/audio-packs/{id}/credits":               true,
	"GET /api/audio/clips/{file}":                     true,
	"GET /api/audio/entries/{id}":                     true,
	"GET /api/characters":                             true,
	"GET /api/components":                             true,
	"GET /api/entries/{id}":                           true,
	"GET /api/entries/{id}/chars":                     true,
	"GET /api/events":                                 true,
	"GET /api/frequency-packs/{id}/top":               true,
	"GET /api/grammar/{pack}/{lesson}":                true,
	"GET /api/journal/capabilities":                   true,
	"GET /api/journal/photos/{id}":                    true,
	"GET /api/library/books":                          true,
	"GET /api/library/books/{id}":                     true,
	"GET /api/library/books/{id}/bookmarks":           true,
	"GET /api/library/books/{id}/chapters/{n}":        true,
	"GET /api/library/books/{id}/highlights":          true,
	"GET /api/library/sources/{source}/browse":        true,
	"GET /api/library/sources/{source}/search":        true,
	"GET /api/lookup":                                 true,
	"GET /api/plugins/{id}/data":                      true,
	"GET /api/plugins/{id}/data/{key}":                true,
	"GET /api/schemes/{id}/characters":                true,
	"GET /api/schemes/{id}/entries":                   true,
	"GET /api/search":                                 true,
	"GET /api/segment/at":                             true,
	"GET /api/stats/activity":                         true,
	"GET /fonts/{file}":                               true,
	"GET /hanzi/{file}":                               true,
	"POST /api/admin/dictionaries":                    true,
	"POST /api/admin/languages":                       true,
	"POST /api/admin/packs":                           true,
	"POST /api/admin/packs/staged/{token}":            true,
	"POST /api/admin/plugins":                         true,
	"POST /api/audio/resolve":                         true,
	"POST /api/entries/bases":                         true,
	"POST /api/entries/frequency-ranks":               true,
	"POST /api/entries/{id}/sentences":                true,
	"POST /api/events/batch":                          true,
	"POST /api/journal/photos":                        true,
	"POST /api/journal/review":                        true,
	"POST /api/journal/suggestions":                   true,
	"POST /api/journal/transcribe":                    true,
	"POST /api/library/books/{id}/bookmarks":          true,
	"POST /api/library/books/{id}/highlights":         true,
	"POST /api/library/sources/{source}/import":       true,
	"POST /api/segment":                               true,
	"POST /api/workspaces":                            true,
	"PUT /api/ai/active":                              true,
	"PUT /api/ai/keys/{provider}":                     true,
	"PUT /api/entries/{id}":                           true,
	"PUT /api/journal/photos/{id}/keepalive":          true,
	"PUT /api/library/books/{id}/bookmarks/{bid}":     true,
	"PUT /api/library/books/{id}/highlights/{hid}":    true,
	"PUT /api/library/books/{id}/position":            true,
	"PUT /api/plugins/{id}/data/{key}":                true,
	"PUT /api/plugins/{id}/state":                     true,
	"PUT /api/workspaces/{id}":                        true,
}

type walkFailure struct{ pattern, what string }

func checkErrorAnswer(cat map[string]int, w *httptest.ResponseRecorder) string {
	if w.Code < 400 || w.Code == 499 {
		return ""
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/json" {
		return "Content-Type " + ct + ": " + abbreviate(w.Body.String())
	}
	var body struct {
		Error   string `json:"error"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		return "not JSON: " + abbreviate(w.Body.String())
	}
	if _, ok := cat[body.Error]; !ok {
		return "code " + body.Error + " is not in errors.json: " + abbreviate(w.Body.String())
	}
	if strings.TrimSpace(body.Message) == "" {
		return "no message: " + abbreviate(w.Body.String())
	}
	return ""
}

func abbreviate(s string) string {
	if len(s) > 120 {
		return s[:120] + "…"
	}
	return s
}

func walkRequest(h http.Handler, method, path, body, token string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		r.Header.Set("Content-Type", "application/json")
	}
	r.RemoteAddr = "192.0.2.20:1234"
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestEveryErrorAnswerIsCodedJSON(t *testing.T) {
	cat := errorCatalogue(t)
	s, h, fresh, _, _ := newGateServerFresh(t)
	var failures []walkFailure
	failed := map[string]bool{}
	for _, rt := range s.routes() {
		method, path, _ := strings.Cut(rt.pattern, " ")
		bodies := []string{""}
		if method != http.MethodGet && method != http.MethodHead {
			bodies = []string{"", "{}", "{", `{"workspaceId": 999999, "workspace": 999999, "ids": [1]}`}
		}
		a := fresh()
		for _, tok := range []string{"", a.user, a.admin} {
			for _, wild := range []string{"999999", "x"} {
				p := pathVar.ReplaceAllString(path, wild)
				for _, q := range []string{"", "?workspace=999999", "?workspace=x&limit=x&since=x&lang=x"} {
					for _, b := range bodies {
						w := walkRequest(h, method, p+q, b, tok)
						if what := checkErrorAnswer(cat, w); what != "" {
							failed[rt.pattern] = true
							if !walkPending[rt.pattern] {
								failures = append(failures, walkFailure{rt.pattern, method + " " + p + q + " body " + b + ": " + what})
							}
						}
					}
				}
			}
		}
	}
	reported := map[string]bool{}
	for _, f := range failures {
		if !reported[f.pattern] { // one line per route keeps the output readable
			reported[f.pattern] = true
			t.Errorf("%s: %s", f.pattern, f.what)
		}
	}
	var stale []string
	for p := range walkPending {
		if !failed[p] {
			stale = append(stale, p)
		}
	}
	sort.Strings(stale)
	if len(stale) > 0 {
		t.Errorf("walkPending lists routes that answer coded JSON now (remove them): %q", stale)
	}
}
